import assert from 'node:assert/strict';
import { test } from 'node:test';

import { liveLookStands } from './stage-clip.ts';
import type { FilmDoc } from './film.ts';

const docWith = (style?: string) => ({ tracks: [{ clips: [{ id: 'v', src: 'v.mp4', ...(style == null ? {} : { style }) }] }] }) as unknown as FilmDoc;

test('a look shown and not kept stands while film.html\'s style is the one it was shown over, and is over once that changes', () => {
  const live = { clipLoc: 'film.html#0.0', written: '' };
  assert.equal(liveLookStands(docWith(), live), true, 'being dragged: film.html as it was');
  assert.equal(liveLookStands(docWith('opacity: 0.5'), live), false, 'kept: film.html has it now');
  assert.equal(liveLookStands(docWith(''), { ...live, written: 'opacity: 0.5' }), false, 'undone to another style');
  assert.equal(liveLookStands(docWith(), { ...live, clipLoc: 'film.html#0.3' }), false, 'its clip gone');
});
