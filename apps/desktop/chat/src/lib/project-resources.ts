/**
 * Which kind a file is, and its icon, so a file looks the same everywhere in the chat.
 */
import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Subtitles,
  type LucideIcon,
} from 'lucide-react';
import { AUDIO_UPLOAD_EXTENSIONS, DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_UPLOAD_EXTENSIONS } from '@/lib/upload-limits';

export type WorkspaceResourceKind = 'video' | 'image' | 'audio' | 'document' | 'mg' | 'other';

export const RESOURCE_KIND_ICON: Record<WorkspaceResourceKind, LucideIcon> = {
  video: FileVideo,
  image: ImageIcon,
  audio: FileAudio,
  document: FileText,
  mg: FileVideo,
  other: FileIcon,
};

const EXTENSION_ICON: Record<string, LucideIcon> = {
  json: FileJson, csv: FileSpreadsheet, xls: FileSpreadsheet, xlsx: FileSpreadsheet, srt: Subtitles, vtt: Subtitles,
  zip: FileArchive, rar: FileArchive, '7z': FileArchive, tar: FileArchive, gz: FileArchive,
  js: FileCode, ts: FileCode, tsx: FileCode, html: FileCode, css: FileCode, py: FileCode,
};

/** A file's extension (no dot, lower case); empty when it has none. */
export function fileExtension(name: string): string {
  const cut = name.lastIndexOf('.');
  return cut <= 0 ? '' : name.slice(cut + 1).toLowerCase();
}

export function resourceIcon(file: { name: string; kind: string }): LucideIcon {
  return EXTENSION_ICON[fileExtension(file.name)] ?? RESOURCE_KIND_ICON[file.kind as WorkspaceResourceKind] ?? RESOURCE_KIND_ICON.other;
}

/** Which kind a file is, by its extension first (Finder often reports a .mov as octet-stream), then its type. */
export function attachmentKind(file: { name: string; mediaType?: string }): WorkspaceResourceKind {
  const ext = fileExtension(file.name);
  if (VIDEO_UPLOAD_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_UPLOAD_EXTENSIONS.has(ext)) return 'audio';
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  const mime = (file.mediaType ?? '').toLowerCase().split(';')[0]!.trim();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || mime.startsWith('text/')) return 'document';
  return 'other';
}

/** The icon for a file in the composer or a message. */
export function attachmentIcon(file: { name: string; mediaType?: string }): LucideIcon {
  return resourceIcon({ name: file.name, kind: attachmentKind(file) });
}
