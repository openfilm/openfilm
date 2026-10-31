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

/** PowerShell's exit code when the item in $env:OPENFILM_TRASH cannot go to the Recycle Bin; why is its output (JSON). */
const CANNOT_RECYCLE = 3;
/**
 * Windows: the item in $env:OPENFILM_TRASH to the Recycle Bin, once it is known the bin takes it. The shell recycles
 * only on a fixed drive, whose bin holds items up to a size (the person's setting, a policy's, or about a twentieth of
 * the drive when neither was set) and is not set to delete right away; anything else it deletes for good, asking only
 * through the confirmations `OnlyErrorDialogs` turns off. So those are checked first, by the shell's own settings, and
 * a drive whose bin cannot be looked up (no volume id: a `subst` drive, a volume mounted in a folder) is refused too.
 * A folder's size is its own files': a link in it (a NAS folder linked into a project) is not followed, as
 * `Get-ChildItem -Recurse` of Windows PowerShell would.
 */
const RECYCLE = `
$ErrorActionPreference = 'Stop'
function Refuse($why, $drive, $size, $holds) { Write-Output (ConvertTo-Json -Compress @{ why = $why; drive = $drive; size = $size; holds = $holds }); exit ${CANNOT_RECYCLE} }
function Size($bytes) { if ($bytes -ge 1GB) { [string][math]::Round($bytes / 1GB, 1) + ' GB' } else { [string][math]::Round($bytes / 1MB, 1) + ' MB' } }
function Measure($dir) {
  $sum = [double]0
  foreach ($e in @(Get-ChildItem -LiteralPath $dir -Force)) {
    if ($e.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    if ($e.PSIsContainer) { $sum += Measure $e.FullName } else { $sum += $e.Length }
  }
  $sum
}
$root = [System.IO.Path]::GetPathRoot($env:OPENFILM_TRASH)
if ($root.StartsWith('\\\\')) { Refuse 'network' $root }
$item = Get-Item -LiteralPath $env:OPENFILM_TRASH -Force
$drive = New-Object System.IO.DriveInfo($root)
$letter = $root.Substring(0, 2)
switch ([string]$drive.DriveType) {
  'Fixed' { }
  'Network' { Refuse 'network' $letter }
  'Removable' { Refuse 'removable' $letter }
  default { Refuse 'no-bin' $letter }
}
$percent = $null
foreach ($hive in @('HKCU', 'HKLM')) {
  $policy = Get-ItemProperty -Path ($hive + ':\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer') -ErrorAction SilentlyContinue
  if ($policy.NoRecycleFiles -eq 1) { Refuse 'policy' $letter }
  if ($null -ne $policy.RecycleBinSize) { $percent = [double]$policy.RecycleBinSize }
}
$volume = [string](mountvol $letter /L)
if ($volume -notmatch '\\{[0-9A-Fa-f-]+\\}') { Refuse 'no-volume' $letter }
$bin = Get-ItemProperty -Path ('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket\\Volume\\' + $Matches[0]) -ErrorAction SilentlyContinue
if ($bin.NukeOnDelete -eq 1) { Refuse 'nuke' $letter }
$holds = if ($null -ne $percent) { $drive.TotalSize * $percent / 100 } elseif ($null -ne $bin.MaxCapacity) { [double]$bin.MaxCapacity * 1MB } else { $drive.TotalSize * 0.05 }
$size = if ($item.PSIsContainer) { Measure $item.FullName } else { [double]$item.Length }
if ($size -gt $holds) { Refuse 'too-big' $letter (Size $size) (Size $holds) }
Add-Type -AssemblyName Microsoft.VisualBasic
if ($item.PSIsContainer) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($item.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin') }
else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($item.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin') }
`;

/** @typedef {{ why: 'network' | 'removable' | 'no-bin' | 'no-volume' | 'policy' | 'nuke' | 'too-big', drive: string, size?: string, holds?: string }} Refusal */

/**
 * Why `name` cannot go to the Recycle Bin, as Studio's API says it: the reason the check gave, in English; Studio's UI
 * says the same from the answer's `why` in the person's language.
 * @param {string} name @param {Refusal} r
 */
export function recycleRefused(name, r) {
  const why = r.why === 'network' ? 'it is on a network drive, which has no Recycle Bin'
    : r.why === 'removable' ? 'it is on a removable drive, which has no Recycle Bin'
    : r.why === 'no-bin' ? `drive ${r.drive} has no Recycle Bin`
    : r.why === 'no-volume' ? `Windows did not say which volume drive ${r.drive} is, so its Recycle Bin's settings could not be checked`
    : r.why === 'policy' ? 'a policy here has the Recycle Bin delete files right away'
    : r.why === 'nuke' ? `the Recycle Bin of drive ${r.drive} is set to delete files right away`
    : `it is ${r.size}, more than the Recycle Bin of drive ${r.drive} holds (${r.holds})`;
  return `${name} cannot go to the Recycle Bin: ${why}. It was left where it is; File Explorer can delete it for good`;
}

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
      /** @type {Refusal} */
      const why = JSON.parse(String(stdout));
      throw new HttpError(409, recycleRefused(basename(path), why), { code: 'recycle', name: basename(path), ...why });
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
