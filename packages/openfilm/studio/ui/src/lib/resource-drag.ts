/**
 * A project file dragged from the media pane, while it is being dragged.
 *
 * A type of our own rather than `text/plain`: a bare path cannot be told apart from text dragged in from elsewhere.
 * `text/plain` is written too, so dropping into another app leaves the path.
 *
 * While a drag passes over the timeline the browser hides the data (protected mode: types only), yet the timeline's
 * preview needs the file's length, name and kind. So the file being dragged is also kept here (`peekResourceDrag`);
 * the drop itself still reads the data (`readResourceDragData`).
 *
 * Media pane: on `dragstart` call `setResourceDragData(e.dataTransfer, file)`, on `dragend` `clearResourceDrag()`.
 */
export const RESOURCE_DRAG_TYPE = 'application/x-openfilm-resource';

export type ResourceKind = 'video' | 'image' | 'audio' | 'mg' | 'other';

/** The payload: a project file as the media pane lists it, serialized as JSON under RESOURCE_DRAG_TYPE. */
export interface ResourceDragItem {
  /** Project-relative path; what film.html's `src` gets. */
  path: string;
  /** Display name (the file name when absent). */
  name: string;
  kind: ResourceKind;
  /** Folder within the project ('' at the root). */
  dir?: string;
  size?: number;
  mtimeMs?: number;
  /** Probed media length; without it a drop is drawn and written with a default length. */
  durationMs?: number;
  /** A web page without a duration (no end): written with a length of its own, as a still. */
  endless?: boolean;
  w?: number;
  h?: number;
  fps?: number;
}

const KINDS: readonly ResourceKind[] = ['video', 'image', 'audio', 'mg', 'other'];

let liveResourceDrag: ResourceDragItem | null = null;

export function peekResourceDrag(): ResourceDragItem | null {
  return liveResourceDrag;
}

export function clearResourceDrag(): void {
  liveResourceDrag = null;
}

export function setResourceDragData(
  data: Pick<DataTransfer, 'setData'>,
  file: ResourceDragItem,
): void {
  const item = normalizeResourceDragItem(file);
  liveResourceDrag = item;
  if (!item) return;
  data.setData(RESOURCE_DRAG_TYPE, JSON.stringify(item));
  data.setData('text/plain', item.path);
}

/**
 * The file back on drop. Anything unreadable or of the wrong shape is ignored: drag data comes from outside and may
 * not be what we put there.
 */
export function readResourceDragData(
  data: Pick<DataTransfer, 'getData'>,
): ResourceDragItem | null {
  let raw = '';
  try {
    raw = data.getData(RESOURCE_DRAG_TYPE);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return normalizeResourceDragItem(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeResourceDragItem(value: unknown): ResourceDragItem | null {
  const item = value as Partial<ResourceDragItem> | null;
  if (!item || typeof item !== 'object' || typeof item.path !== 'string' || !item.path) return null;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const durationMs = num(item.durationMs);
  const w = num(item.w);
  const h = num(item.h);
  const fps = num(item.fps);
  return {
    path: item.path,
    name: typeof item.name === 'string' && item.name ? item.name : item.path.slice(item.path.lastIndexOf('/') + 1),
    kind: KINDS.includes(item.kind as ResourceKind) ? item.kind as ResourceKind : 'other',
    dir: typeof item.dir === 'string' ? item.dir : '',
    size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : 0,
    mtimeMs: typeof item.mtimeMs === 'number' && Number.isFinite(item.mtimeMs) ? item.mtimeMs : 0,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(item.endless === true ? { endless: true } : {}),
    ...(w === undefined ? {} : { w }),
    ...(h === undefined ? {} : { h }),
    ...(fps === undefined ? {} : { fps }),
  };
}

/**
 * Whether a drag carries files from the computer (Finder, the desktop): not one of the media pane's own, which may
 * carry a file too (a picture dragged from a tile).
 */
export function isComputerFileDrag(data: Pick<DataTransfer, 'types'>): boolean {
  return data.types.includes('Files') && !data.types.includes(RESOURCE_DRAG_TYPE);
}

/**
 * A stand-in for the first file of a drag from the computer, while it is dragged: the browser shows only the files'
 * types until the drop, so it is named by kind and has no length yet (the preview draws a default one). A type the
 * browser does not know (an .mkv, often) is taken for a video; null when its type says it is no media.
 */
export function computerFileDragItem(data: Pick<DataTransfer, 'items'>, name: string): ResourceDragItem | null {
  const type = [...(data.items ?? [])].find((it) => it.kind === 'file')?.type ?? '';
  const kind: ResourceKind | null = type.startsWith('video/') || type === '' ? 'video'
    : type.startsWith('image/') ? 'image' : type.startsWith('audio/') ? 'audio' : null;
  if (!kind) return null;
  /* the ending says what a clip is (a still has a length of its own): one of the kind's own */
  const path = `assets/${name}.${kind === 'video' ? 'mp4' : kind === 'image' ? 'png' : 'mp3'}`;
  return { path, name, kind, dir: '', size: 0, mtimeMs: 0 };
}
