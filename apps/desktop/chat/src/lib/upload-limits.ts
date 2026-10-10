/**
 * Attachment formats.
 *
 * The composer doesn't filter by format. Files are sorted only by how they reach the model:
 *   · images go into the message (a multimodal model sees the pixels) and are also saved, with a path;
 *   · everything else goes as a path only. The model can't read the bytes of a pdf or mp4; a path it can read,
 *     open with Python or put in the film is more honest, and more useful, than pretending to send the file.
 */

/*
 * No size limits here: each file is imported into the project folder and the agent gets its path.
 */

/**
 * Two sets rather than one audio-video set: the UI must pick a tile's icon and open it in `<video>` or `<audio>`;
 * an mp3 in a video player is a screen that stays black.
 */
export const VIDEO_UPLOAD_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv']);
export const AUDIO_UPLOAD_EXTENSIONS = new Set([
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac',
]);

/**
 * Documents whose mediaType is known. Not an allow-list: the composer takes anything (see the header). The table
 * only supplies a MIME type when the browser reports none.
 */
export const DOCUMENT_EXTENSIONS = new Set([
  'csv', 'xlsx', 'pptx', 'docx', 'pdf',
  'txt', 'md', 'markdown',
  'doc', 'xls', 'ppt', 'rtf', 'odt', 'ods', 'odp',
]);

export const DOCUMENT_MEDIA_TYPES: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};


/** Extensions recognized as images, for reference pictures. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] as const;
