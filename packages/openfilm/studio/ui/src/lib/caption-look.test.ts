import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromInspector, lookDecls, sizeOf, toInspector, varsOf, withWordArt } from './caption-look.ts';
import { readVtt } from '../../../../src/captions.mjs';
import { cueRule } from './caption-edits.ts';

test('a caption\'s look from before (plain CSS) read as the text\'s variables, and given up for them once changed', () => {
  const rule = { font: '700 4cqmin/1.45 "PingFang SC", sans-serif', color: '#ffffff', background: 'none', '-webkit-text-stroke': '0.08em #000000', 'paint-order': 'stroke fill' };
  assert.deepEqual(varsOf(rule), {
    '--size': '4cqmin', '--weight': '700', '--font': '"PingFang SC", sans-serif', '--color': '#ffffff',
    '--stroke': '0.08em', '--stroke-color': '#000000', '--box': 'transparent',
  });
  const decls = lookDecls(rule, { '--color': '#ffd400' });
  assert.equal(decls['--color'], '#ffd400');
  assert.equal(decls['--font'], '"PingFang SC", sans-serif', 'the rest of its look kept');
  assert.equal(decls.font, null);
  assert.equal(decls.color, null);
  assert.equal(sizeOf({ '--size': '6.5cqmin' }), 6.5);
  assert.equal(sizeOf({}), null);
  /* the inspector's % (a text's box) is a tenth of a share of the frame's short side here */
  assert.equal(toInspector('4cqmin'), '40vh');
  assert.equal(fromInspector('62vh'), '6.2cqmin');
});

test('a word art put on every caption of a track: the track\'s look, its size kept, no cue keeping its own', () => {
  const vtt = readVtt('WEBVTT\n\nSTYLE\n::cue { --size: 6cqmin; color: #fff; }\n::cue(#c2) { --color: #f00; --weight: 900; --in: pop; }\n\nc1\n00:00:01.000 --> 00:00:02.000\nOne\n\nc2\n00:00:02.000 --> 00:00:03.000\nTwo\n');
  const out = withWordArt(vtt, { '--color': '#ffd400', '--stroke': '0.08em', '--stroke-color': '#000000' });
  const track = cueRule(out, '::cue');
  assert.equal(track['--color'], '#ffd400');
  assert.equal(track['--stroke'], '0.08em');
  assert.equal(track['--size'], '6cqmin', 'its size kept');
  assert.equal(track.color, undefined, 'the plain CSS given up');
  assert.deepEqual(cueRule(out, '::cue(#c2)'), { '--in': 'pop' }, 'a cue keeps its motion, not a look of its own');
});
