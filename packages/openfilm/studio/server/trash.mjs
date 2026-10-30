// @ts-check
/**
 * Move a file or folder to the system's trash, so a person can take it back from there: Studio never deletes media
 * outright (a file the film no longer uses is in no version of the project's history, so a delete would be for good).
 *
 *   macOS    the system's own `trash` (macOS 15 and later): the Trash of the file's disk, with Put Back, and allowed
 *            where moving into ~/.Trash is not (a program without Full Disk Access); before it, ~/.Trash (with " 2",
 *            " 3" on a name already there)
 *   Linux    the freedesktop trash: ~/.local/share/Trash/{files,info}, with the .trashinfo that lets it be restored
 *   Windows  the Recycle Bin, through PowerShell. An item the Recycle Bin cannot take (on a network or removable
 *            drive, bigger than the bin holds, a bin set to delete right away) is refused and left where it is: the
 *            shell's own answer would be to delete it for good, without a word
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from './http.mjs';

const run = promisify(execFile);
/** macOS's own command for the Trash (macOS 15 and later). */
const MAC_TRASH = '/usr/bin/trash';

/** PowerShell's exit code when the item in $env:OPENFILM_TRASH cannot go to the Recycle Bin; the reason is its output. */
const CANNOT_RECYCLE = 3;
/**
 * Windows: the item in $env:OPENFILM_TRASH to the Recycle Bin, once it is known the bin takes it. The shell recycles
 * only on a fixed drive, whose bin holds items up to a size (the person's setting, a policy's, or about a twentieth of
 * the drive when neither was set) and is not set to delete right away; anything else it deletes for good, asking only
 * through the confirmations `OnlyErrorDialogs` turns off. So those are checked first, by the shell's own settings.
 */
const RECYCLE = `
$ErrorActionPreference = 'Stop'
function Refuse($why) { Write-Output $why; exit ${CANNOT_RECYCLE} }
function Size($bytes) { if ($bytes -ge 1GB) { [string][math]::Round($bytes / 1GB, 1) + ' GB' } else { [string][math]::Round($bytes / 1MB, 1) + ' MB' } }
$root = [System.IO.Path]::GetPathRoot($env:OPENFILM_TRASH)
if ($root.StartsWith('\\\\')) { Refuse 'it is on a network drive, which has no Recycle Bin' }
$item = Get-Item -LiteralPath $env:OPENFILM_TRASH -Force
$drive = New-Object System.IO.DriveInfo($root)
switch ([string]$drive.DriveType) {
  'Fixed' { }
  'Network' { Refuse 'it is on a network drive, which has no Recycle Bin' }
  'Removable' { Refuse 'it is on a removable drive, which has no Recycle Bin' }
  default { Refuse ('drive ' + $root + ' has no Recycle Bin') }
}
$letter = $root.Substring(0, 2)
$percent = $null
foreach ($hive in @('HKCU', 'HKLM')) {
  $policy = Get-ItemProperty -Path ($hive + ':\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer') -ErrorAction SilentlyContinue
  if ($policy.NoRecycleFiles -eq 1) { Refuse 'a policy here has the Recycle Bin delete files right away' }
  if ($null -ne $policy.RecycleBinSize) { $percent = [double]$policy.RecycleBinSize }
}
$bin = $null
$volume = [string](mountvol $letter /L)
if ($volume -match '\\{[0-9A-Fa-f-]+\\}') { $bin = Get-ItemProperty -Path ('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket\\Volume\\' + $Matches[0]) -ErrorAction SilentlyContinue }
if ($bin.NukeOnDelete -eq 1) { Refuse ('the Recycle Bin of drive ' + $letter + ' is set to delete files right away') }
$holds = if ($null -ne $percent) { $drive.TotalSize * $percent / 100 } elseif ($null -ne $bin.MaxCapacity) { [double]$bin.MaxCapacity * 1MB } else { $drive.TotalSize * 0.05 }
$size = if ($item.PSIsContainer) { [double](Get-ChildItem -LiteralPath $item.FullName -Recurse -Force -File | Measure-Object -Property Length -Sum).Sum } else { [double]$item.Length }
if ($size -gt $holds) { Refuse ('it is ' + (Size $size) + ', more than the Recycle Bin of drive ' + $letter + ' holds (' + (Size $holds) + ')') }
Add-Type -AssemblyName Microsoft.VisualBasic
if ($item.PSIsContainer) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($item.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin') }
else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($item.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin') }
`;

/** A name in `dir` that is free: `name`, else `name 2.ext`, `name 3.ext`… */
function freeName(/** @type {string} */ dir, /** @type {string} */ name) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 2; existsSync(join(dir, candidate)); n++) candidate = `${stem} ${n}${ext}`;
  return candidate;
}

/** @param {string} path an absolute path */
export async function moveToTrash(path) {
  /* tests (and anyone who wants deletes kept elsewhere) name the folder that stands for the trash */
  if (process.env.OPENFILM_TRASH_DIR) {
    const dir = process.env.OPENFILM_TRASH_DIR;
    await mkdir(dir, { recursive: true });
    await rename(path, join(dir, freeName(dir, basename(path))));
    return;
  }
  if (process.platform === 'win32') {
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', RECYCLE], { env: { ...process.env, OPENFILM_TRASH: path }, windowsHide: true });
    } catch (e) {
      const { code, stdout } = /** @type {{ code?: unknown, stdout?: string }} */ (e);
      if (code !== CANNOT_RECYCLE) throw e;
      throw new HttpError(409, `${basename(path)} cannot go to the Recycle Bin: ${String(stdout).trim()}. It was left where it is; File Explorer can delete it for good`);
    }
    return;
  }
  if (process.platform === 'darwin' && existsSync(MAC_TRASH)) {
    await run(MAC_TRASH, [path]);
    return;
  }
  if (process.platform === 'darwin') {
    const dir = join(homedir(), '.Trash');
    await mkdir(dir, { recursive: true });
    try { await rename(path, join(dir, freeName(dir, basename(path)))); }
    catch (e) {
      /* on another disk the file belongs in that disk's own trash, which the Finder knows */
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EXDEV') throw e;
      await run('osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run', path]);
    }
    return;
  }
  const root = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  const files = join(root, 'Trash', 'files');
  const info = join(root, 'Trash', 'info');
  await mkdir(files, { recursive: true });
  await mkdir(info, { recursive: true });
  const ext = extname(path), stem = basename(path, ext);
  for (let n = 1; ; n++) {
    const name = n === 1 ? basename(path) : `${stem} ${n}${ext}`;
    if (existsSync(join(files, name))) continue;
    const record = join(info, `${name}.trashinfo`);
    try {
      await writeFile(record, `[Trash Info]\nPath=${encodeURI(path)}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`, { flag: 'wx' });
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EEXIST') continue;
      throw e;
    }
    try { await rename(path, join(files, name)); }
    catch (e) { await rm(record, { force: true }); throw e; }
    return;
  }
}
