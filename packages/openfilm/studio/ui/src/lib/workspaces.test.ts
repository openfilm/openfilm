import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_WORKSPACE_KEY, DEFAULT_WORKSPACE, DEFAULT_CANVAS_WORKSPACE, parseWorkspaces, readWorkspaceLayout, readWorkspaceProfiles, sameWorkspace, serializeWorkspaces, keepWorkspace, MAX_WORKSPACES, workspaceGeometry, workspacePresets } from './workspaces.ts';

const storage = (entries: Record<string, string>) => ({ getItem: (key: string) => entries[key] ?? null });

test('portable workspaces round-trip mode, docks, hidden panels, preferred sizes and automatic timeline fitting', () => {
  const saved = [{ id: 'my-edit', name: 'My edit', layout: { ...DEFAULT_WORKSPACE, layers: true, inspector: false, libraryDock: 'bottom' as const, chatSide: 'right' as const, layersSide: 'right' as const, inspectorSide: 'left' as const, timelineEdge: 'top' as const, assetsWidth: 375, libraryHeight: 420, chatWidth: 520 } }, { id: 'board', name: 'Board', layout: DEFAULT_CANVAS_WORKSPACE }];
  assert.deepEqual(parseWorkspaces(serializeWorkspaces(saved)), saved);
  assert.equal(parseWorkspaces(serializeWorkspaces(saved))[0].layout.timelineHeight, null);
});

test('legacy named layouts keep their old chat drawer placement; one malformed row does not lose other layouts', () => {
  const { mode, libraryDock, libraryHeight, chatSide, layersSide, inspectorSide, timelineEdge, ...legacy } = DEFAULT_WORKSPACE;
  const valid = { id: 'a', name: '  My   layout  ', layout: legacy };
  const raw = JSON.stringify({ version: 1, layouts: [{ id: 'broken', name: 'Broken', layout: {} }, valid, valid, { ...valid, id: 'blank', name: ' ' }, { ...valid, id: 'duplicate-name', name: 'MY LAYOUT' }] });
  const rows = parseWorkspaces(raw);
  assert.deepEqual(rows.map(row => [row.id, row.name]), [['a', 'My layout']]);
  assert.equal(rows[0].layout.libraryDock, 'chat');
  assert.equal(rows[0].layout.mode, 'edit');
  const collision = parseWorkspaces(JSON.stringify({ version: 2, layouts: ['first','second'].map((name, i) => ({ id: 'x'.repeat(128) + i, name, layout: DEFAULT_WORKSPACE })) }));
  assert.equal(collision.length, 1, 'normalizing imported ids cannot produce duplicate React keys');
  for (const broken of [null, '{', '{}', '{"version":99,"layouts":[]}']) assert.deepEqual(parseWorkspaces(broken), []);
});

test('imported dimensions are bounded and invalid dimensions or dock enums are rejected', () => {
  const layout = readWorkspaceLayout({ ...DEFAULT_WORKSPACE, assetsWidth: -100, inspectorWidth: 1e9, timelineHeight: -1, libraryHeight: 2000 });
  assert.equal(layout?.assetsWidth, 220);
  assert.equal(layout?.inspectorWidth, 800);
  assert.equal(layout?.timelineHeight, 104);
  assert.equal(layout?.libraryHeight, 900);
  for (const patch of [{ chatWidth: NaN }, { timelineHeight: Infinity }, { libraryHeight: '400' }, { libraryDock: 'floating' }, { mode: 'bad' }]) assert.equal(readWorkspaceLayout({ ...DEFAULT_WORKSPACE, ...patch }), null);
});

test('the workspace bank holds 24 layouts, and permits renaming or updating at capacity without duplicate names', () => {
  let rows: import('./workspaces.ts').SavedWorkspace[] = [];
  for (let n = 0; n < MAX_WORKSPACES; n++) rows = keepWorkspace(rows, { id: String(n), name: `Layout ${n}`, layout: { ...DEFAULT_WORKSPACE } })!;
  assert.equal(rows.length, 24);
  assert.equal(keepWorkspace(rows, { id: 'extra', name: 'Extra', layout: DEFAULT_WORKSPACE }), null);
  const renamed = keepWorkspace(rows, { ...rows[1], name: ' My   edit ' })!;
  assert.equal(renamed[1].name, 'My edit');
  const updated = keepWorkspace(renamed, { ...renamed[1], layout: { ...DEFAULT_WORKSPACE, layers: true } })!;
  assert.equal(updated[1].layout.layers, true);
  assert.equal(keepWorkspace(updated, { ...updated[1], name: updated[0].name.toUpperCase() }), null);
  assert.equal(parseWorkspaces(serializeWorkspaces([...rows, { id: 'extra', name: 'Extra', layout: DEFAULT_WORKSPACE }])).length, 24);
});

test('edit and canvas profiles restore independently, recovering a broken profile without losing the other', () => {
  const edit = { ...DEFAULT_WORKSPACE, libraryDock: 'right' as const, assetsWidth: 487 };
  const canvas = { ...DEFAULT_CANVAS_WORKSPACE, libraryDock: 'bottom' as const, libraryHeight: 333, chat: false };
  assert.deepEqual(readWorkspaceProfiles(storage({ [CURRENT_WORKSPACE_KEY]: JSON.stringify({ version: 2, edit, canvas }) })), { edit, canvas });
  assert.deepEqual(readWorkspaceProfiles(storage({ [CURRENT_WORKSPACE_KEY]: JSON.stringify({ version: 2, edit: {}, canvas }) })), { edit: DEFAULT_WORKSPACE, canvas });
  assert.deepEqual(readWorkspaceProfiles({ getItem: () => { throw new Error('Storage unavailable'); } }), { edit: DEFAULT_WORKSPACE, canvas: DEFAULT_CANVAS_WORKSPACE });
});

test('legacy panel preferences migrate once into edit, leaving canvas defaults independent', () => {
  const result = readWorkspaceProfiles(storage({ 'openfilm.project.layers': '1', 'openfilm.project.inspector': '0', 'openfilm.project.layersW': '300', 'openfilm.project.timelineH': '456' }));
  assert.equal(result.edit.layers, true);
  assert.equal(result.edit.inspector, false);
  assert.equal(result.edit.layersWidth, 300);
  assert.equal(result.edit.timelineHeight, 456);
  assert.deepEqual(result.canvas, DEFAULT_CANVAS_WORKSPACE);
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

test('browser layouts ignore unavailable chat, canvas ignores edit-only controls, and presets carry the intended mode', () => {
  assert.equal(sameWorkspace(DEFAULT_WORKSPACE, { ...DEFAULT_WORKSPACE, chat: false, chatWidth: 600 }, false), true);
  assert.equal(sameWorkspace(DEFAULT_WORKSPACE, { ...DEFAULT_WORKSPACE, chat: false }, true), false);
  assert.equal(sameWorkspace(DEFAULT_CANVAS_WORKSPACE, { ...DEFAULT_CANVAS_WORKSPACE, layers: true, timelineHeight: 800 }, true), true);
  assert.equal(sameWorkspace(DEFAULT_WORKSPACE, DEFAULT_CANVAS_WORKSPACE, true), false);
  for (const mode of ['edit', 'canvas'] as const) {
    const presets = workspacePresets(mode);
    assert.equal(presets.find(row => row.id === 'focus')?.layout.mode, mode);
    assert.equal(presets.find(row => row.id === 'library')?.layout.libraryDock, 'bottom');
  }
});
