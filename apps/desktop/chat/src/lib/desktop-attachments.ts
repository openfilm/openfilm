/**
 * The files brought into a message (dragged in, pasted, picked with +): each a pill in the sentence, with its
 * thumbnail (a picture's own, a video's frame) and name (lib/attachment-pills). Any number, and folders too. A file or
 * folder from the disk stays where it is: the message names its path where its pill is, as an agent's own chat does,
 * and the agent copies into the project what the film uses. Only a pasted one, which has no path, is kept in the
 * project (.film/attachments/). Pictures are also sent to the agent beside the text, as one pasted in its own chat
 * is, to an agent that takes pictures (attachedPictures), in the order of their pills.
 */
import React from 'react';
import type { TurnAttachment } from '@openfilm/shared';
import { isImageAttachment, isVideoAttachment, makeAttachmentThumb, readFileDataUrl, videoFrameDataUrl } from '@/lib/composer-attachments';
import { app } from '../app-bridge';
import type { PromptImage } from '@/lib/desktop-bridge';
import { attachedPicture } from '@/lib/ref-pictures';
import { newAttachmentPillId } from '@/lib/attachment-pills';

export { formatFileSize } from '@/lib/attachment-pills';

export interface DesktopAttachment {
  /** its pill's id in the sentence */
  id: string;
  name: string;
  kind: 'image' | 'document';
  mediaType: string;
  size: number;
  /** a folder from the disk: its path names it, nothing in it is read */
  folder?: boolean;
  /** the file itself, while it is in the composer: an image shows it, and any one opens it to look at (AttachmentPreview) */
  previewUrl?: string;
  /** the small picture kept with the message: an image's, or a frame of a video */
  thumb?: string;
  state: 'pending' | 'ready' | 'failed';
  /** where it is: its own path on the disk, or where a pasted one was kept in the project */
  path?: string;
  /** the file, until the message goes: a picture is read for its agent only then, and only as many as are sent */
  file?: File;
  error?: string;
}

/** at most this many pictures go with a message (the app sends no more: src/local-agents-ipc.mjs PROMPT_IMAGES_MAX) */
export const PROMPT_PICTURES_MAX = 20;

/** thumbnails made at once: a folder's worth of photos read all together would hold every one of them in memory */
const THUMBS_AT_ONCE = 4;

export function useDesktopAttachments(project: string) {
  const [files, setFiles] = React.useState<DesktopAttachment[]>([]);
  const patch = (id: string, next: Partial<DesktopAttachment>) => setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...next } : f)));

  const thumbs = React.useRef<{ running: number; waiting: Array<() => Promise<void>> }>({ running: 0, waiting: [] });
  const thumbnail = React.useCallback((make: () => Promise<void>) => {
    const queue = thumbs.current;
    const next = () => {
      if (queue.running >= THUMBS_AT_ONCE) return;
      const job = queue.waiting.shift();
      if (!job) return;
      queue.running += 1;
      void job().catch(() => {}).finally(() => { queue.running -= 1; next(); });
    };
    queue.waiting.push(make);
    next();
  }, []);

  /** Takes the files in; their records come back at once, for their pills to go into the sentence. */
  const add = React.useCallback((incoming: File[]): DesktopAttachment[] => {
    const bridge = (window as unknown as { openfilmDesktop?: { pathForFile?: (f: File) => string } }).openfilmDesktop;
    const items = incoming.map((file) => {
      const image = isImageAttachment(file);
      const item: DesktopAttachment = {
        id: newAttachmentPillId(),
        name: file.name || (image ? 'image.png' : 'file'),
        kind: image ? 'image' : 'document',
        mediaType: file.type,
        size: file.size,
        previewUrl: URL.createObjectURL(file),
        state: 'pending',
        file,
      };
      return { item, file, path: bridge?.pathForFile?.(file) ?? '' };
    });
    setFiles((list) => [...list, ...items.map(({ item }) => item)]);
    for (const { item, file } of items) {
      if (item.kind === 'image') {
        thumbnail(() => readFileDataUrl(file).then(makeAttachmentThumb).then((thumb) => { if (thumb) patch(item.id, { thumb }); }));
      } else if (isVideoAttachment(file)) {
        /* a video shows a frame of itself, as a picture does: its name alone says little of what was sent */
        thumbnail(() => videoFrameDataUrl(file).then(makeAttachmentThumb).then((thumb) => { if (thumb) patch(item.id, { thumb }); }));
      }
    }
    /* from the disk: its path, once the app has said whether it is a file or a folder (nothing is copied) */
    const onDisk = items.filter(({ path }) => path);
    if (onDisk.length) {
      void app.chat.describePaths(onDisk.map(({ path }) => path))
        .then((found) => onDisk.forEach(({ item }, i) => {
          const one = found[i];
          if (!one || 'error' in one) { patch(item.id, { state: 'failed', error: one?.error ?? 'That is not a file.' }); return; }
          if (one.folder) {
            URL.revokeObjectURL(item.previewUrl!);
            patch(item.id, { state: 'ready', path: one.path, folder: true, kind: 'document', previewUrl: undefined, file: undefined, thumb: undefined });
          } else patch(item.id, { state: 'ready', path: one.path, size: one.size ?? item.size });
        }))
        .catch((error: unknown) => onDisk.forEach(({ item }) => patch(item.id, { state: 'failed', error: error instanceof Error ? error.message : String(error) })));
    }
    /* pasted: no path of its own, so its bytes are kept in the project */
    for (const { item, file, path } of items) {
      if (path) continue;
      void file.arrayBuffer()
        .then((bytes) => app.chat.saveAttachment(project, item.name, bytes))
        .then((r) => patch(item.id, { state: 'ready', path: r.path }))
        .catch((error: unknown) => patch(item.id, { state: 'failed', error: error instanceof Error ? error.message : String(error) }));
    }
    return items.map(({ item }) => item);
  }, [project, thumbnail]);

  /**
   * Hand over the files whose pills are sent, in that order; the composer is empty of files after, those whose pill
   * was taken out too (kept until now only so an undo could bring the pill back).
   */
  const current = React.useRef(files);
  current.current = files;
  const take = React.useCallback((ids: readonly string[]): DesktopAttachment[] => {
    const byId = new Map(current.current.map((f) => [f.id, f]));
    const taken = ids.flatMap((id) => byId.get(id) ?? []);
    /* sent: the message keeps their thumbnails, the agent their paths */
    for (const f of current.current) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    current.current = [];
    setFiles([]);
    return taken;
  }, []);

  return { files, add, take };
}

/** What still keeps the message from going: a file still on its way, or one that could not be attached. */
export function attachmentBlocker(files: readonly DesktopAttachment[], t: (path: string) => string): string | null {
  if (files.some((f) => f.state === 'pending')) return t('composer.filesPending');
  const failed = files.filter((f) => f.state === 'failed');
  return failed.length
    ? t('composer.filesFailed').replace('{names}', failed.map((f) => f.name).join(', ')).replace('{error}', failed[0]!.error ?? '')
    : null;
}

/**
 * The pictures among them, as their agent is sent them: the first `room`, in the order given (their pills' order; the
 * rest go by their path only). Read now, as the message goes: a folder's worth of photos would not all be sent anyway.
 */
export async function attachedPictures(files: readonly DesktopAttachment[], room: number): Promise<PromptImage[]> {
  const wanted = files.filter((f) => f.kind === 'image' && f.file).slice(0, Math.max(0, room));
  const made = await Promise.all(wanted.map((f) => attachedPicture(f.file!)));
  return made.filter((picture): picture is PromptImage => picture !== null);
}

/** What the message keeps of them, to show in its bubble (a folder's name ends in "/", and its path opens it). */
export function turnAttachments(files: readonly DesktopAttachment[]): TurnAttachment[] {
  return files.map((f) => ({
    kind: f.kind,
    name: f.folder ? `${f.name}/` : f.name,
    ...(f.thumb ? { thumb: f.thumb } : {}),
    ...(f.folder && f.path ? { path: f.path } : {}),
  }));
}
