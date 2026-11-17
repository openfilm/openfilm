/** For the tests: the arrangements of OpenFilm's own plugins, read from their openfilm.json as Studio reads them. */
import { readFileSync } from 'node:fs';
import { readBlocks } from '../../../../src/plugin-blocks.mjs';
import { arrangementSpecs } from './blocks.ts';
import { defaultWorkspace, type ArrangementSpec } from './workspaces.ts';

const manifest = (id: string) => JSON.parse(readFileSync(new URL(`../../../../plugins/${id}/openfilm.json`, import.meta.url), 'utf8')) as { workbench: string; blocks?: unknown };
export const SPECS = arrangementSpecs(['edit', 'canvas'].map((id) => { const m = manifest(id); return { workbench: m.workbench, blocks: readBlocks(m.blocks) }; }));
export const EDIT: ArrangementSpec = SPECS.get('edit')!;
export const CANVAS: ArrangementSpec = SPECS.get('canvas')!;
export const DEFAULT_WORKSPACE = defaultWorkspace(EDIT);
export const DEFAULT_CANVAS_WORKSPACE = defaultWorkspace(CANVAS);
/** The edit's arrangement as earlier versions kept it, the edit's panes as fields of their own. */
export const OLDER_EDIT = {
  mode: 'edit', tree: null, assets: false, layers: false, timeline: true, inspector: true, chat: true, libraryDock: 'chat', chatSide: 'left', layersSide: 'left',
  inspectorSide: 'right', timelineEdge: 'bottom', assetsWidth: 320, libraryHeight: 280, layersWidth: 240, inspectorWidth: 360, timelineHeight: null, chatWidth: 420,
} as const;
export const OLDER_CANVAS = { ...OLDER_EDIT, mode: 'canvas', timeline: false, inspector: false } as const;
