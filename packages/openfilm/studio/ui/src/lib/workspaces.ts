import { readDockTree, type DockNode } from './workspace-dock.ts';
/** Workspace preferences are independent for the edit and canvas. Preferred dimensions survive smaller windows. */
export type WorkspaceMode = 'edit' | 'canvas';
export type LibraryDock = 'left' | 'right' | 'bottom' | 'chat';
export type PanelSide = 'left' | 'right';
export interface WorkspaceLayout {
  mode: WorkspaceMode;
  tree: DockNode | null;
  assets: boolean; layers: boolean; timeline: boolean; inspector: boolean; chat: boolean;
  libraryDock: LibraryDock;
  chatSide: PanelSide;
  layersSide: PanelSide;
  inspectorSide: PanelSide;
  timelineEdge: 'top' | 'bottom';
  assetsWidth: number; libraryHeight: number; layersWidth: number; inspectorWidth: number;
  timelineHeight: number | null; chatWidth: number;
}
export interface SavedWorkspace { id: string; name: string; layout: WorkspaceLayout }
export const WORKSPACES_KEY = 'openfilm.workspaces.v2';
export const LEGACY_WORKSPACES_KEY = 'openfilm.workspaces.v1';
export const CURRENT_WORKSPACE_KEY = 'openfilm.workspace.current.v2';
export const MAX_WORKSPACES = 24;
export const DEFAULT_WORKSPACE: WorkspaceLayout = {
  mode: 'edit', tree: null, assets: false, layers: false, timeline: true, inspector: true, chat: true,
  libraryDock: 'chat', chatSide: 'left', layersSide: 'left', inspectorSide: 'right', timelineEdge: 'bottom',
  assetsWidth: 320, libraryHeight: 280, layersWidth: 240, inspectorWidth: 360, timelineHeight: null, chatWidth: 420,
};
export const DEFAULT_CANVAS_WORKSPACE: WorkspaceLayout = {
  ...DEFAULT_WORKSPACE, mode: 'canvas', chatSide: 'left', timeline: false, inspector: false,
};
export const defaultWorkspace = (mode: WorkspaceMode): WorkspaceLayout => ({ ...(mode === 'canvas' ? DEFAULT_CANVAS_WORKSPACE : DEFAULT_WORKSPACE) });
const bound = (v: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, v)));
const cleanName = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 40);

/** Legacy visibility/size layouts remain valid; new fields are validated before reaching CSS or native placement. */
export function readWorkspaceLayout(value: unknown): WorkspaceLayout | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const d = value as Record<string, unknown>;
  for (const k of ['assets', 'layers', 'timeline', 'inspector', 'chat']) if (typeof d[k] !== 'boolean') return null;
  for (const k of ['assetsWidth', 'layersWidth', 'inspectorWidth', 'chatWidth']) if (typeof d[k] !== 'number' || !Number.isFinite(d[k])) return null;
  if (d.timelineHeight !== null && (typeof d.timelineHeight !== 'number' || !Number.isFinite(d.timelineHeight))) return null;
  for (const [key, choices] of Object.entries({ mode: ['edit', 'canvas'], libraryDock: ['left', 'right', 'bottom', 'chat'], chatSide: ['left', 'right'], layersSide: ['left', 'right'], inspectorSide: ['left', 'right'], timelineEdge: ['top', 'bottom'] })) {
    if (d[key] !== undefined && !choices.includes(d[key] as string)) return null;
  }
  if (d.libraryHeight !== undefined && (typeof d.libraryHeight !== 'number' || !Number.isFinite(d.libraryHeight))) return null;
  const mode = (d.mode as WorkspaceMode) ?? 'edit';
  const tree = d.tree == null ? null : readDockTree(d.tree, mode);
  if (d.tree != null && !tree) return null;
  return {
    tree, mode: (d.mode as WorkspaceMode) ?? 'edit',
    assets: d.assets as boolean, layers: d.layers as boolean, timeline: d.timeline as boolean, inspector: d.inspector as boolean, chat: d.chat as boolean,
    libraryDock: (d.libraryDock as LibraryDock) ?? 'chat', chatSide: (d.chatSide as PanelSide) ?? 'left',
    layersSide: (d.layersSide as PanelSide) ?? 'left', inspectorSide: (d.inspectorSide as PanelSide) ?? 'right', timelineEdge: (d.timelineEdge as 'top' | 'bottom') ?? 'bottom',
    assetsWidth: bound(d.assetsWidth as number, 220, 800), libraryHeight: bound((d.libraryHeight as number) ?? 280, 160, 900),
    layersWidth: bound(d.layersWidth as number, 180, 600), inspectorWidth: bound(d.inspectorWidth as number, 280, 800), chatWidth: bound(d.chatWidth as number, 340, 800),
    timelineHeight: d.timelineHeight === null ? null : bound(d.timelineHeight as number, 104, 1600),
  };
}
export function parseWorkspaces(raw: string | null): SavedWorkspace[] {
  try {
    const stored = JSON.parse(raw ?? 'null');
    if (![1, 2].includes(stored?.version) || !Array.isArray(stored.layouts)) return [];
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
export const serializeWorkspaces = (rows: readonly SavedWorkspace[]) => JSON.stringify({ version: 2, layouts: rows.slice(0, MAX_WORKSPACES) });
export function sameWorkspace(a: WorkspaceLayout, b: WorkspaceLayout, hasChat: boolean): boolean {
  const editOnly: Array<keyof WorkspaceLayout> = ['layers', 'timeline', 'inspector', 'layersWidth', 'inspectorWidth', 'timelineHeight', 'layersSide', 'inspectorSide', 'timelineEdge'];
  return (Object.keys(a) as Array<keyof WorkspaceLayout>).every(key =>
    !hasChat && ['chat', 'chatWidth', 'chatSide'].includes(key) || a.mode === 'canvas' && editOnly.includes(key) || (key === 'tree' ? JSON.stringify(a.tree) === JSON.stringify(b.tree) : a[key] === b[key]));
}
export function keepWorkspace(rows: readonly SavedWorkspace[], entry: SavedWorkspace): SavedWorkspace[] | null {
  const name = cleanName(entry.name), layout = readWorkspaceLayout(entry.layout);
  if (!name || !layout || (!rows.some(row => row.id === entry.id) && rows.length >= MAX_WORKSPACES)) return null;
  if (rows.some(row => row.id !== entry.id && row.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return null;
  const next = { ...entry, name, layout };
  return rows.some(row => row.id === entry.id) ? rows.map(row => row.id === entry.id ? next : row) : [...rows, next];
}
export function workspacePresets(mode: WorkspaceMode): Array<{ id: string; layout: WorkspaceLayout }> {
  return [
    { id: 'standard', layout: defaultWorkspace(mode) },
    { id: 'library', layout: { ...defaultWorkspace(mode), libraryDock: 'bottom', assets: true, libraryHeight: 280, chat: false, inspector: false } },
    { id: 'focus', layout: { ...defaultWorkspace(mode), assets: false, chat: false, layers: false, timeline: false, inspector: false } },
  ];
}
export type WorkspaceProfiles = Record<WorkspaceMode, WorkspaceLayout>;
export function readWorkspaceProfiles(storage: Pick<Storage, 'getItem'>): WorkspaceProfiles {
  const defaults = { edit: defaultWorkspace('edit'), canvas: defaultWorkspace('canvas') };
  try {
    const raw = JSON.parse(storage.getItem(CURRENT_WORKSPACE_KEY) ?? 'null');
    if (raw?.version === 2) return { edit: readWorkspaceLayout({ ...raw.edit, mode:'edit' }) ?? defaults.edit, canvas: readWorkspaceLayout({ ...raw.canvas, mode:'canvas' }) ?? defaults.canvas };
    const flag = (key: string, fallback: boolean) => { const v = storage.getItem(`openfilm.project.${key}`); return v === null ? fallback : v !== '0'; };
    const size = (key: string, fallback: number) => { const n = Number(storage.getItem(`openfilm.project.${key}`)); return Number.isFinite(n) && n > 0 ? n : fallback; };
    const legacy = readWorkspaceLayout({ ...defaults.edit, assets: flag('assets', false), layers: flag('layers', false), timeline: flag('timeline', true), inspector: flag('inspector', true),
      assetsWidth: size('assetsW', 320), layersWidth: size('layersW', 240), inspectorWidth: size('inspectorW', 360), timelineHeight: storage.getItem('openfilm.project.timelineH') ? size('timelineH', 200) : null });
    return { ...defaults, edit: legacy ?? defaults.edit };
  } catch { return defaults; }
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
  const workHeight = layout.mode === 'edit' && layout.timeline ? 360 : 240;
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
