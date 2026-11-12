import { clipKind } from './film-doc.mjs';

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.srt', '.vtt', '.log'];

export const WRITING_ATTACHMENT_ACCEPT = [...TEXT_EXTENSIONS, 'image/*', 'video/*', '.mkv', '.avi'].join(',');
export const WRITING_ATTACHMENT_LIMIT = 5;

/** @param {string} path */
export function writingAttachmentKind(path) {
  if (TEXT_EXTENSIONS.includes(path.slice(path.lastIndexOf('.')).toLowerCase())) return 'text';
  const kind = clipKind(path);
  return kind === 'still' || kind === 'video' ? kind : null;
}
