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
 * Media pane: on `dragstart` call `setResourceDragData(e.dataTransfer, file)` (and `dragPicture(e)`), on `dragend`
 * `clearResourceDrag()`.
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
  /** A web page that sets no size of its own (its `w` × `h` is the size it is shown at alone). */
  reflows?: boolean;
  w?: number;
  h?: number;
  fps?: number;
  /** A saved thing (lib/saved), not a file of the project: its files are brought in as it lands. */
  saved?: string;
  /** Not a clip but what goes on one (a look, lib/library) or on a cut (a fade): dropped there, not on a track. */
  apply?: 'look' | 'fade';
  /** A line of the library's words: what it says once put in (the timeline's preview of it says it too). */
  words?: string;
  /** A line of the library's words in a look of the person's own (a saved preset): its CSS variables. */
  vars?: Record<string, string>;
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

/* ── the picture that follows the pointer ──
   The browser's own drag picture cannot be hidden or changed once a drag has begun, yet over the timeline the thing
   should become the clip it will be (the timeline draws it where it lands). So the browser is given a blank one and the
   dragged element's copy follows the pointer here, hidden while the timeline shows the clip instead. */

let picture: HTMLElement | null = null;
const BLANK = typeof Image === 'undefined' ? null : Object.assign(new Image(), { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' });

const follow = (e: DragEvent) => {
  /* the last dragover of some browsers says 0, 0 */
  if (picture && (e.clientX || e.clientY)) picture.style.translate = `${e.clientX}px ${e.clientY}px`;
};
/* let go where it came from (a panel marked `data-drag-home`: the library, the media pane), and nothing there takes
   it: taken as a drop that does nothing, so it ends at once. Refused, the browser would first fly its picture back to
   where the drag began, and the drag would end only after that */
const atHome = (e: Event) => e.target instanceof Element && Boolean(e.target.closest('[data-drag-home]'));
const home = (e: DragEvent) => {
  if (!picture || e.defaultPrevented || !atHome(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed.includes('move') ? 'move' : 'copy';
};
const dropPicture = (e?: Event) => {
  /* let go at home: nothing done there (not its path typed into a field it was let go on) */
  if (e?.type === 'drop' && atHome(e)) e.preventDefault();
  picture?.remove();
  picture = null;
  document.removeEventListener('dragover', follow, true);
  document.removeEventListener('dragover', home);
  document.removeEventListener('dragend', dropPicture, true);
  document.removeEventListener('drop', dropPicture, true);
};

/**
 * At `dragstart`: the element dragged (`e.currentTarget`) follows the pointer as it was grabbed, a little see-through,
 * in place of the browser's picture.
 */
export function dragPicture(e: { currentTarget: EventTarget; dataTransfer: DataTransfer; clientX: number; clientY: number }): void {
  const from = e.currentTarget as HTMLElement;
  if (!BLANK || !(from instanceof HTMLElement)) return;
  dropPicture();
  const box = from.getBoundingClientRect();
  const copy = from.cloneNode(true) as HTMLElement;
  copy.style.cssText = `position:absolute;left:${box.left - e.clientX}px;top:${box.top - e.clientY}px;width:${box.width}px;height:${box.height}px;margin:0`;
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:.85;translate:${e.clientX}px ${e.clientY}px`;
  holder.append(copy);
  document.body.append(holder);
  picture = holder;
  e.dataTransfer.setDragImage(BLANK, 0, 0);
  document.addEventListener('dragover', follow, true);
  /* after the page's own handlers (bubbling): a place that takes the drop decides first */
  document.addEventListener('dragover', home);
  document.addEventListener('dragend', dropPicture, true);
  document.addEventListener('drop', dropPicture, true);
}

/** While the timeline draws the dragged thing as the clip it will be: its picture is not shown. */
export function hideDragPicture(hidden: boolean): void {
  if (picture) picture.style.visibility = hidden ? 'hidden' : '';
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
    ...(item.reflows === true ? { reflows: true } : {}),
    ...(w === undefined ? {} : { w }),
    ...(h === undefined ? {} : { h }),
    ...(fps === undefined ? {} : { fps }),
    ...(typeof item.saved === 'string' && item.saved ? { saved: item.saved } : {}),
    ...(item.apply === 'look' || item.apply === 'fade' ? { apply: item.apply } : {}),
    ...(typeof item.words === 'string' && item.words ? { words: item.words } : {}),
    ...(item.vars && typeof item.vars === 'object' && Object.values(item.vars).every((v) => typeof v === 'string') ? { vars: item.vars } : {}),
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
