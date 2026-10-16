import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import type { SavedGroupClip } from '../api.ts';
import type { EditModel } from './timeline-edit.ts';
import { groupInsertAt, groupInsertOps } from './saved-insert.ts';

const clip = (src: string, link?: string) => ({ src, ...(link ? { attrs: { 'data-link': link } } : {}) });

it('a group goes in on new tracks, in its order, each clip at its time from where it lands, its links made anew', () => {
  const group: SavedGroupClip[] = [
    { track: 1, at: 6, clip: clip('s/v.mp4') },
    { track: 0, at: 2, clip: clip('s/title.html') },
    { track: 1, at: 0, clip: clip('s/v.mp4', 'L') },
    { track: 2, at: 0, clip: clip('s/v.mp4', 'L') },
  ];
  /* the film has a link of that name already: another one is made */
  const model = [{ clips: [{ id: 'x', link: 'saved-L' }] }] as unknown as EditModel;
  const ops = groupInsertOps(group, 1.5, 3, model);
  assert.deepEqual(ops.map((op) => (op.op === 'insert' ? [op.clip?.src, op.at, op.track, op.link ?? null] : null)), [
    ['s/title.html', 3.5, { insert: 3 }, null],
    ['s/v.mp4', 1.5, { insert: 4 }, 'saved-L-2'],
    ['s/v.mp4', 7.5, 4, null],
    ['s/v.mp4', 1.5, { insert: 5 }, 'saved-L-2'],
  ]);
});

it('a group dropped on a track goes in above it; on a new track, there; anywhere else, on top', () => {
  assert.equal(groupInsertAt(2), 2);
  assert.equal(groupInsertAt({ insert: 4 }), 4);
  assert.equal(groupInsertAt(undefined), 0);
});
