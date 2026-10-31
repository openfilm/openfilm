import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moveToTrash } from './trash.mjs';

const linuxTrash = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-linux-trash-'));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const kept = { XDG_DATA_HOME: process.env.XDG_DATA_HOME, OPENFILM_TRASH_DIR: process.env.OPENFILM_TRASH_DIR };
  Object.defineProperty(process, 'platform', { value: 'linux' });
  process.env.XDG_DATA_HOME = join(root, 'data');
  delete process.env.OPENFILM_TRASH_DIR;
  t.after(() => {
    Object.defineProperty(process, 'platform', platform);
    for (const [key, value] of Object.entries(kept)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, files: join(root, 'data', 'Trash', 'files'), info: join(root, 'data', 'Trash', 'info') };
};

test('concurrent moves of files with the same name keep both files and their original paths', async (t) => {
  const { root, files, info } = linuxTrash(t);
  const paths = ['one', 'two'].map((folder) => {
    mkdirSync(join(root, folder));
    const path = join(root, folder, 'take.wav');
    writeFileSync(path, folder);
    return path;
  });
  await Promise.all(paths.map(moveToTrash));
  const names = readdirSync(files).sort();
  assert.deepEqual(names, ['take 2.wav', 'take.wav']);
  assert.deepEqual(names.map((name) => readFileSync(join(files, name), 'utf8')).sort(), ['one', 'two']);
  assert.ok(paths.every((path) => !existsSync(path)));
  const originals = names.map((name) => decodeURI(readFileSync(join(info, `${name}.trashinfo`), 'utf8').match(/^Path=(.*)$/m)[1]));
  assert.deepEqual(originals.sort(), paths.sort());
});

test('an existing trash record is not overwritten even when its file is missing', async (t) => {
  const { root, files, info } = linuxTrash(t);
  mkdirSync(info, { recursive: true });
  writeFileSync(join(info, 'take.wav.trashinfo'), 'keep this record');
  const path = join(root, 'take.wav');
  writeFileSync(path, 'new recording');
  await moveToTrash(path);
  assert.equal(readFileSync(join(info, 'take.wav.trashinfo'), 'utf8'), 'keep this record');
  assert.equal(readFileSync(join(files, 'take 2.wav'), 'utf8'), 'new recording');
});

test('a failed move leaves no new trash record', async (t) => {
  const { root, files, info } = linuxTrash(t);
  await assert.rejects(moveToTrash(join(root, 'missing.wav')), (e) => e.code === 'ENOENT');
  assert.deepEqual(readdirSync(files), []);
  assert.deepEqual(readdirSync(info), []);
});

/* ── Windows: the Recycle Bin itself, or a stand-in for its PowerShell elsewhere ── */

const win = process.platform === 'win32';
/* the tests that set the Recycle Bin's own settings (HKCU) run only in CI: a run killed before they are put back
   would leave every delete on the developer's drive permanent */
const ci = win && !!process.env.CI;
const ps = (/** @type {string} */ script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
/** A scratch folder, with the real trash in use (no OPENFILM_TRASH_DIR). */
const realTrash = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-win-trash-'));
  const kept = process.env.OPENFILM_TRASH_DIR;
  delete process.env.OPENFILM_TRASH_DIR;
  t.after(() => {
    if (kept !== undefined) process.env.OPENFILM_TRASH_DIR = kept;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
};
/** How many items of the Recycle Bin are named `name` (shown without its extension, where Explorer hides those). */
const recycled = (/** @type {string} */ name) => Number(ps(`@((New-Object -ComObject Shell.Application).NameSpace(10).Items() | Where-Object { $_.Name -like '${name}*' }).Count`));

test('on Windows, a file and a folder go to the Recycle Bin', { skip: !win && 'Windows only' }, async (t) => {
  const root = realTrash(t);
  const id = Math.random().toString(36).slice(2, 8);
  const file = join(root, `take-${id}.wav`);
  const folder = join(root, `shot-${id}`);
  writeFileSync(file, 'a take');
  mkdirSync(folder);
  writeFileSync(join(folder, 'frame.png'), 'a frame');
  await moveToTrash(file);
  await moveToTrash(folder);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(folder), false);
  assert.equal(recycled(`take-${id}`), 1, 'the file is in the bin');
  assert.equal(recycled(`shot-${id}`), 1, 'the folder is in the bin');
});

test('on Windows, an item the Recycle Bin of its drive would not keep is refused, and stays: bigger than it holds, or a bin that deletes right away; a folder is measured without the links in it', { skip: !ci && 'Windows CI only: it sets the Recycle Bin\'s settings' }, async (t) => {
  const root = realTrash(t);
  const volume = ps(`mountvol ${root.slice(0, 2)} /L`).match(/\{[0-9A-Fa-f-]+\}/)?.[0];
  assert.ok(volume, 'the drive has a volume id');
  const key = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket\\Volume\\${volume}`;
  /* the bin's settings as they were, put back after */
  const had = ps(`if (Test-Path '${key}') { $p = Get-ItemProperty '${key}'; ConvertTo-Json @{ key = $true; MaxCapacity = $p.MaxCapacity; NukeOnDelete = $p.NukeOnDelete } } else { ConvertTo-Json @{ key = $false } }`);
  const was = JSON.parse(had);
  t.after(() => {
    if (!was.key) { ps(`Remove-Item '${key}' -Recurse -Force`); return; }
    for (const name of ['MaxCapacity', 'NukeOnDelete']) {
      if (was[name] == null) ps(`Remove-ItemProperty '${key}' -Name ${name} -ErrorAction SilentlyContinue`);
      else ps(`Set-ItemProperty '${key}' -Name ${name} -Value ${was[name]} -Type DWord`);
    }
  });
  const big = join(root, 'render.mp4');
  writeFileSync(big, Buffer.alloc(2 * 2 ** 20));
  ps(`New-Item '${key}' -Force | Out-Null; Set-ItemProperty '${key}' -Name MaxCapacity -Value 1 -Type DWord; Set-ItemProperty '${key}' -Name NukeOnDelete -Value 0 -Type DWord`);
  await assert.rejects(moveToTrash(big), (e) => e.status === 409 && /^render\.mp4 cannot go to the Recycle Bin: it is 2 MB, more than the Recycle Bin of drive [A-Z]: holds \(1 MB\)\. It was left where it is/.test(e.message)
    && e.extra.code === 'recycle' && e.extra.why === 'too-big' && e.extra.name === 'render.mp4' && /^[A-Z]:$/.test(e.extra.drive) && e.extra.size === '2 MB' && e.extra.holds === '1 MB');
  assert.equal(existsSync(big), true, 'left where it was');
  /* a project linking a folder kept elsewhere (a NAS): the link's target is not its size, nor followed */
  const project = join(root, 'Trip');
  const elsewhere = join(root, 'nas');
  mkdirSync(project);
  mkdirSync(elsewhere);
  writeFileSync(join(elsewhere, 'big.mp4'), Buffer.alloc(2 * 2 ** 20));
  writeFileSync(join(project, 'film.html'), '<film>');
  ps(`New-Item -ItemType Junction -Path '${join(project, 'assets')}' -Target '${elsewhere}' | Out-Null`);
  await moveToTrash(project);
  assert.equal(existsSync(project), false, 'the project went: its own files are small');
  assert.equal(existsSync(join(elsewhere, 'big.mp4')), true, 'what the link led to stays');
  const small = join(root, 'take.wav');
  writeFileSync(small, 'a take');
  ps(`Set-ItemProperty '${key}' -Name MaxCapacity -Value 4096 -Type DWord; Set-ItemProperty '${key}' -Name NukeOnDelete -Value 1 -Type DWord`);
  await assert.rejects(moveToTrash(small), (e) => e.status === 409 && /take\.wav cannot go to the Recycle Bin: the Recycle Bin of drive [A-Z]: is set to delete files right away/.test(e.message) && e.extra.why === 'nuke');
  assert.equal(existsSync(small), true);
});

test('on Windows, an item on a network path is refused, and stays', { skip: !win && 'Windows only' }, async (t) => {
  const root = realTrash(t);
  const file = join(root, 'take.wav');
  writeFileSync(file, 'a take');
  const unc = `\\\\localhost\\${file[0]}$${file.slice(2)}`;
  await assert.rejects(moveToTrash(unc), (e) => e.status === 409 && /take\.wav cannot go to the Recycle Bin: it is on a network drive, which has no Recycle Bin/.test(e.message) && e.extra.why === 'network');
  assert.equal(existsSync(file), true);
});

test('a PowerShell that refuses the Recycle Bin is told as the reason it gives, with the item\'s name, and answered for Studio to say in its language; any other failure as it is', { skip: win && 'the real PowerShell is tested above' }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-fake-ps-'));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const kept = { PATH: process.env.PATH, OPENFILM_TRASH_DIR: process.env.OPENFILM_TRASH_DIR };
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.env.PATH = `${root}:${process.env.PATH}`;
  delete process.env.OPENFILM_TRASH_DIR;
  t.after(() => {
    Object.defineProperty(process, 'platform', platform);
    for (const [key, value] of Object.entries(kept)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const fake = (/** @type {string} */ body) => writeFileSync(join(root, 'powershell.exe'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  fake('printf \'{"why":"removable","drive":"E:","size":null,"holds":null}\\n\'; exit 3');
  await assert.rejects(moveToTrash('/media/stick/take.wav'), (e) => e.status === 409
    && e.message === 'take.wav cannot go to the Recycle Bin: it is on a removable drive, which has no Recycle Bin. It was left where it is; File Explorer can delete it for good'
    && e.extra.code === 'recycle' && e.extra.why === 'removable' && e.extra.name === 'take.wav' && e.extra.drive === 'E:');
  fake('printf \'{"why":"no-volume","drive":"S:","size":null,"holds":null}\\n\'; exit 3');
  await assert.rejects(moveToTrash('/subst/Trip'), (e) => e.status === 409 && /^Trip cannot go to the Recycle Bin: Windows did not say which volume drive S: is, so its Recycle Bin's settings could not be checked\. It was left/.test(e.message));
  fake('echo "Get-Item : Cannot find path" >&2; exit 1');
  await assert.rejects(moveToTrash('/media/stick/take.wav'), (e) => e.status === undefined && /Cannot find path/.test(e.message));
});
