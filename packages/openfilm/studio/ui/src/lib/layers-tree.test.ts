import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipKey, layerKey, layerLines, movedOrder, moverFor, openTo, type LayerClip, type LayerRow } from './layers-tree.ts';

const row = (loc: string, branch: number, children: LayerRow[] = []): LayerRow => ({
  handle: branch, branch, loc, tag: 'div', kind: children.length ? 'group' : 'box', label: loc, hidden: false, locked: false, off: false, children,
});
const card = row('#card', 1, [row('#title', 2), row('#logo', 3, [row('#mark', 4)]), row('#bg', 5)]);
const clips: LayerClip[] = [
  { clip: 'intro', kind: 'page', layers: [card, row('#footer', 6)] },
  { clip: 'v1', kind: 'video', layers: [] },
];

test('the lines are the clips and the layers of the open rows; clips and a row alone in its level start open', () => {
  const keys = (toggled: string[]) => layerLines(clips, new Set(toggled)).map((l) => `${'  '.repeat(l.depth)}${l.key}`);
  assert.deepEqual(keys([]), ['clip:intro', '  layer:intro:#card', '  layer:intro:#footer', 'clip:v1']);
  assert.deepEqual(keys([layerKey('intro', '#card')]), [
    'clip:intro', '  layer:intro:#card', '    layer:intro:#title', '    layer:intro:#logo', '    layer:intro:#bg', '  layer:intro:#footer', 'clip:v1',
  ]);
  assert.deepEqual(keys([clipKey('intro')]), ['clip:intro', 'clip:v1']);
  /* a row alone in its level opens by itself, until the person closes it */
  const lone: LayerClip[] = [{ clip: 'p', kind: 'page', layers: [row('#wrap', 9, [row('#a', 10), row('#b', 11)])] }];
  assert.deepEqual(layerLines(lone, new Set()).map((l) => l.key), ['clip:p', 'layer:p:#wrap', 'layer:p:#a', 'layer:p:#b']);
  assert.deepEqual(layerLines(lone, new Set([layerKey('p', '#wrap')])).map((l) => l.key), ['clip:p', 'layer:p:#wrap']);
  const logo = layerLines(clips, new Set([layerKey('intro', '#card')])).find((l) => l.row?.loc === '#logo')!;
  assert.equal(logo.index, 1);
  assert.equal(logo.parentKey, layerKey('intro', '#card'));
  assert.equal(logo.canOpen, true);
  assert.equal(logo.open, false);
});

test('the rows down to a layer opened, whatever the person closed', () => {
  const shown = (toggled: ReadonlySet<string>) => layerLines(clips, toggled).map((l) => l.key);
  const none = new Set<string>();
  assert.ok(shown(openTo(clips, none, 'intro', '#mark')).includes(layerKey('intro', '#mark')));
  const closed = new Set([clipKey('intro')]);
  assert.ok(shown(openTo(clips, closed, 'intro', '#title')).includes(layerKey('intro', '#title')));
  /* already open, or no such layer: the same set */
  const open = new Set([layerKey('intro', '#card')]);
  assert.equal(openTo(clips, open, 'intro', '#title'), open);
  assert.equal(openTo(clips, none, 'intro', '#nope'), none);
});

test('a row dropped in a gap of its level: the new order, top first, by the handles it is restacked by', () => {
  const level = card.children;
  assert.deepEqual(movedOrder(level, 2, 0), [5, 2, 3]);
  assert.deepEqual(movedOrder(level, 0, 3), [3, 5, 2]);
  assert.deepEqual(movedOrder(level, 0, 2), [3, 2, 5]);
  /* dropped in either gap beside itself, it stays */
  assert.equal(movedOrder(level, 1, 1), null);
  assert.equal(movedOrder(level, 1, 2), null);
  assert.equal(movedOrder(level, 7, 0), null);
});

test('a dragged row lands in its own level or in that of a row around it, which then moves with all it holds', () => {
  const lines = layerLines(clips, new Set([layerKey('intro', '#card'), layerKey('intro', '#logo')]));
  const at = (loc: string) => lines.find((l) => l.row?.loc === loc)!;
  /* #mark is in #logo, in #card */
  assert.equal(moverFor(lines, at('#mark'), at('#mark'))?.row?.loc, '#mark');
  assert.equal(moverFor(lines, at('#mark'), at('#title'))?.row?.loc, '#logo');
  assert.equal(moverFor(lines, at('#mark'), at('#footer'))?.row?.loc, '#card');
  /* over a row inside a group of its level: that level (it lands beside the group, not in it) */
  assert.equal(moverFor(lines, at('#title'), at('#mark'))?.row?.loc, '#title');
  assert.equal(moverFor(lines, at('#footer'), at('#title'))?.row?.loc, '#footer');
  /* a clip, another clip: nowhere */
  assert.equal(moverFor(lines, at('#title'), lines[0]!), null);
  assert.equal(moverFor(lines, at('#title'), lines.find((l) => l.key === clipKey('v1'))!), null);
});
