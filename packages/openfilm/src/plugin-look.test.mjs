import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filmHtml } from './film-doc.mjs';
import { lookArgs, lookProject, runLook } from './plugin-look.mjs';
import { UsageError } from './shared.mjs';

/** A project folder with a film of one picture, 2 s, that Studio has shown (so a look opens nothing). */
const project = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'of-plugin-look-')));
  mkdirSync(join(root, '.film'), { recursive: true });
  writeFileSync(join(root, '.film', 'opened'), '');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'card.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#486b8e"/></svg>');
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'assets/card.svg', time: [0, 2] }] }] }));
  return root;
};

test('a plugin\'s look reads what to look at, a moment or a stretch, --json and its own options; the project is the one around', () => {
  const root = project();
  try {
    const asked = lookArgs(['card', '3-6', '--json', '--count', '4'], { plugin: 'color', options: { count: { type: 'string' } }, cwd: join(root, 'assets') });
    assert.deepEqual([asked.project, asked.what, asked.at, asked.range, asked.json, asked.values.count], [root, 'card', null, [3, 6], true, '4']);
    const moment = lookArgs(['12.5'], { plugin: 'color', cwd: root });
    assert.deepEqual([moment.what, moment.at, moment.range, moment.json], [null, 12.5, null, false]);
    /* its pictures go under the project's .film/look/<plugin>/, made when asked for */
    assert.equal(existsSync(join(root, '.film', 'look', 'color')), false);
    assert.equal(moment.dir(), join(root, '.film', 'look', 'color'));
    assert.equal(existsSync(join(root, '.film', 'look', 'color')), true);
    /* the project around what it looks at, when the folder it runs in is in none */
    assert.equal(lookProject([join(root, 'assets', 'card.svg'), '2'], tmpdir()), root);
    assert.equal(lookProject(['2'], tmpdir()), null);
    assert.throws(() => lookArgs(['6-3'], { plugin: 'color', cwd: root }), UsageError);
    assert.throws(() => lookArgs(['--nope'], { plugin: 'color', cwd: root }), UsageError);
    assert.throws(() => lookArgs([], { plugin: 'color', cwd: tmpdir() }), /is not in a project/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runLook prints the lines or one JSON object, and exits as openfilm look does: 0, 1 failed, 2 not a project or a wrong command', async () => {
  const root = project();
  const ran = async (args, look, cwd = root) => {
    const out = [], err = [];
    const code = await runLook(look, { plugin: 'color', usage: 'openfilm color look [what] [t | a-b]', args, cwd, out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out, err };
  };
  try {
    const found = { lines: ['clip card · 0–2 s', 'white balance  6500 K', '→ .film/look/color/card.png'], files: [join(root, '.film/look/color/card.png')], data: { kelvin: 6500 } };
    assert.deepEqual(await ran(['card'], () => found), { code: 0, out: found.lines, err: [] });
    assert.deepEqual(await ran(['card', '--json'], () => found), { code: 0, out: [JSON.stringify({ ok: true, files: found.files, kelvin: 6500 })], err: [] });
    assert.equal((await ran([], () => ({ ok: false, lines: ['✗ the clip is clipped: 12 % over 1.0'] }))).code, 1);
    assert.deepEqual(await ran([], () => { throw new Error('ffmpeg is not there'); }), { code: 1, out: [], err: ['openfilm color look: ffmpeg is not there'] });
    assert.equal((await ran([], () => { throw new UsageError('no clip nope'); })).code, 2);
    assert.equal((await ran(['--bad'], () => found)).code, 2);
    assert.deepEqual(await ran([], () => found, tmpdir()), { code: 2, out: [], err: [`openfilm color look: ${tmpdir()} is not in a project`] });
    assert.deepEqual(await ran(['--help'], () => found, tmpdir()), { code: 0, out: ['openfilm color look [what] [t | a-b]'], err: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('`openfilm edit look` is `openfilm look`: the same lines, the same status', { timeout: 120_000 }, () => {
  const root = project();
  const scratch = mkdtempSync(join(tmpdir(), 'of-plugin-look-home-'));
  const env = { ...process.env };
  for (const name of ['HOME', 'SHARED_HOME', 'LIBRARY', 'EXPORTS', 'SKILLS']) env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  const bin = fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url));
  const run = (...args) => {
    const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, env, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  try {
    for (const words of [[], ['1'], ['0-1'], ['6-3'], ['--count', '4']]) {
      const own = run('look', ...words);
      assert.ok(own.stdout || own.stderr, `openfilm look ${words.join(' ')} says something`);
      assert.deepEqual(run('edit', 'look', ...words), own, `openfilm edit look ${words.join(' ')}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});
