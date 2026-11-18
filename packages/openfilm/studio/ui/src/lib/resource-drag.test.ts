import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearResourceDrag, peekResourceDrag, readResourceDragData, setResourceDragData } from './resource-drag.ts';
import { assetDropInsert, assetDropPreview, assetRunMs, pendingDropOf } from './asset-timeline.ts';

test('a source range survives drag serialization and determines both preview and written clip length', () => {
  const values = new Map<string, string>();
  setResourceDragData({ setData: (k, v) => values.set(k, v) }, { path: 'assets/a.mp4', kind: 'video', name: 'a.mp4', durationMs: 30000, range: { inMs: 4750, outMs: 7125 } });
  const file = readResourceDragData({ getData: (k) => values.get(k) ?? '' })!;
  assert.deepEqual(file.range, { inMs: 4750, outMs: 7125 });
  assert.deepEqual(peekResourceDrag(), file);
  assert.equal(assetRunMs([file]), 2375);
  const target = { lane: null, insertTrackAt: null };
  const plan = assetDropInsert(file, [], target, 5000);
  assert.ok(!('error' in plan));
  assert.deepEqual(plan.element, { src: 'assets/a.mp4', time: [4.75, 7.125] });
  const preview = assetDropPreview(file, [], null, 5000)!;
  assert.equal(preview.endMs - preview.startMs, 2375);
  const pending = pendingDropOf(file, target, 5000)!;
  assert.equal(pending.endMs - pending.startMs, 2375);
  clearResourceDrag();
  assert.equal(peekResourceDrag(), null);
});

test('untrusted drag ranges are validated and clamped to the known source duration', () => {
  const read = (range: unknown) => readResourceDragData({ getData: () => JSON.stringify({ path: 'a.mp4', durationMs: 10000, range }) })!;
  assert.deepEqual(read({ inMs: 2000, outMs: 12000 }).range, { inMs: 2000, outMs: 10000 });
  for (const range of [{ inMs: -1, outMs: 2000 }, { inMs: 2000, outMs: 2000 }, { inMs: '0', outMs: 2000 }, { inMs: 10001, outMs: 12000 }]) assert.equal(read(range).range, undefined);
});
