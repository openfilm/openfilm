// `openfilm color look | input | balance | match` on a real project: what each writes (a clip's own layer, its chain
// in film.html) and what the picture is after it, measured as it plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCtf } from '../../../src/color/ctf.mjs';
import { chainOf } from '../../../src/color/chain.mjs';

const BIN = fileURLToPath(new URL('../bin/', import.meta.url));

/** A project: a warm grey card (tungsten light, a daylight balance), a dim one, and bars, a second each. */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'openfilm-color-grade-'));
  const make = (name, source) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, '-t', '1', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '12',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', join(root, name)]);
  make('card.mp4', 'color=c=0xb39a7c:s=160x90:r=24');
  make('dim.mp4', 'color=c=0x3a3a3a:s=160x90:r=24');
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
  <video id="dim" src="dim.mp4#t=0,1" at="1"></video>
  <video id="bars" src="bars.mp4#t=0,1" at="2" style="opacity: 0.8"></video>
</section>
</body>
</html>
`);
  return root;
}

/** A command run in the project as an agent runs it: its lines, its errors, its exit status. */
const color = (root, command, ...words) => {
  const r = spawnSync(process.execPath, [join(BIN, `${command}.mjs`), ...words], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENFILM_PROJECT: '' } });
  return { out: r.stdout, err: r.stderr, status: r.status };
};

const styleOf = (root, id) => readFileSync(join(root, 'film.html'), 'utf8').match(new RegExp(`id="${id}"[^>]*?(?:style="([^"]*)")?>`))?.[1] ?? '';

test('look measures each clip as it plays, says what is off, and draws it', async (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = color(root, 'look');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /film\.html#card {2}card\.mp4 {2}not graded/);
  assert.match(r.out, /white {2}4\d{3} K, tint -?\d+ \(from its brightest/, 'the warm card read warm, from its brightest: nothing in it is grey');
  assert.match(r.out, /its greys read green/, 'the encoder\'s slight green on the dim card is seen');
  assert.match(r.out, /! dark/, 'the dim card is called out');
  assert.match(r.out, /a jump at the cut/);
  for (const id of ['card', 'dim', 'bars']) assert.ok(existsSync(join(root, '.film', 'look', 'color', `${id}.png`)), id);
  const json = JSON.parse(color(root, 'look', 'card', '--json').out);
  assert.equal(json.clips.length, 1);
  assert.equal(color(root, 'look', 'nope').status, 2);
});

test('balance writes a CDL into the clip\'s own layer, chains it, and the greys come out grey at a usual exposure', async (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = color(root, 'balance', 'card', 'dim');
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(chainOf(styleOf(root, 'card')), ['looks/in-rec709.ctf', 'looks/shot-card.ctf', 'looks/out-rec709.ctf']);
  for (const f of ['in-rec709.ctf', 'shot-card.ctf', 'shot-dim.ctf', 'out-rec709.ctf']) assert.ok(existsSync(join(root, 'looks', f)), f);
  const ops = parseCtf(readFileSync(join(root, 'looks', 'shot-card.ctf'), 'utf8'));
  assert.deepEqual(ops.map((o) => o.type), ['cdl']);
  assert.ok(ops[0].offset[2] > ops[0].offset[0], 'blue raised against red: the warmth taken out');
  const look = color(root, 'look').out;
  const card = look.split('film.html#').find((b) => b.startsWith('card'));
  const kelvin = Number(card.match(/white {2}(\d+) K/)[1]);
  assert.ok(Math.abs(kelvin - 6500) < 500, card);
  const dim = look.split('film.html#').find((b) => b.startsWith('dim'));
  const middle = Number(dim.match(/middle ([\d.]+) IRE/)[1]);
  assert.ok(middle > 30 && middle < 55, dim);
  /* again: the same CDL changed, not a second one; bars kept as they were */
  color(root, 'balance', 'card');
  assert.equal(parseCtf(readFileSync(join(root, 'looks', 'shot-card.ctf'), 'utf8')).length, 1);
  assert.equal(styleOf(root, 'bars'), 'opacity: 0.8');
  assert.equal(color(root, 'balance').status, 2, 'which clips must be said');
});

test('input says what the footage is, and sets it with the parts around it', async (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const said = color(root, 'input');
  assert.match(said.out, /film\.html#card {2}card\.mp4: no input/);
  assert.match(said.out, /apple-log +Apple Log/);
  const set = color(root, 'input', 'bars', 'apple-log');
  assert.equal(set.status, 0, set.err);
  assert.equal(styleOf(root, 'bars'), 'opacity: 0.8; --of-lut: url(looks/in-apple-log.ctf) url(looks/out-rec709.ctf)');
  assert.ok(existsSync(join(root, 'looks', 'in-apple-log.ctf')));
  /* back to ordinary video: with nothing else in its grade, no chain at all */
  assert.equal(color(root, 'input', 'bars', 'rec709').status, 0);
  assert.equal(styleOf(root, 'bars'), 'opacity: 0.8');
});

test('match brings a clip to another\'s exposure and white', async (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = color(root, 'match', 'dim', '--to', 'card');
  assert.equal(r.status, 0, r.err);
  const [, before, after, ref] = r.out.match(/middle ([\d.]+) → ([\d.]+) IRE \(reference ([\d.]+)\)/).map(Number);
  assert.ok(Math.abs(after - ref) < Math.abs(before - ref) / 4, r.out);
  assert.ok(parseCtf(readFileSync(join(root, 'looks', 'shot-dim.ctf'), 'utf8')).some((o) => o.type === 'cdl'));
  assert.equal(color(root, 'match', 'dim').status, 2);
});

test('filter lists the library\'s filters and puts one on, last, at a strength; none takes it off', async (t) => {
  const root = project();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const list = color(root, 'filter');
  assert.equal(list.status, 0, list.err);
  assert.match(list.out, /^filters\/warm-film +Warm film/m);
  assert.equal(color(root, 'filter', 'card', 'warm-film', '60').status, 0);
  assert.equal(styleOf(root, 'card'), '--of-lut: url(looks/filter-warm-film-60.ctf)', 'ordinary video: the filter alone');
  assert.ok(existsSync(join(root, 'looks', 'filter-warm-film-60.ctf')));
  /* a balance after it goes in before the output, the filter staying last */
  color(root, 'balance', 'card');
  assert.deepEqual(chainOf(styleOf(root, 'card')), ['looks/in-rec709.ctf', 'looks/shot-card.ctf', 'looks/out-rec709.ctf', 'looks/filter-warm-film-60.ctf']);
  color(root, 'filter', 'card', 'none');
  assert.deepEqual(chainOf(styleOf(root, 'card')), ['looks/in-rec709.ctf', 'looks/shot-card.ctf', 'looks/out-rec709.ctf']);
  assert.equal(color(root, 'filter', 'warm-film').status, 2, 'which clips must be said');
});
