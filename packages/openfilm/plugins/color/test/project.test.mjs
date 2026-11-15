// A project graded as the workbench and `openfilm color` grade it: the LUT written and named, read back, let go of,
// and the picture as it plays (ffmpeg through the LUT) the same as the grade computes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clipOf, filmOf, frameOf, gradeOf, timingOf, writeGrade, withLuts, LOOKS } from '../project.mjs';
import { balance, picturesOf } from '../balance.mjs';
import { amended, summary } from '../cli.mjs';
import { compile, neutralGrade, normalize } from '../engine/grade.mjs';
import { measure } from '../engine/measure.mjs';

/** A project with a clip of a warm grey card (as if lit by tungsten and shot balanced for daylight) and one of bars. */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'openfilm-color-test-'));
  const make = (name, source) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, '-t', '1', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '12',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', join(root, name)]);
  make('card.mp4', 'color=c=0xb39a7c:s=160x90:r=24');
  make('bars.mp4', 'smptehdbars=s=160x90:r=24');
  writeFileSync(join(root, 'film.html'), `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
</head>
<body>
<section>
  <video id="card" src="card.mp4#t=0,1"></video>
  <video id="bars" src="bars.mp4#t=0,1" at="1" style="--of-lut: url(mine.cube)"></video>
</section>
</body>
</html>
`);
  /* a LUT of the person's on the second clip: kept after the grade */
  writeFileSync(join(root, 'mine.cube'), 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
  return root;
}

test('a grade is written as a LUT named first in the clip\'s --of-lut, read back, and let go of', async (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const done = await writeGrade(root, 'bars', { exposure: 0.5, saturation: 1.2 });
  assert.match(String(done.lut), /^looks\/color\/bars-[0-9a-f]{8}\.cube$/);
  assert.equal(done.style, `--of-lut: url(${done.lut}) url(mine.cube)`);
  assert.ok(existsSync(join(root, String(done.lut))));
  const film = await filmOf(root);
  const back = await gradeOf(root, clipOf(film.value, 'bars'));
  assert.equal(back.grade.exposure, 0.5);
  assert.equal(back.grade.saturation, 1.2);
  assert.deepEqual(back.others, ['mine.cube']);

  /* a grade that changes nothing on video: no LUT of ours, the person's kept */
  const off = await writeGrade(root, 'bars', neutralGrade());
  assert.equal(off.lut, null);
  assert.equal(off.style, '--of-lut: url(mine.cube)');

  /* many grades: only the newest few files are kept */
  for (let i = 1; i <= 8; i++) await writeGrade(root, 'card', { exposure: i / 10 });
  const kept = readdirSync(join(root, ...LOOKS.split('/'))).filter((n) => n.startsWith('card-'));
  assert.ok(kept.length <= 5, `${kept.length} kept`);
  const named = (await gradeOf(root, clipOf((await filmOf(root)).value, 'card'))).lut;
  assert.ok(kept.includes(String(named).split('/').pop()), 'the one named is kept');
  assert.equal(withLuts('opacity: 0.5', []), 'opacity: 0.5');
});

test('the picture as it plays (ffmpeg through the LUT) is the grade as computed', async (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const g = normalize({ exposure: 0.4, white: 4800, contrast: 1.2, curves: { y: [[0, 0], [0.5, 0.6], [1, 1]] } });
  const { lut } = await writeGrade(root, 'bars', g);
  const clip = clipOf((await filmOf(root)).value, 'bars');
  const { file } = await gradeOf(root, clip);
  const at = timingOf(clip).middle;
  const raw = await frameOf(file, at, { width: 160 });
  const played = await frameOf(file, at, { width: 160, luts: [join(root, String(lut)), join(root, 'mine.cube')] });
  const f = compile(g);
  const d = [];
  for (let i = 0; i < raw.rgb.length; i += 3) {
    const o = f(raw.rgb[i], raw.rgb[i + 1], raw.rgb[i + 2]);
    for (let c = 0; c < 3; c++) d.push(Math.abs(o[c] - played.rgb[i + c]) * 255);
  }
  d.sort((a, b) => a - b);
  const mean = d.reduce((a, b) => a + b, 0) / d.length, p99 = d[Math.floor(d.length * 0.99)];
  /* full-saturation bars pushed past the gamut by the white balance clip between the LUT's points (engine.test.mjs) */
  assert.ok(mean < 0.5 && p99 < 2, `mean ${mean.toFixed(3)}, 99th ${p99.toFixed(2)} codes (8-bit)`);
});

test('balancing a warm grey card makes it grey', async (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const clip = clipOf((await filmOf(root)).value, 'card');
  const rgb = await picturesOf(root, clip, 64);
  const before = measure(rgb);
  assert.ok(before.white.kelvin < 5000, `the card reads warm: ${before.white.kelvin} K`);
  const { grade, after } = balance(rgb, neutralGrade());
  assert.ok(grade.white < 5500, `the grade says the light was warm: ${grade.white} K`);
  assert.ok(Math.abs(after.white.kelvin - 6500) < 300, `balanced: ${after.white.kelvin} K`);
  assert.ok(Math.abs(after.white.tint) <= 4, `tint ${after.white.tint}`);
});

test('amounts as typed are merged into a grade, and a grade is said in a line', () => {
  const g = amended(neutralGrade(), ['exposure=0.5', 'white=5600', 'lift.b=0.02', 'gain=1.1', '{"saturation":1.3}', 'look=looks/a.cube', 'curves.y=[[0,0],[0.5,0.6],[1,1]]']);
  assert.equal(g.exposure, 0.5);
  assert.equal(g.white, 5600);
  assert.equal(g.lift.b, 0.02);
  assert.equal(g.lift.r, 0);
  assert.equal(g.gain.y, 1.1);
  assert.equal(g.saturation, 1.3);
  assert.deepEqual(g.look, { path: 'looks/a.cube', mix: 1 });
  assert.deepEqual(g.curves.y, [[0, 0], [0.5, 0.6], [1, 1]]);
  assert.throws(() => amended(neutralGrade(), ['bogus=1']), /no amount named bogus/);
  assert.throws(() => amended(neutralGrade(), ['exposure']), /not an amount/);
  const line = summary(g);
  assert.match(line, /exposure \+0\.50/);
  assert.match(line, /white 5600 K/);
  assert.match(line, /lift b \+0\.02/);
  assert.match(line, /look looks\/a\.cube/);
  assert.equal(summary(neutralGrade()), 'input rec709');
});
