import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('the Windows installer keeps the videos under node_modules', () => {
  /* release.mjs builds as it is run, so its setting is read as written */
  const script = readFileSync(new URL('./release.mjs', import.meta.url), 'utf8');
  assert.match(script, /nsis: \{[^}]*preCompressedFileExtensions: null/s);
});

test('a Windows update or uninstall removes the program and keeps everything else in its folder', {
  skip: process.platform !== 'win32', timeout: 480_000,
}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-windows-upgrade-'));
  const name = `openfilm-fixture-${randomUUID()}`;
  /* a folder name with a space and non-ASCII characters, as many people's are */
  const install = join(scratch, 'Installed app 安装');
  const alone = join(scratch, 'App alone');
  const bootstrap = join(scratch, 'builder');
  const require = createRequire(import.meta.url);
  const builder = require('electron-builder');
  const run = (exe, args) => {
    const result = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 90_000 });
    assert.ifError(result.error);
    return result.status;
  };
  /* the installed uninstaller, run as electron-builder runs it: from a copy, so it can remove itself, and waited for */
  const uninstall = async (folder) => {
    const copy = join(scratch, 'uninstall.exe');
    await copyFile(join(folder, `Uninstall ${name}.exe`), copy);
    return run(copy, ['/S', `_?=${folder}`]);
  };
  const put = async (file, text) => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  };
  /* an app laid out as OpenFilm's is; `ours`: with OpenFilm's installer script, else electron-builder's own, whose
     uninstaller deletes the whole folder (OpenFilm 0.4.0 and earlier) */
  const build = async (version, ours) => {
    const app = join(scratch, `app-${version}`);
    const output = join(scratch, `out-${version}`);
    await put(join(app, `${name}.exe`), version);
    for (const file of ['ffmpeg.dll', 'locales/en-US.pak', 'resources/app.asar', 'resources/app.asar.unpacked/node_modules/openfilm/package.json',
      'resources/runtime/ffmpeg/ffmpeg.exe', `resources/runtime/ms-playwright/browser-${version}/headless.exe`]) {
      await put(join(app, file), 'bundled');
    }
    await put(join(bootstrap, 'package.json'), JSON.stringify({ name, version, author: 'OpenFilm', description: 'Installer test' }));
    const paths = await builder.build({
      projectDir: bootstrap, prepackaged: app, publish: 'never', win: ['nsis'], x64: true,
      config: {
        appId: `dev.openfilm.${name}`, productName: name, electronVersion: require('electron/package.json').version,
        directories: { output, buildResources: bootstrap }, win: { signAndEditExecutable: false },
        nsis: {
          ...(ours ? { include: fileURLToPath(new URL('../build/installer.nsh', import.meta.url)) } : {}),
          oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
          createDesktopShortcut: false, createStartMenuShortcut: false, deleteAppDataOnUninstall: false,
        },
      },
    });
    return paths.find(path => path.endsWith('.exe'));
  };
  /* what a person keeps in the folder the app is installed in: a project, a file of their own, and files inside
     the folders the app shares with them */
  const kept = {
    'My project/film.html': 'user work',
    'My project/.film/history/original': 'version history',
    'notes.txt': 'personal',
    'resources/footage.mp4': 'footage',
    'resources/runtime/User project/film.html': 'more user work',
  };
  const keptAll = async () => {
    for (const [file, text] of Object.entries(kept)) assert.equal(await readFile(join(install, file), 'utf8'), text, file);
  };
  const browser = (version) => join(install, 'resources', 'runtime', 'ms-playwright', `browser-${version}`);
  try {
    const legacy = await build('1.0.0', false);
    const update = await build('1.0.1', true);
    assert.equal(run(legacy, ['/S', `/D=${install}`]), 0);
    for (const [file, text] of Object.entries(kept)) await put(join(install, file), text);

    /* over a version whose own uninstaller deletes the whole folder: no question, nothing lost */
    assert.equal(run(update, ['/S']), 0);
    assert.equal(await readFile(join(install, `${name}.exe`), 'utf8'), '1.0.1');
    await keptAll();
    /* the previous version's program files went, they are not left under the new ones */
    assert.equal(existsSync(browser('1.0.0')), false);
    assert.equal(existsSync(browser('1.0.1')), true);

    /* over a version that has this uninstaller */
    assert.equal(run(update, ['/S']), 0);
    assert.equal(await readFile(join(install, `${name}.exe`), 'utf8'), '1.0.1');
    await keptAll();

    /* uninstalling removes the program and leaves the folder with what the person keeps in it */
    assert.equal(await uninstall(install), 0);
    for (const gone of [`${name}.exe`, `Uninstall ${name}.exe`, 'ffmpeg.dll', 'locales', 'resources/app.asar', 'resources/app.asar.unpacked',
      'resources/runtime/ffmpeg', 'resources/runtime/ms-playwright']) {
      assert.equal(existsSync(join(install, gone)), false, gone);
    }
    await keptAll();

    /* a folder with nothing but the program goes with it */
    assert.equal(run(update, ['/S', `/D=${alone}`]), 0);
    assert.equal(await readFile(join(alone, `${name}.exe`), 'utf8'), '1.0.1');
    assert.equal(await uninstall(alone), 0);
    assert.equal(existsSync(alone), false);
  } finally {
    for (const folder of [install, alone]) {
      if (existsSync(join(folder, `Uninstall ${name}.exe`))) await uninstall(folder).catch(() => {});
    }
    /* the copy of itself an installer keeps for the updater */
    if (process.env.LOCALAPPDATA) await rm(join(process.env.LOCALAPPDATA, `${name}-updater`), { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  }
});
