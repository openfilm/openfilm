import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { programFiles, unlistedProgramFiles } from './installer-files.mjs';

const nsh = readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8');

test('the installer script names OpenFilm\'s program files, and a packaged file it misses is found', async (t) => {
  const lists = programFiles(nsh, 'OpenFilm.exe');
  for (const file of ['openfilm.exe', 'ffmpeg.dll', 'resources.pak', 'resources\\app.asar', 'resources\\app-update.yml', 'resources\\elevate.exe']) {
    assert.ok(lists.files.includes(file), file);
  }
  assert.deepEqual(lists.folders, ['locales', 'resources\\app.asar.unpacked', 'resources\\runtime\\ffmpeg', 'resources\\runtime\\ms-playwright']);

  /* a packaged app with every listed file, as electron-builder lays it out */
  const app = await mkdtemp(join(tmpdir(), 'of-installer-files-'));
  t.after(() => rm(app, { recursive: true, force: true }));
  const put = async (/** @type {string} */ path) => {
    const file = join(app, ...path.split('\\'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, 'bundled');
  };
  for (const file of lists.files) await put(file === 'openfilm.exe' ? 'OpenFilm.exe' : file);
  for (const folder of lists.folders) await put(`${folder}\\deep\\file.bin`);
  assert.deepEqual(unlistedProgramFiles(app, lists), []);

  /* what a later Electron or a new bundled program would add */
  for (const added of ['new.dll', 'plugins\\one.dll', 'resources\\extra.bin', 'resources\\runtime\\python\\python.exe']) await put(added);
  assert.deepEqual(unlistedProgramFiles(app, lists).sort(), ['new.dll', 'plugins\\', 'resources\\extra.bin', 'resources\\runtime\\python\\']);
});

test('the uninstaller deletes folders whole only where they are OpenFilm\'s own, and asks for no other program', () => {
  /* the installation folder, resources and resources\runtime may hold a person's files: never `RMDir /r` on them */
  const recursive = nsh.split(/\r?\n/).filter((line) => /^\s*RMDir\s+\/r\b/.test(line)).map((line) => line.trim());
  assert.deepEqual(recursive, ['RMDir /r "$INSTDIR\\${NAME}"']);
  /* a check that needs PowerShell stops the installation where a policy or a virus scanner blocks it */
  assert.doesNotMatch(nsh, /powershell|nsExec/i);
  assert.doesNotMatch(nsh, /MessageBox|\bQuit\b/);
});
