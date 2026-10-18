import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { ensurePreviews, isPreviewKey, previewDir, previewKey } from './preview-cache.mjs';
import { startPages } from './pages.mjs';

const page = (word) => `<!doctype html><body style="margin:0;background:#123"><p>${word}</p><script>window.film={duration:2,frame(){}}</script></body>`;

/** A project of one page clip, 320 × 180. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'of-previews-'));
  writeFileSync(join(dir, 'a.html'), page('a'));
  writeFileSync(join(dir, 'beat.wav'), 'not really a sound');
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'a', src: 'a.html' }] }] }));
  return dir;
}

/** Wait until `ok()`, a moment at a time. */
async function until(ok, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (ok()) return;
  throw new Error('waited too long');
}

test('a render is named by all its picture depends on: film.html and the pages change it, a sound does not', () => {
  const dir = project();
  const key = previewKey(dir, 0, 1, 30, 540);
  assert.ok(isPreviewKey(key));
  assert.equal(previewKey(dir, 0, 1, 30, 540), key, 'the same project, the same name');
  assert.notEqual(previewKey(dir, 0, 1.5, 30, 540), key, 'another stretch');
  assert.notEqual(previewKey(dir, 0, 1, 30, 720), key, 'another size');
  writeFileSync(join(dir, 'beat.wav'), 'another sound, the same picture');
  assert.equal(previewKey(dir, 0, 1, 30, 540), key);
  writeFileSync(join(dir, 'a.html'), page('changed'));
  const changed = previewKey(dir, 0, 1, 30, 540);
  assert.notEqual(changed, key, 'a page changed');
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'a', src: 'a.html', at: 0.5 }] }] }));
  assert.notEqual(previewKey(dir, 0, 1, 30, 540), changed, 'the film changed');
  /* the tools' own folder is not the picture's */
  mkdirSync(join(dir, '.film'), { recursive: true });
  writeFileSync(join(dir, '.film', 'settings.json'), '{}');
  assert.equal(previewKey(dir, 0, 1, 30, 540), previewKey(dir, 0, 1, 30, 540));
});

test('renders are made one at a time, on the frame grid; asked again under other names, the old ones are let go', async () => {
  const dir = project();
  const made = [];
  let finish = () => {};
  /* a renderer that writes its file once the test lets it */
  const make = (root, a, b, fps, height, out, signal) => new Promise((done, fail) => {
    made.push({ a, b, fps, height, signal });
    signal.addEventListener('abort', () => fail(new Error('cancelled')), { once: true });
    finish = () => { writeFileSync(out, 'video'); done(undefined); };
  });
  const [first] = ensurePreviews(dir, [[1.01, 2.02]], 30, 540, make);
  assert.equal(first.a, 1, 'its start on the frame before');
  assert.ok(Math.abs(first.b - 61 / 30) < 1e-9, 'its end on the frame after');
  await until(() => made.length === 1);
  assert.equal(ensurePreviews(dir, [[1.01, 2.02]], 30, 540, make)[0].state, 'making');
  finish();
  await until(() => existsSync(join(previewDir(dir), `${first.key}.mp4`)));
  assert.equal(ensurePreviews(dir, [[1.01, 2.02]], 30, 540, make)[0].state, 'ready');
  /* the film changes while another stretch renders: that render is let go */
  ensurePreviews(dir, [[3, 4]], 30, 540, make);
  await until(() => made.length === 2);
  writeFileSync(join(dir, 'a.html'), page('changed'));
  const [now] = ensurePreviews(dir, [[3, 4]], 30, 540, make);
  assert.ok(made[1].signal.aborted, 'the stale render stopped');
  assert.notEqual(now.state, 'ready');
  await until(() => made.length === 3);
  finish();
  await until(() => existsSync(join(previewDir(dir), `${now.key}.mp4`)));
});

test('the film\'s origin serves a render by its name from the project\'s cache, and nothing else there', async () => {
  const dir = project();
  mkdirSync(previewDir(dir), { recursive: true });
  const key = 'abcdef0123456789abcd';
  writeFileSync(join(previewDir(dir), `${key}.mp4`), 'video bytes');
  writeFileSync(join(previewDir(dir), 'notes.txt'), 'not a render');
  const pages = await startPages({ port: 0, editorOrigin: () => 'http://127.0.0.1:1', secret: 'k', projects: async () => [{ id: 'p', path: dir }] });
  try {
    const folder = pages.folderUrl({ id: 'p', path: dir });
    const got = await fetch(`${folder}__film/preview/${key}.mp4`);
    assert.equal(got.status, 200);
    assert.equal(await got.text(), 'video bytes');
    const part = await fetch(`${folder}__film/preview/${key}.mp4`, { headers: { range: 'bytes=0-4' } });
    assert.equal(part.status, 206, 'a video is read in ranges');
    for (const other of ['notes.txt', 'abc.mp4', `${key}.mp4.part.mp4`, `../${key}.mp4`]) {
      assert.notEqual((await fetch(`${folder}__film/preview/${other}`)).status, 200, other);
    }
  } finally {
    await pages.close();
  }
});

test('a stretch is rendered by the film\'s own renderer, its picture only, at the size asked', { timeout: 180_000 }, async () => {
  const dir = project();
  const [asked] = ensurePreviews(dir, [[0.5, 1.5]], 30, 90);
  const out = join(previewDir(dir), `${asked.key}.mp4`);
  await until(() => existsSync(out) || ensurePreviews(dir, [[0.5, 1.5]], 30, 90)[0].state === 'failed', 170_000);
  assert.ok(existsSync(out), 'rendered');
  const { execFileSync } = await import('node:child_process');
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,nb_frames', '-of', 'json', out], { encoding: 'utf8' }));
  assert.deepEqual(probe.streams.map((s) => s.codec_type), ['video'], 'no sound in it');
  assert.equal(probe.streams[0].height, 90);
  assert.equal(Number(probe.streams[0].nb_frames), 30, 'a second at 30 fps');
});
