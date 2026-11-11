import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { openProject } from './projects.mjs';
import { startStudio } from './server.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('the mix is measured from the sounds as the preview names them, on the address the film is served at', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 60_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-mix-loudness-'));
  const variables = { OPENFILM_HOME: join(root, 'home'), OPENFILM_SHARED_HOME: join(root, 'shared'), OPENFILM_LIBRARY: join(root, 'library') };
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  Object.assign(process.env, variables);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  const folder = join(variables.OPENFILM_LIBRARY, 'Mix');
  mkdirSync(join(folder, 'assets', 'vo takes'), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2', '-ac', '2', join(folder, 'assets', 'vo takes', 'line 1.wav')]);
  writeFileSync(join(folder, 'film.html'), filmHtml({ tracks: [{ clips: [{ id: 'vo', src: 'assets/vo takes/line 1.wav' }] }] }));
  const project = await openProject(folder);
  const studio = await startStudio({ port: 0, openBrowser: () => {} });
  t.after(() => studio.close());
  const api = (path, body) => fetch(studio.origin + path, {
    method: body ? 'POST' : 'GET', headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const { folder: served } = await (await api(`/api/projects/${project.id}`)).json();
  const sound = { clip: 'vo', src: new URL('assets/vo%20takes/line%201.wav', served).pathname, at: 0, from: 0, to: 2, volume: 1, speed: 1 };
  const measured = await (await api(`/api/projects/${project.id}/mix-loudness`, { sounds: [sound], duration: 2 })).json();
  assert.ok(measured.lufs != null && measured.lufs < -10 && measured.lufs > -30, JSON.stringify(measured));
  /* a sound that is not the film's (another address, a file outside the project) is not measured */
  const outside = await (await api(`/api/projects/${project.id}/mix-loudness`, { sounds: [{ ...sound, src: '/p/other/assets/vo%20takes/line%201.wav' }], duration: 2 })).json();
  assert.deepEqual(outside, { lufs: null, peak: null });
  assert.equal((await api(`/api/projects/${project.id}/mix-loudness`, { sounds: 'all', duration: 2 })).status, 400);
});
