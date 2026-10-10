/**
 * The files brought into a message (dragged in, pasted, picked with +): a row of thumbnails (a picture's own, a
 * video's frame) and names above the sentence. On the desktop each goes into the project at once, through Studio's own
 * import (assets/upload/): the agent works in the project folder, so that is where it can read them, and Studio's
 * media shows them too. The message says where they are (attachedText), the bubble shows their names and thumbnails.
 */
import React from 'react';
import type { TurnAttachment } from '@openfilm/shared';
import { isImageAttachment, isVideoAttachment, makeAttachmentThumb, readFileDataUrl, videoFrameDataUrl } from '@/lib/composer-attachments';
import { attachmentKind } from '@/lib/project-resources';
import { app } from '../app-bridge';

export interface DesktopAttachment {
  id: string;
  name: string;
  kind: 'image' | 'document';
  mediaType: string;
  size: number;
  /** an image's own picture, while it is in the composer */
  previewUrl?: string;
  /** the small picture kept with the message: an image's, or a frame of a video */
  thumb?: string;
  state: 'importing' | 'ready' | 'failed';
  /** where it landed in the project */
  path?: string;
  error?: string;
}

/** at most this many in one message */
const MAX_FILES = 12;

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];
export function formatFileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) { value /= 1024; unit += 1; }
  return `${unit ? value.toFixed(value < 10 ? 1 : 0) : value} ${SIZE_UNITS[unit]}`;
}

export function useDesktopAttachments() {
  const [files, setFiles] = React.useState<DesktopAttachment[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const patch = (id: string, next: Partial<DesktopAttachment>) => setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...next } : f)));

  const count = React.useRef(0);
  count.current = files.length;
  const add = React.useCallback((incoming: File[]) => {
    setNotice(null);
    const room = Math.max(0, MAX_FILES - count.current);
    if (incoming.length > room) setNotice(`Up to ${MAX_FILES} files in one message.`);
    const items = incoming.slice(0, room).map((file) => {
      const image = isImageAttachment(file);
      const item: DesktopAttachment = {
        id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        name: file.name || (image ? 'image.png' : 'file'),
        kind: image ? 'image' : 'document',
        mediaType: file.type,
        size: file.size,
        ...(image ? { previewUrl: URL.createObjectURL(file) } : {}),
        state: 'importing',
      };
      return { item, file };
    });
    count.current += items.length;
    setFiles((list) => [...list, ...items.map(({ item }) => item)]);
    for (const { item, file } of items) {
      if (item.kind === 'image') {
        void readFileDataUrl(file).then(makeAttachmentThumb).then((thumb) => { if (thumb) patch(item.id, { thumb }); }).catch(() => {});
      } else if (isVideoAttachment(file)) {
        /* a video shows a frame of itself, as a picture does: its name alone says little of what was sent */
        void videoFrameDataUrl(file).then(makeAttachmentThumb).then((thumb) => { if (thumb) patch(item.id, { thumb }); }).catch(() => {});
      }
      /* a file from the disk goes by its path; a pasted one has none, so its bytes go */
      const path = (window as unknown as { openfilmDesktop?: { pathForFile?: (f: File) => string } }).openfilmDesktop?.pathForFile?.(file) ?? '';
      void (path ? Promise.resolve(null) : file.arrayBuffer())
        .then((bytes) => app.importFile(path ? { path, name: item.name } : { bytes: bytes!, name: item.name }))
        .then((r) => patch(item.id, r.ok ? { state: 'ready', path: r.path } : { state: 'failed', error: r.error }))
        .catch((error: unknown) => patch(item.id, { state: 'failed', error: error instanceof Error ? error.message : String(error) }));
    }
  }, []);

  const drop = React.useCallback((id: string) => {
    setFiles((list) => {
      const gone = list.find((f) => f.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return list.filter((f) => f.id !== id);
    });
  }, []);

  /** Hand over the files for sending; the composer is empty of them after. */
  const current = React.useRef(files);
  current.current = files;
  const take = React.useCallback((): DesktopAttachment[] => {
    const taken = current.current;
    current.current = [];
    count.current = 0;
    setFiles([]);
    return taken;
  }, []);

  return { files, notice, setNotice, add, drop, take };
}

/** What still keeps the message from going: a file being imported, or one that did not import. */
export function attachmentBlocker(files: readonly DesktopAttachment[]): string | null {
  if (files.some((f) => f.state === 'importing')) return 'The files are still going into the project.';
  const failed = files.filter((f) => f.state === 'failed');
  return failed.length ? `${failed.map((f) => f.name).join(', ')} did not go into the project: ${failed[0]!.error ?? 'try again'}. Remove it to send.` : null;
}

/** After the message, for the agent: where the files are now. */
export function attachedText(files: readonly DesktopAttachment[]): string {
  const placed = files.filter((f) => f.path);
  if (!placed.length) return '';
  return `\n\nAttached files (in this project folder):\n${placed.map((f) => `- ${f.path} (${attachmentKind({ name: f.name, mediaType: f.mediaType })}, ${formatFileSize(f.size)})`).join('\n')}`;
}

/** What the message keeps of them, to show in its bubble. */
export function turnAttachments(files: readonly DesktopAttachment[]): TurnAttachment[] {
  return files.map((f) => ({ kind: f.kind, name: f.name, ...(f.thumb ? { thumb: f.thumb } : {}) }));
}
