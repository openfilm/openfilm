/**
 * Studio, inside the app: an Electron utility process running the open-source Studio (the `openfilm` package's
 * `startStudio`), serving the window's page (shell/) as its editor. It is the machine's Studio (`advertise`): an
 * agent's `openfilm open` finds it and shows its project in the app's window, not in a browser.
 *
 * Talks to the main process over `process.parentPort`:
 *   → { type: 'ready', origin, filmOrigin, key }   listening
 *   → { type: 'failed', code, message }              could not start (code 'EADDRINUSE': the port is taken)
 *   → { type: 'browser', state: 'downloading' | 'ready' | 'failed', message? }   the headless browser pages draw in
 *   → { type: 'ffmpeg', found }                      whether ffmpeg and ffprobe are on the PATH (video pictures, sound, export)
 *   → { type: 'open', url }                          Studio wants something shown in the person's browser
 *   ← { type: 'quit' }                               stop (history is written first)
 *   ← { type: 'working', folders }                   the folders the chat's agents are working in now (not deletable)
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { startStudio } from 'openfilm/studio';
import { launch } from 'openfilm/host';

const parent = process.parentPort;
const send = (message) => parent.postMessage(message);

let studio = null;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await studio?.close().catch(() => {});
  process.exit(0);
}
/** the folders the chat's agents are working in, as the main process last told */
let working = [];
parent.on('message', ({ data }) => {
  if (data?.type === 'quit') void stop();
  if (data?.type === 'working' && Array.isArray(data.folders)) working = data.folders.filter((f) => typeof f === 'string');
});

const port = Number(process.env.OPENFILM_STUDIO_PORT);
try {
  studio = await startStudio({
    port: Number.isInteger(port) ? port : 0,
    advertise: true,
    openBrowser: (url) => send({ type: 'open', url }),
    /* another app (or `openfilm open`) asked this Studio to stop: the window still needs it, so it stays and says so */
    stays: true,
    working: () => working,
    /* the window's page, Studio's editor with the chat beside it (shell/), in place of the editor alone */
    ...(process.env.OPENFILM_EDITOR_DIR ? { editorDir: process.env.OPENFILM_EDITOR_DIR } : {}),
  });
  send({ type: 'ready', origin: studio.origin, filmOrigin: studio.filmOrigin, key: studio.key });
} catch (e) {
  send({ type: 'failed', code: e?.code ?? null, message: e?.message ?? String(e) });
  process.exit(1);
}

send({ type: 'ffmpeg', found: ['ffmpeg', 'ffprobe'].every((bin) => !spawnSync(bin, ['-version'], { stdio: 'ignore' }).error) });

/* Studio draws pages' pictures in Playwright's headless browser: download it once, the first time (about 100 MB) */
try {
  await (await launch()).close();
  send({ type: 'browser', state: 'ready' });
} catch (e) {
  if (!/Executable doesn't exist/.test(e?.message ?? '')) send({ type: 'browser', state: 'failed', message: e?.message ?? String(e) });
  else {
    send({ type: 'browser', state: 'downloading' });
    const openfilm = dirname(createRequire(import.meta.url).resolve('openfilm/package.json'));
    const cli = join(dirname(createRequire(join(openfilm, 'package.json')).resolve('playwright-core/package.json')), 'cli.js');
    const child = spawn(process.execPath, [cli, 'install', 'chromium-headless-shell'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' });
    child.once('exit', (code) => send(code === 0 ? { type: 'browser', state: 'ready' } : { type: 'browser', state: 'failed', message: `the download stopped (${code})` }));
    child.once('error', (error) => send({ type: 'browser', state: 'failed', message: error.message }));
  }
}
