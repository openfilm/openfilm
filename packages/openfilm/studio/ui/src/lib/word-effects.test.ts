import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVtt, writeVtt, cueCss } from '../../../../src/captions.mjs';
import { cueRule } from './caption-edits.ts';
import { WORD_EFFECTS, wordEffectOf, withWordColor, withWordEffect } from './word-effects.ts';

const VTT = readVtt('WEBVTT\n\nSTYLE\n::cue { color: #fff; }\n::cue(:past) { color: #ff0; }\n\nc1\n00:00:00.000 --> 00:00:02.000\n<00:00:00.000>Hi <00:00:01.000>you\n');

test('a word effect is the track\'s CSS of its words said and not said yet, its keyframes with it; one at a time', () => {
  assert.deepEqual(wordEffectOf(VTT), { id: 'color', color: '#ff0' }, 'words lit by a color of their own, from before');
  const pop = withWordEffect(VTT, 'pop', '#0f0');
  assert.equal(wordEffectOf(pop).id, 'pop');
  assert.equal(cueRule(pop, '::cue(:future)').opacity, '0');
  assert.match(pop.styles.join('\n'), /@keyframes wfx-pop \{ from \{ opacity: 0; transform: scale\(0\.3\) \} to/);
  assert.equal(cueRule(pop, '::cue').color, '#fff', 'the rest of the look kept');
  /* the page draws it: the keyframes as they are, the words' rules on their elements */
  const css = cueCss(readVtt(writeVtt(pop)).styles.join('\n'), '[data-film-captions="0"]');
  assert.match(css, /@keyframes wfx-pop/);
  assert.match(css, /\.past/);
  const grow = withWordEffect(pop, 'grow');
  assert.doesNotMatch(grow.styles.join('\n'), /wfx-pop/, 'the effect before goes, keyframes and all');
  assert.equal(cueRule(grow, '::cue(:future)').opacity, undefined);
  assert.equal(wordEffectOf(withWordEffect(pop, 'grow', '#0f0')).color, '#0f0', 'an effect that lights says its color');
  assert.equal(wordEffectOf(withWordColor(grow, '#f0f')).color, '#f0f');
  const none = withWordEffect(grow, 'none');
  assert.equal(wordEffectOf(none).id, 'none');
  assert.doesNotMatch(none.styles.join('\n'), /wfx-|:past|:future/);
  for (const e of WORD_EFFECTS) assert.equal(wordEffectOf(withWordEffect(VTT, e.id)).id, e.id, e.id);
});
