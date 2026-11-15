import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waveformRatiosOf, withWaveformRatio } from './track-waveforms.ts';

const tracks = (...ids: string[][]) => ids.map((clips) => ({ clips: clips.map((id) => ({ id })) }));

test('a waveform proportion follows its track when another track is inserted', () => {
  const before = tracks(['title'], ['a', 'b'], ['voice']);
  const saved = withWaveformRatio([], before, 1, 60);
  assert.deepEqual(saved, [{ ratio: 60, index: 1, clips: ['a', 'b'] }]);
  const after = tracks(['new'], ['title'], ['a', 'b'], ['voice']);
  assert.deepEqual([...waveformRatiosOf(saved, after)], [[2, 60]]);
});

test('changing one track preserves another track\'s proportion after reordering', () => {
  const before = tracks(['a'], ['b']);
  const first = withWaveformRatio([], before, 0, 60);
  const saved = withWaveformRatio(first, before, 1, 90);
  const after = tracks(['b'], ['a']);
  const changed = withWaveformRatio(saved, after, 1, 30);
  assert.deepEqual([...waveformRatiosOf(changed, after)].sort(), [[0, 90], [1, 30]]);
  assert.deepEqual(changed.find((entry) => entry.index === 1)?.clips, ['a']);
});
