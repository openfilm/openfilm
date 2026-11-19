import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

test('the Windows installer keeps the videos under node_modules', () => {
  /* release.mjs builds as it is run, so its setting is read as written */
  const script = readFileSync(new URL('./release.mjs', import.meta.url), 'utf8');
  assert.match(script, /nsis: \{[^}]*preCompressedFileExtensions: null/s);
});

const powershell = process.env.OPENFILM_TEST_POWERSHELL || (process.platform === 'win32' ? 'powershell.exe' : null);
test('installer preflight accepts an app-only tree and refuses to remove projects, personal assets or junctions', { skip: !powershell }, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-installer-protection-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const install = join(scratch, 'OpenFilm 安装');
  const home = join(scratch, 'profile');
  const runtime = join(install, 'resources', 'runtime');
  await mkdir(runtime, { recursive: true });
  await mkdir(home);
  await writeFile(join(install, 'OpenFilm.exe'), 'binary');
  const script = fileURLToPath(new URL('../build/protect-install.ps1', import.meta.url));
  const verify = (path, code) => {
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-AppFile', 'OpenFilm.exe', '-UninstallFile', 'Uninstall OpenFilm.exe'], {
      env: { ...process.env, OPENFILM_HOME: home, OPENFILM_SHARED_HOME: home, USERPROFILE: scratch, OPENFILM_INSTALL_CHECK_PATH: path },
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, code, result.stderr || result.stdout);
  };
  verify(install, 0);
  verify(join(scratch, 'Not installed'), 0);
  verify(parse(install).root, 20);

  const project = join(runtime, 'Project');
  await mkdir(project);
  await writeFile(join(project, 'FILM.HTML'), 'user work');
  verify(install, 10);
  await rm(join(project, 'FILM.HTML'));
  await mkdir(join(project, '.film'));
  verify(install, 10);
  await rm(join(project, '.film'), { recursive: true });

  const prefs = join(home, 'prefs.json');
  await writeFile(prefs, JSON.stringify({ projectsFolder: project }));
  verify(install, 10);
  await writeFile(prefs, '{');
  verify(install, 0);

  const saved = join(runtime, '.openfilm-library.json');
  await writeFile(saved, '{}');
  verify(install, 10);
  await rm(saved);
  await writeFile(join(install, 'notes.txt'), 'personal');
  verify(install, 10);
  await rm(join(install, 'notes.txt'));
  await symlink(home, join(runtime, 'folder link'), process.platform === 'win32' ? 'junction' : 'dir');
  verify(install, 10);
});

test('a Windows upgrade refuses to run a legacy uninstaller while a project is in its install directory', {
  skip: process.platform !== 'win32', timeout: 240_000,
}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-windows-upgrade-'));
  const name = `openfilm-fixture-${randomUUID()}`;
  const install = join(scratch, 'Installed app');
  const project = join(install, 'resources', 'runtime', 'User project');
  const bootstrap = join(scratch, 'builder');
  const resources = fileURLToPath(new URL('../build/', import.meta.url));
  const require = createRequire(import.meta.url);
  const builder = require('electron-builder');
  const run = (exe, args) => {
    const result = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 45_000 });
    assert.ifError(result.error);
    return result.status;
  };
  const build = async (version, protectedInstall) => {
    const app = join(scratch, `app-${version}`);
    const output = join(scratch, `out-${version}`);
    await mkdir(join(app, 'resources', 'runtime'), { recursive: true });
    await writeFile(join(app, `${name}.exe`), version);
    await writeFile(join(app, 'resources', 'runtime', 'native.exe'), 'bundled');
    await writeFile(join(bootstrap, 'package.json'), JSON.stringify({ name, version, author: 'OpenFilm', description: 'Installer test' }));
    const paths = await builder.build({
      projectDir: bootstrap, prepackaged: app, publish: 'never', win: ['nsis'], x64: true,
      config: {
        appId: `dev.openfilm.${name}`, productName: name, electronVersion: require('electron/package.json').version,
        directories: { output, buildResources: bootstrap }, win: { signAndEditExecutable: false },
        nsis: {
          ...(protectedInstall ? { include: join(bootstrap, 'installer.nsh') } : {}),
          oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
          createDesktopShortcut: false, createStartMenuShortcut: false, deleteAppDataOnUninstall: false,
        },
      },
    });
    return paths.find(path => path.endsWith('.exe'));
  };
  try {
    await mkdir(bootstrap);
    const legacy = await build('1.0.0', false);
    for (const file of ['installer.nsh', 'protect-install.ps1']) {
      await writeFile(join(bootstrap, file), await readFile(join(resources, file)));
    }
    const upgrade = await build('1.0.1', true);
    assert.equal(run(legacy, ['/S', `/D=${install}`]), 0);
    await mkdir(join(project, '.film', 'history'), { recursive: true });
    await writeFile(join(project, 'film.html'), 'user work');
    await writeFile(join(project, '.film', 'history', 'original'), 'version history');
    assert.equal(run(upgrade, ['/S']), 2);
    assert.equal(await readFile(join(install, `${name}.exe`), 'utf8'), '1.0.0');
    assert.equal(await readFile(join(project, 'film.html'), 'utf8'), 'user work');
    assert.equal(await readFile(join(project, '.film', 'history', 'original'), 'utf8'), 'version history');
    const preserved = join(scratch, 'Preserved project');
    await rename(project, preserved);
    assert.equal(run(upgrade, ['/S']), 0);
    assert.equal(await readFile(join(install, `${name}.exe`), 'utf8'), '1.0.1');
    assert.equal(await readFile(join(preserved, 'film.html'), 'utf8'), 'user work');
  } finally {
    const uninstaller = join(install, `Uninstall ${name}.exe`);
    await rm(project, { recursive: true, force: true });
    await readFile(uninstaller).then(() => run(uninstaller, ['/S', `_?=${install}`]), () => {});
    await rm(scratch, { recursive: true, force: true });
  }
});
