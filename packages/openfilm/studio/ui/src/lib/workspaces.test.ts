import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_WORKSPACE_KEY, OLDER_CURRENT_WORKSPACE_KEY, OLDER_WORKSPACES_KEY, WORKSPACES_KEY, defaultWorkspace, normalizeLayout, parseWorkspaces, readSavedWorkspaces, readWorkspaceLayout, readWorkspaceProfiles, sameWorkspace, serializeProfiles, serializeWorkspaces, keepWorkspace, MAX_WORKSPACES, workspaceGeometry, workspacePresets } from './workspaces.ts';
import { arrangementOf, arrangementSpecs } from './blocks.ts';
import { CANVAS, DEFAULT_CANVAS_WORKSPACE, DEFAULT_WORKSPACE, EDIT, OLDER_CANVAS, OLDER_EDIT, SPECS } from './test-arrangements.ts';

const storage = (entries: Record<string, string>) => ({ getItem: (key: string) => entries[key] ?? null });
const placed = (layout = DEFAULT_WORKSPACE, blocks: Record<string, object>) => ({ ...layout, blocks: { ...layout.blocks, ...Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, { ...layout.blocks[k], ...v }])) } });

test('the edit and the canvas declare their blocks; Motion is laid out as the edit is', () => {
  assert.deepEqual(EDIT.blocks.map((b) => [b.key, b.edge, b.size, b.open]), [['layers', 'left', 240, false], ['viewer', 'center', null, true], ['inspector', 'right', 360, true], ['timeline', 'bottom', null, true]]);
  assert.deepEqual(CANVAS.blocks.map((b) => [b.key, b.edge]), [['canvas', 'center']]);
  assert.equal(arrangementOf('motion', [...SPECS.values()].map((s) => ({ workbench: s.name, blocks: [] })).concat([{ workbench: 'motion', blocks: 'edit' } as never])), null, 'a named arrangement must be declared');
  const plugins = [{ workbench: 'edit', blocks: [{ id: 'viewer', edge: 'center' as const }, { id: 'timeline', edge: 'bottom' as const }] }, { workbench: 'motion', blocks: 'edit' }, { workbench: 'mine' }];
  assert.equal(arrangementOf('motion', plugins), 'edit');
  assert.equal(arrangementOf('mine', plugins), null);
});

test('a workbench arranges its own blocks and those it borrows from another, as that one declares them', () => {
  const specs = arrangementSpecs([
    { workbench: 'edit', blocks: [{ id: 'viewer', edge: 'center', min: [240, 220] }, { id: 'timeline', edge: 'bottom', min: [240, 104], range: [104, 1600] }] },
    { workbench: 'color', blocks: [{ id: 'scopes', edge: 'left', size: 300 }, { id: 'wheels', edge: 'bottom', size: 220 }, 'edit:viewer', 'edit:timeline', 'gone:thing'] },
  ]);
  const color = specs.get('color')!;
  assert.deepEqual(color.blocks.map((b) => [b.key, b.owner, b.id, b.edge]), [['scopes', 'color', 'scopes', 'left'], ['wheels', 'color', 'wheels', 'bottom'], ['edit:viewer', 'edit', 'viewer', 'center'], ['edit:timeline', 'edit', 'timeline', 'bottom']]);
  const layout = defaultWorkspace(color);
  assert.deepEqual(Object.keys(layout.blocks), ['scopes', 'wheels', 'edit:viewer', 'edit:timeline']);
  assert.ok(readWorkspaceLayout(JSON.parse(JSON.stringify(layout))));
});

test('portable workspaces round-trip mode, docks, hidden blocks, preferred sizes and automatic timeline fitting', () => {
  const edit = placed({ ...DEFAULT_WORKSPACE, libraryDock: 'bottom', chatSide: 'right', assetsWidth: 375, libraryHeight: 420, chatWidth: 520 }, { layers: { open: true, edge: 'right' }, inspector: { open: false, edge: 'left' }, timeline: { edge: 'top' } });
  const saved = [{ id: 'my-edit', name: 'My edit', layout: edit }, { id: 'board', name: 'Board', layout: DEFAULT_CANVAS_WORKSPACE }];
  assert.deepEqual(parseWorkspaces(serializeWorkspaces(saved)), saved);
  assert.equal(parseWorkspaces(serializeWorkspaces(saved))[0]!.layout.blocks.timeline!.size, null);
});

test('named layouts of earlier versions are read as this version keeps them; one malformed row does not lose others', () => {
  const { mode, libraryDock, libraryHeight, chatSide, layersSide, inspectorSide, timelineEdge, ...legacy } = OLDER_EDIT;
  const valid = { id: 'a', name: '  My   layout  ', layout: legacy };
  const raw = JSON.stringify({ version: 1, layouts: [{ id: 'broken', name: 'Broken', layout: {} }, valid, valid, { ...valid, id: 'blank', name: ' ' }, { ...valid, id: 'duplicate-name', name: 'MY LAYOUT' }] });
  const rows = parseWorkspaces(raw);
  assert.deepEqual(rows.map(row => [row.id, row.name]), [['a', 'My layout']]);
  assert.deepEqual(rows[0]!.layout, DEFAULT_WORKSPACE);
  const v2 = { version: 2, layouts: [{ id: 'e', name: 'Edit', layout: { ...OLDER_EDIT, layers: true, layersSide: 'right', inspectorWidth: 400, timelineHeight: 300 } }, { id: 'c', name: 'Board', layout: OLDER_CANVAS }] };
  const read = readSavedWorkspaces(storage({ [OLDER_WORKSPACES_KEY]: JSON.stringify(v2) }));
  assert.deepEqual(read[0]!.layout.blocks, { viewer: { open: true, edge: 'center', size: null }, layers: { open: true, edge: 'right', size: 240 }, inspector: { open: true, edge: 'right', size: 400 }, timeline: { open: true, edge: 'bottom', size: 300 } });
  assert.deepEqual(read[1]!.layout, DEFAULT_CANVAS_WORKSPACE);
  assert.equal(readSavedWorkspaces(storage({ [OLDER_WORKSPACES_KEY]: JSON.stringify(v2), [WORKSPACES_KEY]: serializeWorkspaces([]) })).length, 0, 'once this version keeps its own, the older are left as they are');
  const collision = parseWorkspaces(JSON.stringify({ version: 3, layouts: ['first','second'].map((name, i) => ({ id: 'x'.repeat(128) + i, name, layout: DEFAULT_WORKSPACE })) }));
  assert.equal(collision.length, 1, 'normalizing imported ids cannot produce duplicate React keys');
  for (const broken of [null, '{', '{}', '{"version":99,"layouts":[]}']) assert.deepEqual(parseWorkspaces(broken), []);
});

test('imported dimensions are bounded and invalid dimensions, docks or blocks are rejected', () => {
  const layout = readWorkspaceLayout({ ...DEFAULT_WORKSPACE, assetsWidth: -100, libraryHeight: 2000 });
  assert.equal(layout?.assetsWidth, 220);
  assert.equal(layout?.libraryHeight, 900);
  const sized = normalizeLayout(readWorkspaceLayout(placed(DEFAULT_WORKSPACE, { inspector: { size: 1e9 }, timeline: { size: -1 } }))!, EDIT);
  assert.equal(sized.blocks.inspector!.size, 800);
  assert.equal(sized.blocks.timeline!.size, 104);
  assert.equal(readWorkspaceLayout({ ...OLDER_EDIT, inspectorWidth: 1e9, timelineHeight: -1 })?.blocks.inspector!.size, 800, 'an older layout is bounded as it was');
  for (const patch of [{ chatWidth: NaN }, { libraryHeight: '400' }, { libraryDock: 'floating' }, { mode: 'Bad' }, { blocks: { viewer: { open: true, edge: 'middle', size: null } } }, { blocks: { 'Bad Key': { open: true, edge: 'left', size: 1 } } }, { blocks: { chat: { open: true, edge: 'left', size: 1 } } }]) assert.equal(readWorkspaceLayout({ ...DEFAULT_WORKSPACE, ...patch }), null);
  for (const patch of [{ timelineHeight: Infinity }, { mode: 'bad' }]) assert.equal(readWorkspaceLayout({ ...OLDER_EDIT, ...patch }), null);
});

test('an arrangement gains a block its workbench declares later, keeps one it no longer declares, and the main block always shows', () => {
  const { layers: _layers, ...rest } = DEFAULT_WORKSPACE.blocks;
  const kept = { ...DEFAULT_WORKSPACE, blocks: { ...rest, viewer: { open: false, edge: 'left' as const, size: 5 }, old: { open: true, edge: 'right' as const, size: 300 } }, tree: { axis: 'x' as const, ratio: 0.5, first: { panel: 'viewer' }, second: { panel: 'chat' } } };
  const next = normalizeLayout(kept, EDIT);
  assert.deepEqual(next.blocks.layers, { open: false, edge: 'left', size: 240 });
  assert.deepEqual(next.blocks.viewer, { open: true, edge: 'center', size: 5 });
  assert.deepEqual(next.blocks.old, { open: true, edge: 'right', size: 300 });
  const leaves = JSON.stringify(next.tree);
  for (const key of ['viewer', 'chat', 'library', 'layers', 'inspector', 'timeline']) assert.ok(leaves.includes(`"${key}"`), key);
  assert.equal(normalizeLayout(DEFAULT_WORKSPACE, EDIT), DEFAULT_WORKSPACE, 'unchanged: the same object');
});

test('the workspace bank holds 24 layouts, and permits renaming or updating at capacity without duplicate names', () => {
  let rows: import('./workspaces.ts').SavedWorkspace[] = [];
  for (let n = 0; n < MAX_WORKSPACES; n++) rows = keepWorkspace(rows, { id: String(n), name: `Layout ${n}`, layout: { ...DEFAULT_WORKSPACE } })!;
  assert.equal(rows.length, 24);
  assert.equal(keepWorkspace(rows, { id: 'extra', name: 'Extra', layout: DEFAULT_WORKSPACE }), null);
  const renamed = keepWorkspace(rows, { ...rows[1]!, name: ' My   edit ' })!;
  assert.equal(renamed[1]!.name, 'My edit');
  const updated = keepWorkspace(renamed, { ...renamed[1]!, layout: placed(DEFAULT_WORKSPACE, { layers: { open: true } }) })!;
  assert.equal(updated[1]!.layout.blocks.layers!.open, true);
  assert.equal(keepWorkspace(updated, { ...updated[1]!, name: updated[0]!.name.toUpperCase() }), null);
  assert.equal(parseWorkspaces(serializeWorkspaces([...rows, { id: 'extra', name: 'Extra', layout: DEFAULT_WORKSPACE }])).length, 24);
});

test('each arrangement is kept by its name and restores independently, recovering a broken one without losing the others', () => {
  const edit = { ...DEFAULT_WORKSPACE, libraryDock: 'right' as const, assetsWidth: 487 };
  const canvas = { ...DEFAULT_CANVAS_WORKSPACE, libraryDock: 'bottom' as const, libraryHeight: 333, chat: false };
  const color = { ...DEFAULT_WORKSPACE, mode: 'color', blocks: { scopes: { open: true, edge: 'left' as const, size: 300 } } };
  assert.deepEqual(readWorkspaceProfiles(storage({ [CURRENT_WORKSPACE_KEY]: serializeProfiles({ edit, canvas, color }) })), { edit, canvas, color });
  assert.deepEqual(readWorkspaceProfiles(storage({ [CURRENT_WORKSPACE_KEY]: JSON.stringify({ version: 3, arrangements: { edit: {}, canvas, other: { ...canvas } } }) })), { canvas }, 'a broken one, and one kept under another name, are left out');
  assert.deepEqual(readWorkspaceProfiles({ getItem: () => { throw new Error('Storage unavailable'); } }), {});
});

test('the arrangements an earlier version kept are read once, and its keys are left readable', () => {
  const older = { version: 2, edit: { ...OLDER_EDIT, layers: true, libraryDock: 'right', assetsWidth: 487 }, canvas: { ...OLDER_CANVAS, chat: false } };
  const read = readWorkspaceProfiles(storage({ [OLDER_CURRENT_WORKSPACE_KEY]: JSON.stringify(older) }));
  assert.deepEqual(read.edit, placed({ ...DEFAULT_WORKSPACE, libraryDock: 'right', assetsWidth: 487 }, { layers: { open: true } }));
  assert.deepEqual(read.canvas, { ...DEFAULT_CANVAS_WORKSPACE, chat: false });
  assert.deepEqual(readWorkspaceProfiles(storage({ [OLDER_CURRENT_WORKSPACE_KEY]: JSON.stringify(older), [CURRENT_WORKSPACE_KEY]: serializeProfiles({}) })), {}, 'this version\'s own wins');
});

test('legacy panel preferences migrate once into edit, leaving canvas defaults independent', () => {
  const result = readWorkspaceProfiles(storage({ 'openfilm.project.layers': '1', 'openfilm.project.inspector': '0', 'openfilm.project.layersW': '300', 'openfilm.project.timelineH': '456' }));
  assert.deepEqual(result.edit!.blocks.layers, { open: true, edge: 'left', size: 300 });
  assert.equal(result.edit!.blocks.inspector!.open, false);
  assert.equal(result.edit!.blocks.timeline!.size, 456);
  assert.equal(result.canvas, undefined);
  assert.deepEqual(readWorkspaceProfiles(storage({})), {});
});

test('a narrow window temporarily docks the library below the workspace, retaining the preferred dock and size', () => {
  const layout = { ...DEFAULT_WORKSPACE, assets:true, libraryDock: 'right' as const, assetsWidth: 480 };
  const narrow = workspaceGeometry(layout, { width: 900, height: 700 }, 420);
  assert.equal(narrow.dock, 'bottom');
  assert.equal(narrow.responsive, true);
  assert.equal(narrow.inset.left, 420);
  assert.equal(narrow.library.width, 480);
  assert.equal(narrow.inset.bottom, 281);
  const wide = workspaceGeometry(layout, { width: 1800, height: 1000 }, 420);
  assert.equal(wide.dock, 'right');
  assert.equal(wide.library.width, 480);
  assert.equal(wide.responsive, false);
  assert.equal(layout.libraryDock, 'right');
  assert.equal(layout.assetsWidth, 480);
  const short = workspaceGeometry({ ...layout, libraryDock: 'bottom' }, { width: 1800, height: 600 }, 420);
  assert.equal(short.library.height, 208, 'the edit retains room for its viewer and timeline');
  assert.equal(workspaceGeometry({ ...DEFAULT_CANVAS_WORKSPACE, libraryDock: 'bottom' }, { width: 1800, height: 600 }, 420).library.height, 280);
});

test('library geometry stays inside the window, reserves chat and never overlaps the workspace for every dock', () => {
  for (const width of [0, 400, 800, 1200, 2200]) for (const height of [32, 400, 1000]) for (const chatSide of ['left', 'right'] as const) for (const libraryDock of ['left', 'right', 'bottom', 'chat'] as const) {
    const layout = { ...DEFAULT_WORKSPACE, assets:true, chatSide, libraryDock };
    const { library: box, inset, dock } = workspaceGeometry(layout, { width, height }, Math.min(width, 420));
    for (const n of Object.values(box)) assert.ok(Number.isFinite(n) && n >= 0);
    assert.ok(box.left + box.width <= width);
    assert.ok(box.top + box.height <= height);
    if (libraryDock === 'chat') assert.equal(inset.bottom, 0);
    else if (dock === 'left') assert.ok(box.left + box.width < inset.left);
    else if (dock === 'right') assert.ok(box.left > width - inset.right);
    else assert.ok(box.top > height - inset.bottom);
  }
});

test('browser layouts ignore unavailable chat, an arrangement compares the blocks it declares, and presets carry their arrangement', () => {
  assert.equal(sameWorkspace(DEFAULT_WORKSPACE, { ...DEFAULT_WORKSPACE, chat: false, chatWidth: 600 }, false), true);
  assert.equal(sameWorkspace(DEFAULT_WORKSPACE, { ...DEFAULT_WORKSPACE, chat: false }, true), false);
  assert.equal(sameWorkspace(DEFAULT_CANVAS_WORKSPACE, { ...DEFAULT_CANVAS_WORKSPACE, blocks: { ...DEFAULT_CANVAS_WORKSPACE.blocks, layers: { open: true, edge: 'left', size: 800 } } }, true, CANVAS), true);
  assert.equal(sameWorkspace(DEFAULT_WORKSPACE, DEFAULT_CANVAS_WORKSPACE, true), false);
  assert.deepEqual(workspacePresets(EDIT).map((p) => p.id), ['standard', 'library', 'detail', 'focus']);
  assert.deepEqual(workspacePresets(CANVAS).map((p) => p.id), ['standard', 'library', 'focus']);
  for (const spec of [EDIT, CANVAS]) {
    const presets = workspacePresets(spec);
    assert.equal(presets.find(row => row.id === 'focus')?.layout.mode, spec.name);
    assert.equal(presets.find(row => row.id === 'library')?.layout.libraryDock, 'left', 'the library beside the work');
  }
  const [standard, library, detail, focus] = workspacePresets(EDIT);
  assert.deepEqual(library!.layout.blocks, standard!.layout.blocks, 'the library preset keeps the work as it is');
  assert.equal(detail!.layout.blocks.layers?.open, true, 'Detail opens the layers');
  assert.equal(focus!.layout.chat, false);
  assert.equal(focus!.layout.assets, false);
});
