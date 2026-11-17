import { readDockTree, type DockNode } from './workspace-dock.ts';
/**
 * How the project's page is arranged, one arrangement for each workbench laid out in it (its name: `edit`, `canvas`, a
 * plugin's). An arrangement holds the page's own blocks (the app's chat, the library) and the blocks its workbench
 * declares (its plugin's openfilm.json `blocks`): the edit's viewer, layers, inspector and timeline, the canvas's board,
 * and blocks of another plugin's it borrows (a colour workbench shows the edit's viewer and timeline). Preferred
 * dimensions survive smaller windows.
 */
export type WorkspaceMode = string;
export type LibraryDock = 'left' | 'right' | 'bottom' | 'chat';
export type PanelSide = 'left' | 'right';
/** Where a block sits where the panels are docked: the main block, beside it, or above or below it. */
export type BlockEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';
/** A block as an arrangement has it: shown or not, its edge, and its size (width beside the main block, height above or
 *  below it; null: as its plugin fits it). */
export interface BlockPlace { open: boolean; edge: BlockEdge; size: number | null }
export interface WorkspaceLayout {
  mode: WorkspaceMode;
  tree: DockNode | null;
  assets: boolean; chat: boolean;
  libraryDock: LibraryDock;
  chatSide: PanelSide;
  assetsWidth: number; libraryHeight: number; chatWidth: number;
  /** The workbench's blocks, by key: a block's id for its workbench's own, `owner:id` for another workbench's. */
  blocks: Readonly<Record<string, BlockPlace>>;
}
/**
 * A block an arrangement is made of, as its workbench declares it: `key` as the arrangement names it, the workbench
 * that draws it (`owner`) and its id there, its words by language, its edge and size as it first opens (`size` null:
 * its plugin fits it), whether it first opens, the smallest it is drawn where panels float (`min`: width, height), and
 * the sizes a person may give it (`range`).
 */
export interface BlockSpec {
  key: string; owner: string; id: string; title?: Readonly<Record<string, string>>;
  edge: BlockEdge; size: number | null; open: boolean; min: readonly [number, number]; range: readonly [number, number];
}
/** An arrangement's blocks, as declared: one is the main block (`center`). */
export interface ArrangementSpec { name: WorkspaceMode; blocks: readonly BlockSpec[] }
export interface SavedWorkspace { id: string; name: string; layout: WorkspaceLayout }
export const WORKSPACES_KEY = 'openfilm.workspaces.v3';
/** Named layouts kept by earlier versions, read (never written) while there is none of this version's. */
export const OLDER_WORKSPACES_KEY = 'openfilm.workspaces.v2';
export const LEGACY_WORKSPACES_KEY = 'openfilm.workspaces.v1';
export const CURRENT_WORKSPACE_KEY = 'openfilm.workspace.current.v3';
/** The arrangements in use as an earlier version kept them (the edit's and the canvas's), read until this version keeps its own. */
export const OLDER_CURRENT_WORKSPACE_KEY = 'openfilm.workspace.current.v2';
export const MAX_WORKSPACES = 24;
/** The page's own blocks as an arrangement first has them. */
const PAGE_DEFAULTS = {
  tree: null, assets: false, chat: true, libraryDock: 'chat' as LibraryDock, chatSide: 'left' as PanelSide,
  assetsWidth: 320, libraryHeight: 280, chatWidth: 420,
};
const placeOf = (block: BlockSpec): BlockPlace => ({ open: block.open, edge: block.edge, size: block.size });
/** An arrangement as it first is: the page's blocks, and the workbench's as it declares them. */
export const defaultWorkspace = (spec: ArrangementSpec): WorkspaceLayout => ({
  mode: spec.name, ...PAGE_DEFAULTS, blocks: Object.fromEntries(spec.blocks.map((b) => [b.key, placeOf(b)])),
});
/** The main block of an arrangement (`center`; the first, when none says so). */
export const centerOf = (spec: ArrangementSpec): BlockSpec | undefined => spec.blocks.find((b) => b.edge === 'center') ?? spec.blocks[0];
const bound = (v: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, v)));
const cleanName = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 40);
const EDGES: readonly BlockEdge[] = ['left', 'right', 'top', 'bottom', 'center'];
const KEY = /^(?:[a-z][a-z0-9-]{0,31}:)?[a-z][a-z0-9-]{0,31}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,127})*$/;

function readPlace(value: unknown): BlockPlace | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.open !== 'boolean' || !EDGES.includes(p.edge as BlockEdge)) return null;
  if (p.size !== null && (typeof p.size !== 'number' || !Number.isFinite(p.size))) return null;
  return { open: p.open, edge: p.edge as BlockEdge, size: p.size === null ? null : bound(p.size as number, 1, 4000) };
}

/** An arrangement as kept, validated before it reaches CSS or native placement; null when it is not one. */
export function readWorkspaceLayout(value: unknown): WorkspaceLayout | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const d = value as Record<string, unknown>;
  if (!('blocks' in d)) return readOlderLayout(d);
  if (typeof d.mode !== 'string' || !NAME.test(d.mode)) return null;
  for (const k of ['assets', 'chat']) if (typeof d[k] !== 'boolean') return null;
  for (const k of ['assetsWidth', 'libraryHeight', 'chatWidth']) if (typeof d[k] !== 'number' || !Number.isFinite(d[k])) return null;
  for (const [key, choices] of Object.entries({ libraryDock: ['left', 'right', 'bottom', 'chat'], chatSide: ['left', 'right'] })) if (!choices.includes(d[key] as string)) return null;
  if (!d.blocks || typeof d.blocks !== 'object' || Array.isArray(d.blocks)) return null;
  const blocks: Record<string, BlockPlace> = {};
  for (const [key, place] of Object.entries(d.blocks as Record<string, unknown>).slice(0, 32)) {
    const read = KEY.test(key) && !['chat', 'library'].includes(key) ? readPlace(place) : null;
    if (!read) return null;
    blocks[key] = read;
  }
  const tree = d.tree == null ? null : readDockTree(d.tree);
  if (d.tree != null && !tree) return null;
  return {
    mode: d.mode, tree, assets: d.assets as boolean, chat: d.chat as boolean,
    libraryDock: d.libraryDock as LibraryDock, chatSide: d.chatSide as PanelSide,
    assetsWidth: bound(d.assetsWidth as number, 220, 800), libraryHeight: bound(d.libraryHeight as number, 160, 900), chatWidth: bound(d.chatWidth as number, 340, 800),
    blocks,
  };
}

/**
 * An arrangement as earlier versions kept it (the edit's or the canvas's, with the edit's panes as fields of their
 * own), as this version keeps it; null when it is not one.
 */
function readOlderLayout(d: Record<string, unknown>): WorkspaceLayout | null {
  for (const k of ['assets', 'layers', 'timeline', 'inspector', 'chat']) if (typeof d[k] !== 'boolean') return null;
  for (const k of ['assetsWidth', 'layersWidth', 'inspectorWidth', 'chatWidth']) if (typeof d[k] !== 'number' || !Number.isFinite(d[k])) return null;
  if (d.timelineHeight !== null && (typeof d.timelineHeight !== 'number' || !Number.isFinite(d.timelineHeight))) return null;
  for (const [key, choices] of Object.entries({ mode: ['edit', 'canvas'], libraryDock: ['left', 'right', 'bottom', 'chat'], chatSide: ['left', 'right'], layersSide: ['left', 'right'], inspectorSide: ['left', 'right'], timelineEdge: ['top', 'bottom'] })) {
    if (d[key] !== undefined && !choices.includes(d[key] as string)) return null;
  }
  if (d.libraryHeight !== undefined && (typeof d.libraryHeight !== 'number' || !Number.isFinite(d.libraryHeight))) return null;
  const mode = (d.mode as 'edit' | 'canvas' | undefined) ?? 'edit';
  const tree = d.tree == null ? null : readDockTree(d.tree);
  if (d.tree != null && (!tree || !sameLeaves(tree, mode === 'canvas' ? ['canvas', 'chat', 'library'] : ['viewer', 'chat', 'library', 'layers', 'inspector', 'timeline']))) return null;
  const blocks: Record<string, BlockPlace> = mode === 'canvas' ? { canvas: { open: true, edge: 'center', size: null } } : {
    viewer: { open: true, edge: 'center', size: null },
    layers: { open: d.layers as boolean, edge: (d.layersSide as PanelSide) ?? 'left', size: bound(d.layersWidth as number, 180, 600) },
    inspector: { open: d.inspector as boolean, edge: (d.inspectorSide as PanelSide) ?? 'right', size: bound(d.inspectorWidth as number, 280, 800) },
    timeline: { open: d.timeline as boolean, edge: (d.timelineEdge as 'top' | 'bottom') ?? 'bottom', size: d.timelineHeight === null ? null : bound(d.timelineHeight as number, 104, 1600) },
  };
  return {
    mode, tree, assets: d.assets as boolean, chat: d.chat as boolean,
    libraryDock: (d.libraryDock as LibraryDock) ?? 'chat', chatSide: (d.chatSide as PanelSide) ?? 'left',
    assetsWidth: bound(d.assetsWidth as number, 220, 800), libraryHeight: bound((d.libraryHeight as number) ?? 280, 160, 900), chatWidth: bound(d.chatWidth as number, 340, 800),
    blocks,
  };
}

const leavesOf = (node: DockNode): string[] => ('panel' in node ? [node.panel] : [...leavesOf(node.first), ...leavesOf(node.second)]);
const sameLeaves = (tree: DockNode, keys: readonly string[]) => { const leaves = leavesOf(tree); return leaves.length === keys.length && keys.every((k) => leaves.includes(k)); };

/**
 * `layout` with every block `spec` declares (each block it does not have yet as declared), sizes within what each
 * block allows, and every block in its tree of splits (one missing goes beside the main block). Blocks it has that the
 * spec does not declare are kept, not drawn: a plugin turned off and on again finds them as they were. The same object
 * when nothing changed.
 */
export function normalizeLayout(layout: WorkspaceLayout, spec: ArrangementSpec): WorkspaceLayout {
  let blocks: Record<string, BlockPlace> | null = null;
  for (const block of spec.blocks) {
    const place = layout.blocks[block.key];
    const next = !place ? placeOf(block)
      : block.edge === 'center' ? (place.open && place.edge === 'center' ? place : { ...place, open: true, edge: 'center' as const })
        : place.edge === 'center' ? { ...place, edge: block.edge }
          : place.size !== null && (place.size < block.range[0] || place.size > block.range[1]) ? { ...place, size: bound(place.size, block.range[0], block.range[1]) } : place;
    if (next !== place) (blocks ??= { ...layout.blocks })[block.key] = next;
  }
  let tree = layout.tree;
  if (tree) {
    const leaves = leavesOf(tree);
    const center = centerOf(spec)?.key;
    for (const key of ['chat', 'library', ...spec.blocks.map((b) => b.key)]) {
      if (leaves.includes(key)) continue;
      const beside = (node: DockNode): DockNode => ('panel' in node ? (node.panel === center ? { axis: 'x', ratio: 0.7, first: node, second: { panel: key } } : node) : { ...node, first: beside(node.first), second: beside(node.second) });
      tree = center && center !== key && leaves.includes(center) ? beside(tree) : { axis: 'x', ratio: 0.7, first: tree, second: { panel: key } };
      leaves.push(key);
    }
  }
  return blocks || tree !== layout.tree ? { ...layout, ...(blocks ? { blocks } : {}), tree } : layout;
}

export function parseWorkspaces(raw: string | null): SavedWorkspace[] {
  try {
    const stored = JSON.parse(raw ?? 'null');
    if (![1, 2, 3].includes(stored?.version) || !Array.isArray(stored.layouts)) return [];
    const result: SavedWorkspace[] = [];
    for (const entry of stored.layouts.slice(0, 100)) {
      if (typeof entry?.id !== 'string' || !entry.id || typeof entry.name !== 'string') continue;
      const id = entry.id.slice(0, 128), name = cleanName(entry.name), layout = readWorkspaceLayout(entry.layout);
      if (name && layout && !result.some(row => row.id === id || row.name.toLocaleLowerCase() === name.toLocaleLowerCase())) result.push({ id, name, layout });
      if (result.length === MAX_WORKSPACES) break;
    }
    return result;
  } catch { return []; }
}
/** The named layouts kept in this browser: this version's, or an earlier version's until this one keeps its own. */
export const readSavedWorkspaces = (storage: Pick<Storage, 'getItem'>): SavedWorkspace[] =>
  parseWorkspaces(storage.getItem(WORKSPACES_KEY) ?? storage.getItem(OLDER_WORKSPACES_KEY) ?? storage.getItem(LEGACY_WORKSPACES_KEY));
export const serializeWorkspaces = (rows: readonly SavedWorkspace[]) => JSON.stringify({ version: 3, layouts: rows.slice(0, MAX_WORKSPACES) });
/** Whether two arrangements are the same, the chat's fields left out where there is no chat, and of the workbench's blocks those `spec` declares. */
export function sameWorkspace(a: WorkspaceLayout, b: WorkspaceLayout, hasChat: boolean, spec?: ArrangementSpec): boolean {
  if (a.mode !== b.mode) return false;
  const page: Array<keyof WorkspaceLayout> = ['assets', 'chat', 'libraryDock', 'chatSide', 'assetsWidth', 'libraryHeight', 'chatWidth'];
  if (!page.every((key) => (!hasChat && ['chat', 'chatWidth', 'chatSide'].includes(key)) || a[key] === b[key])) return false;
  if (JSON.stringify(a.tree) !== JSON.stringify(b.tree)) return false;
  const keys = spec ? spec.blocks.map((block) => block.key) : [...new Set([...Object.keys(a.blocks), ...Object.keys(b.blocks)])];
  return keys.every((key) => JSON.stringify(a.blocks[key] ?? null) === JSON.stringify(b.blocks[key] ?? null));
}
export function keepWorkspace(rows: readonly SavedWorkspace[], entry: SavedWorkspace): SavedWorkspace[] | null {
  const name = cleanName(entry.name), layout = readWorkspaceLayout(entry.layout);
  if (!name || !layout || (!rows.some(row => row.id === entry.id) && rows.length >= MAX_WORKSPACES)) return null;
  if (rows.some(row => row.id !== entry.id && row.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return null;
  const next = { ...entry, name, layout };
  return rows.some(row => row.id === entry.id) ? rows.map(row => row.id === entry.id ? next : row) : [...rows, next];
}
/** The arrangement with the blocks `keep` says shown (by spec), the others hidden; the main block always shown. */
/**
 * The arrangements to pick from, as each editor's work wants them: always its own (as declared) and Focus (the editor
 * alone, no chat and no library). The edit adds the library beside the work (Library) and its layers opened for fine
 * work (Detail); the canvas adds the library beside the board; Screening and Color, whose work takes no material from
 * the library, have the two only.
 */
export function workspacePresets(spec: ArrangementSpec): Array<{ id: string; layout: WorkspaceLayout }> {
  const standard = defaultWorkspace(spec);
  const focus = { id: 'focus', layout: { ...standard, assets: false, chat: false } };
  const library = { id: 'library', layout: { ...standard, libraryDock: 'left' as LibraryDock, assets: true, assetsWidth: 320 } };
  if (spec.name === 'edit') {
    const layers = standard.blocks.layers;
    const detail = layers ? [{ id: 'detail', layout: { ...standard, blocks: { ...standard.blocks, layers: { ...layers, open: true } } } }] : [];
    return [{ id: 'standard', layout: standard }, library, ...detail, focus];
  }
  if (spec.name === 'canvas') return [{ id: 'standard', layout: standard }, library, focus];
  return [{ id: 'standard', layout: standard }, focus];
}
/** The arrangements in use, by name, as kept (one not kept yet is its default, made once its blocks are known). */
export type WorkspaceProfiles = Readonly<Record<string, WorkspaceLayout>>;
export function readWorkspaceProfiles(storage: Pick<Storage, 'getItem'>): WorkspaceProfiles {
  try {
    const raw = JSON.parse(storage.getItem(CURRENT_WORKSPACE_KEY) ?? 'null');
    if (raw?.version === 3 && raw.arrangements && typeof raw.arrangements === 'object') {
      const out: Record<string, WorkspaceLayout> = {};
      for (const [name, value] of Object.entries(raw.arrangements as Record<string, unknown>).slice(0, 64)) {
        const layout = NAME.test(name) ? readWorkspaceLayout(value) : null;
        if (layout?.mode === name) out[name] = layout;
      }
      return out;
    }
    const older = JSON.parse(storage.getItem(OLDER_CURRENT_WORKSPACE_KEY) ?? 'null');
    if (older?.version === 2) {
      const out: Record<string, WorkspaceLayout> = {};
      for (const mode of ['edit', 'canvas'] as const) {
        const layout = older[mode] && typeof older[mode] === 'object' ? readOlderLayout({ ...older[mode], mode }) : null;
        if (layout) out[mode] = layout;
      }
      return out;
    }
    const kept = (key: string) => storage.getItem(`openfilm.project.${key}`);
    if (!['assets', 'layers', 'timeline', 'inspector', 'assetsW', 'layersW', 'inspectorW', 'timelineH'].some((key) => kept(key) !== null)) return {};
    const flag = (key: string, fallback: boolean) => { const v = kept(key); return v === null ? fallback : v !== '0'; };
    const size = (key: string, fallback: number) => { const n = Number(kept(key)); return Number.isFinite(n) && n > 0 ? n : fallback; };
    const legacy = readOlderLayout({ ...PAGE_DEFAULTS, mode: 'edit', layersSide: 'left', inspectorSide: 'right', timelineEdge: 'bottom',
      assets: flag('assets', false), layers: flag('layers', false), timeline: flag('timeline', true), inspector: flag('inspector', true),
      assetsWidth: size('assetsW', 320), layersWidth: size('layersW', 240), inspectorWidth: size('inspectorW', 360), timelineHeight: kept('timelineH') ? size('timelineH', 200) : null });
    return legacy ? { edit: legacy } : {};
  } catch { return {}; }
}
export const serializeProfiles = (profiles: WorkspaceProfiles) => JSON.stringify({ version: 3, arrangements: profiles });

/** The chat's width in the desktop shell, even when computing an inactive workspace's layout. */
export function workspaceChatWidth(width: number, preferred: number, min = 340, studioMin = 640): number {
  return Math.max(Math.min(preferred, width - studioMin), Math.min(min, width));
}

/** Geometry for the independent library. A narrow window temporarily uses the bottom without overwriting its dock. */
export function workspaceGeometry(layout: WorkspaceLayout, viewport: { width: number; height: number }, chatWidth = 0) {
  const width = Math.max(0, viewport.width), height = Math.max(0, viewport.height - 32);
  const chat = Math.max(0, Math.min(chatWidth, width));
  const left = layout.chat && layout.chatSide === 'left' ? chat : 0;
  const right = layout.chat && layout.chatSide === 'right' ? chat : 0;
  const room = Math.max(0, width - left - right);
  const requested = layout.libraryDock;
  const dock = (requested === 'left' || requested === 'right') && room < 580 ? 'bottom' : requested;
  const libraryWidth = Math.min(layout.assetsWidth, Math.max(0, room - 320));
  /* room kept for the workbench: more with a block open above or below its main one (the edit's timeline) */
  const workHeight = Object.values(layout.blocks).some((p) => p.open && (p.edge === 'top' || p.edge === 'bottom')) ? 360 : 240;
  const libraryHeight = Math.min(layout.libraryHeight, Math.max(0, height - workHeight));
  const independent = layout.assets && requested !== 'chat';
  const w = dock === 'bottom' ? room : libraryWidth;
  const h = dock === 'bottom' ? libraryHeight : height;
  return {
    dock, responsive: dock !== requested,
    library: { left: dock === 'right' ? width - right - w : left, top: dock === 'bottom' ? 32 + height - h : 32, width: w, height: h },
    inset: { left: left + (independent && dock === 'left' ? w + 1 : 0), right: right + (independent && dock === 'right' ? w + 1 : 0), bottom: independent && dock === 'bottom' ? h + 1 : 0 },
  };
}
