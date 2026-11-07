import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPTION_DEFAULTS, captionLookSet, fromInspector, lookDecls, lookVars, sizeOf, toInspector, varsOf } from './caption-look.ts';

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

test('a caption look read as the text\'s variables; what it sets on a caption leaves its size alone', () => {
  const vars = lookVars('::cue { font: 800 4cqmin/1.45 sans-serif; color: #ffd400; -webkit-text-stroke: 0.08em #000000; paint-order: stroke fill; }');
  assert.equal(vars['--color'], '#ffd400');
  assert.equal(vars['--weight'], '800');
  const set = captionLookSet(vars);
  assert.equal(set['--color'], '#ffd400');
  assert.equal(set['--box'], CAPTION_DEFAULTS['--box'], 'what it leaves unset is a caption\'s own default');
  assert.equal('--size' in set, false, 'a look keeps the caption\'s size');
});
