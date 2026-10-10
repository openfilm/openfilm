/**
 * Putting things into the composer: dropped, pasted or picked from "+", all take this path.
 *
 * Two kinds: images go into the first message as references; everything else goes the files way, as a path only.
 * Sorting turns nothing away, for format, count or size.
 *
 * Sorting is kept apart from reading bytes: the first is pure and tested with plain objects; the second only
 * makes sense in a browser (FileReader) and has no branches worth testing.
 */
import { TURN_ATTACHMENT_THUMB_MAX_CHARS } from '@openfilm/shared';
import {
  DOCUMENT_MEDIA_TYPES,
  IMAGE_EXTENSIONS,
  VIDEO_UPLOAD_EXTENSIONS,
} from './upload-limits';

/** A batch of files sorted in two. Nothing is refused: not for format, count or size. */
export interface AttachmentPlan<T> {
  images: T[];
  documents: T[];
}

/** The file name's extension (lower case, no dot); empty when there is no dot. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Whether this is an image.
 *
 * MIME first: a pasted screenshot often has no useful name (Chrome says "image.png", Safari sometimes nothing),
 * so the extension tells nothing. Only without a MIME type does the extension decide, as for some files dragged
 * from Finder.
 */
export function isImageAttachment(file: { name: string; type: string }): boolean {
  if (file.type.startsWith('image/')) return true;
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));
}

/**
 * Whether this file goes as a path: everything but images.
 *
 * The model never reads a file's bytes; pdf or mp4, it gets a path, and a path works for any format. So this asks
 * only "is it an image", not "what format is it".
 */
export function isDocumentAttachment(file: { name: string; type: string }): boolean {
  return !isImageAttachment(file);
}

/** Whether this is a video: MIME first, the extension only without one (as in isImageAttachment). */
export function isVideoAttachment(file: { name: string; type?: string; mediaType?: string }): boolean {
  const mime = file.type || file.mediaType || '';
  if (mime.startsWith('video/')) return true;
  return VIDEO_UPLOAD_EXTENSIONS.has(extensionOf(file.name));
}

/** The mediaType sent on: from the table, else the one the browser reports. */
export function documentMediaType(file: { name: string; type: string }): string {
  return DOCUMENT_MEDIA_TYPES[extensionOf(file.name)] ?? file.type ?? 'application/octet-stream';
}

/**
 * Splits the batch into images and paths, in the order the person attached them. None is turned away.
 *
 * Generic only so tests can pass plain { name, type } objects; callers pass File[].
 */
export function planComposerAttachments<T extends { name: string; type: string }>(
  files: readonly T[],
): AttachmentPlan<T> {
  const images: T[] = [];
  const documents: T[] = [];
  for (const file of files) {
    if (isImageAttachment(file)) images.push(file);
    else documents.push(file);
  }
  return { images, documents };
}

/**
 * The files in a paste or a drop.
 *
 * `files` is the standard place, but Safari sometimes pastes into `items` only and leaves `files` empty, so both
 * are read.
 */
export function filesFromTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  if (data.files && data.files.length > 0) return Array.from(data.files);
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/** Whether this drop or paste carries files from the system (not text, nor a drag inside the app). */
export function transferHasFiles(data: DataTransfer | null | undefined): boolean {
  return !!data && Array.from(data.types).includes('Files');
}

/**
 * Thumbnail edge sizes, tried largest first.
 *
 * 320 so it still reads when opened: this copy is not only the 40px tile in the message but the only thing the
 * person can open later; the original goes into the agent's workspace and never comes back to the UI.
 *
 * Over the limit, the next size is tried rather than giving up: a busy photo may not fit at 320 but is still
 * recognizable at 224, which is all this copy is for.
 */
const THUMB_STEPS = [320, 224, 160] as const;

/**
 * A thumbnail that stays in the conversation.
 *
 * The original image goes to the agent's workspace and never comes back to the UI; without a copy, the person
 * cannot tell later which image they sent. So a copy of some tens of KB is kept with the message.
 *
 * webp, not jpeg: screenshots are often UI with transparent backgrounds, which jpeg turns black. Without webp
 * support toDataURL falls back to png, which is larger, hence the sizes.
 * Any failure returns undefined: a missing thumbnail must not block a message.
 */
export function makeAttachmentThumb(dataUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(undefined);
        for (const edge of THUMB_STEPS) {
          const longest = Math.max(image.naturalWidth, image.naturalHeight);
          // An SVG may have no intrinsic size (naturalWidth 0): fill the edge, don't divide by zero.
          const scale = longest > 0 ? Math.min(1, edge / longest) : 1;
          canvas.width = Math.max(1, Math.round((image.naturalWidth || edge) * scale));
          canvas.height = Math.max(1, Math.round((image.naturalHeight || edge) * scale));
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          const thumb = canvas.toDataURL('image/webp', 0.75);
          if (thumb.length <= TURN_ATTACHMENT_THUMB_MAX_CHARS) return resolve(thumb);
        }
        resolve(undefined);
      } catch {
        // A cross-origin image taints the canvas and toDataURL throws; inputs here are data URLs, but still.
        resolve(undefined);
      }
    };
    image.onerror = () => resolve(undefined);
    image.src = dataUrl;
  });
}

/**
 * One frame of a video as a data URL, the thumbnail for its tile.
 *
 * At 1 s (a tenth in for short clips), not frame 0: many clips fade in from black.
 * Formats the browser can't decode (often mkv, avi) end in onerror, and the caller keeps the file-name tile.
 */
export function videoFrameDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const end = (frame?: string, error?: unknown) => {
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      if (frame) resolve(frame); else reject(error ?? new Error('no frame'));
    };
    video.muted = true;
    video.preload = 'auto';
    video.onloadedmetadata = () => { video.currentTime = Math.min(1, (video.duration || 0) * 0.1); };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        end(canvas.toDataURL('image/jpeg', 0.85));
      } catch (error) { end(undefined, error); }
    };
    video.onerror = () => end(undefined, video.error);
    video.src = url;
  });
}

export function readFileDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
