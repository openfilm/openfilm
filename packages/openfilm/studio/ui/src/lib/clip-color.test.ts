import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustWrite, clipAdjust, clipFilter, draftOf, filterWrite, isFilter, type ColorText } from './clip-color.ts';
import { gradeFilter } from './grade.ts';

const STANDARD = { 'looks/in-rec709.ctf': '<in/>', 'looks/out-rec709.ctf': '<out/>' };
const grade = { mix: [1.05, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.95, 0], sat: 0.9 };

test('a slider on a clip of ordinary video: its own layer, the parts around it, and back to nothing', () => {
  const files = new Map<string, string>();
  const text: ColorText = (p) => files.get(p) ?? null;
  const clip = { id: 's7', style: 'opacity: 0.9' };
  const w = adjustWrite([clip], text, () => ({ exposure: 0.5 }), STANDARD);
  assert.deepEqual(w.styles, [{ id: 's7', style: 'opacity: 0.9; --of-lut: url(looks/in-rec709.ctf) url(looks/shot-s7.ctf) url(looks/out-rec709.ctf)' }]);
  assert.deepEqual(w.files.map((f) => f.path), ['looks/shot-s7.ctf', 'looks/in-rec709.ctf', 'looks/out-rec709.ctf']);
  for (const f of w.files) files.set(f.path, f.text);
  const graded = { id: 's7', style: w.styles[0]!.style! };
  assert.equal(clipAdjust(graded, text).exposure, 0.5);
  /* relative, as a slider dragged over several clips moves each from its own */
  const more = adjustWrite([graded], text, (now) => ({ exposure: now.exposure + 0.25 }), STANDARD);
  assert.deepEqual(more.files.map((f) => f.path), ['looks/shot-s7.ctf'], 'what is there already is not written again');
  files.set('looks/shot-s7.ctf', more.files[0]!.text);
  assert.equal(clipAdjust(graded, text).exposure, 0.75);
  /* back to 0: no grade at all, so the clip plays exactly as its file */
  const none = adjustWrite([graded], text, () => ({ exposure: 0 }), STANDARD);
  assert.deepEqual(none.styles, [{ id: 's7', style: 'opacity: 0.9' }]);
  /* the draft the picture shows meanwhile: its chain, with the layer as changed */
  const d = draftOf(more, 's7');
  assert.deepEqual(d?.files, ['looks/in-rec709.ctf', 'looks/shot-s7.ctf', 'looks/out-rec709.ctf']);
  assert.deepEqual(Object.keys(d?.texts ?? {}), ['looks/shot-s7.ctf']);
});

test('a library filter: one file a filter and strength, shared, at the end; the old SVG way taken off', () => {
  /* b's files are there already */
  const files = new Map<string, string>([['looks/in-sony-slog3.ctf', '<in/>'], ['looks/shot-b.ctf', '<b/>'], ['looks/out-rec709.ctf', '<out/>']]);
  const text: ColorText = (p) => files.get(p) ?? null;
  const filter = { id: 'filters/warm-film', title: 'Warm film', grade };
  /* one clip as it was (the filter in its CSS), one with a grade of its own */
  const a = { id: 'a', style: `filter: ${gradeFilter('filters/warm-film', grade, 1)} brightness(1.1)` };
  const b = { id: 'b', style: '--of-lut: url(looks/in-sony-slog3.ctf) url(looks/shot-b.ctf) url(looks/out-rec709.ctf)' };
  const w = filterWrite([a, b], text, filter, 0.8, STANDARD);
  assert.deepEqual(w.files.map((f) => f.path), ['looks/filter-warm-film-80.ctf']);
  assert.deepEqual(w.styles, [
    { id: 'a', style: 'filter: brightness(1.1); --of-lut: url(looks/filter-warm-film-80.ctf)' },
    { id: 'b', style: '--of-lut: url(looks/in-sony-slog3.ctf) url(looks/shot-b.ctf) url(looks/out-rec709.ctf) url(looks/filter-warm-film-80.ctf)' },
  ]);
  const f = clipFilter({ id: 'a', style: w.styles[0]!.style! });
  assert.equal(f?.amount, 0.8);
  assert.ok(f && isFilter(f.slug, 'filters/warm-film'));
  /* a slider on a clip with a filter alone: the filter stays last, after the output */
  files.set('looks/filter-warm-film-80.ctf', w.files[0]!.text);
  const adj = adjustWrite([{ id: 'a', style: w.styles[0]!.style! }], text, () => ({ saturation: 20 }), STANDARD);
  assert.match(adj.styles[0]!.style!, /url\(looks\/in-rec709\.ctf\) url\(looks\/shot-a\.ctf\) url\(looks\/out-rec709\.ctf\) url\(looks\/filter-warm-film-80\.ctf\)/);
  /* taken off */
  assert.deepEqual(filterWrite([{ id: 'a', style: w.styles[0]!.style! }], text, null, 1, STANDARD).styles, [{ id: 'a', style: 'filter: brightness(1.1)' }]);
});
