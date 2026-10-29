/**
 * Files brought into a message (dragged from Finder, pasted, picked with +) are pills in the sentence, where they were
 * dropped or where the caret was, like a file picked with `@`. Each one's record (desktop-attachments) is kept under
 * its pill's id, so the sentence decides which files go and in what order: a pill taken out leaves its file behind,
 * and undo brings both back.
 *
 * No React here, so the tests can import it.
 */
import type { PromptDisplay, PromptReference, TurnAttachment } from '@openfilm/shared';

/** What a pill needs of a file brought in (DesktopAttachment has all of it). */
export interface AttachmentRecord {
  id: string;
  name: string;
  kind: 'image' | 'document';
  size: number;
  folder?: boolean;
  path?: string;
  /** an image itself, while it is in the composer (a blob: address) */
  previewUrl?: string;
  /** a video's frame, or an image's small copy */
  thumb?: string;
}

/* The id prefix of a file brought in: the rest is only a key, since a pasted file has no path until it is kept. */
const ATTACHMENT_PILL_PREFIX = 'attachment:';

export function newAttachmentPillId(): string {
  return `${ATTACHMENT_PILL_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function isAttachmentPill(id: string): boolean {
  return id.startsWith(ATTACHMENT_PILL_PREFIX);
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];
export function formatFileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) { value /= 1024; unit += 1; }
  return `${unit ? value.toFixed(value < 10 ? 1 : 0) : value} ${SIZE_UNITS[unit]}`;
}

/** Its pill in the composer: the name (a folder's ends in "/"), the size, and the picture while there is one. */
export function attachmentPill(file: AttachmentRecord): PromptReference & { kind: 'file' } {
  const picture = file.kind === 'image' ? file.previewUrl ?? file.thumb : file.thumb;
  return {
    id: file.id,
    kind: 'file',
    label: file.folder ? `${file.name}/` : file.name,
    ...(file.folder ? {} : { detail: formatFileSize(file.size) }),
    ...(picture ? { image: { src: picture } } : {}),
  };
}

/** The files whose pills are in the text, in the order of its pills (the editor's references: in order, each once). */
export function attachmentsInText<T extends AttachmentRecord>(files: readonly T[], pills: readonly { id: string }[]): T[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  return pills.flatMap((pill) => byId.get(pill.id) ?? []);
}

/**
 * What the agent reads in place of the pill: where the file is (its own path on the disk, or where a pasted one was
 * kept in the project). A folder's path ends in "/". A path with a space is set in backticks, so where it ends is
 * plain in the sentence. Null until it has a path.
 */
export function attachmentWords(file: Pick<AttachmentRecord, 'path' | 'folder'>): string | null {
  if (!file.path) return null;
  const path = file.folder ? `${file.path.replace(/[\\/]+$/, '')}/` : file.path;
  return /\s/.test(path) ? `\`${path}\`` : path;
}

/**
 * The path if it is inside the project (relative to it), null if it is somewhere else on the disk (absolute, on a Mac
 * or on Windows): only the project's own files are in Studio to point at.
 */
export function projectFilePath(path: string | null): string | null {
  if (!path || /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)) return null;
  return path;
}

/**
 * The pill as the sent message keeps it: without its picture, whose address lasts only while it is in the composer
 * (the message keeps the thumbnails with its attachments, `attachmentPillPictures`). Other pills are kept as they are.
 */
export function sentPill<R extends PromptReference>(reference: R): R {
  if (!isAttachmentPill(reference.id) || !reference.image) return reference;
  const { image: _image, ...rest } = reference;
  return rest as R;
}

/**
 * A sent message's file pills with their thumbnails: the message keeps its files in the order of their pills, so the
 * nth file pill is the nth attachment. Null when they do not pair up (a message from before files were pills, whose
 * attachments are shown as a row of their own).
 */
export function attachmentPillPictures(
  display: PromptDisplay | null | undefined,
  attachments: readonly TurnAttachment[],
): Map<string, string> | null {
  const pills = display?.references.filter((reference) => isAttachmentPill(reference.id)) ?? [];
  if (!pills.length || pills.length !== attachments.length) return null;
  const pictures = new Map<string, string>();
  pills.forEach((pill, index) => {
    const thumb = attachments[index]!.thumb;
    if (thumb) pictures.set(pill.id, thumb);
  });
  return pictures;
}
