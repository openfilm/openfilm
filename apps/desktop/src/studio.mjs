/**
 * Runs Studio for the window (src/studio-process.mjs, in a utility process) and keeps it running.
 *
 * One Studio per machine: when `openfilm open` already started one, it is asked to stop (`POST /api/quit`, after it
 * has written its history) and the app's takes its place, on the same port, so the address agents and bookmarks
 * know keeps working. When the port is held by something else, Studio takes any free one.
 *
 * Asked to stop only once nothing is being exported or made (`whenIdle`): either cut off is lost. While one runs, that
 * Studio says no; the window does not wait for it (an export can take many minutes) but starts its own on another
 * port, and the other one is asked again every few seconds until it has stopped. Its pages lose their Studio then;
 * the window, agents' `openfilm` commands and run.json are the app's from the start.
 */
import { utilityProcess } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('./studio-process.mjs', import.meta.url));
const QUIT_WAIT_MS = 10_000;
const START_WAIT_MS = 30_000;
const EXPORT_RETRY_MS = 5_000;

/** The Studio `openfilm open` started, if it answers. */
async function advertised(home) {
  let run;
  try { run = JSON.parse(readFileSync(join(home, 'run.json'), 'utf8')); } catch { return null; }
  try {
    const health = await (await fetch(`${run.origin}/api/health`, { signal: AbortSignal.timeout(1500) })).json();
    return health.product === 'openfilm-studio' ? run : null;
  } catch { return null; }
}

/** Ask a Studio to stop once it is idle: 'exporting' when it says not now, else 'asked'. */
async function askToQuit(run) {
  const res = await fetch(`${run.origin}/api/quit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-studio-key': run.key },
    body: JSON.stringify({ whenIdle: true }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => null);
  return res?.status === 409 ? 'exporting' : 'asked';
}

/** Ask the machine's other Studio to stop, and wait until it has; while it exports, ask again later and go on. */
async function takeOver(home, log) {
  const run = await advertised(home);
  if (!run) return;
  if (await askToQuit(run) === 'exporting') {
    log(`the Studio at ${run.origin} is exporting: it is asked to stop once that is done; this one takes another port\n`);
    const again = () => setTimeout(async () => { if (await askToQuit(run) === 'exporting') again(); }, EXPORT_RETRY_MS);
    again();
    return;
  }
  const deadline = Date.now() + QUIT_WAIT_MS;
  while (Date.now() < deadline) {
    try { await fetch(`${run.origin}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { return; }
    await new Promise((done) => setTimeout(done, 150));
  }
}

/**
 * @param {{ home: string, port: number, env: Record<string, string>, onOpen: (url: string) => void,
 *           onBrowser: (state: { state: string, message?: string }) => void, log: (line: string) => void }} options
 * @returns {Promise<{ origin: string, filmOrigin: string, key: string, child: Electron.UtilityProcess }>}
 */
function fork({ port, env, onOpen, onBrowser, log }) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(ENTRY, [], {
      serviceName: 'OpenFilm Studio',
      env: { ...env, OPENFILM_STUDIO_PORT: String(port) },
      stdio: 'pipe',
    });
    child.stdout?.on('data', (d) => log(String(d)));
    child.stderr?.on('data', (d) => log(String(d)));
    const timer = setTimeout(() => { child.kill(); reject(new Error('Studio did not start in time')); }, START_WAIT_MS);
    let settled = false;
    child.on('message', (message) => {
      if (message?.type === 'ready' && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ origin: message.origin, filmOrigin: message.filmOrigin, key: message.key, child });
      } else if (message?.type === 'failed' && !settled) {
        settled = true;
        clearTimeout(timer);
        reject(Object.assign(new Error(message.message), { code: message.code }));
      } else if (message?.type === 'open') onOpen(message.url);
      else if (message?.type === 'browser' || message?.type === 'ffmpeg') onBrowser(message);
    });
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Studio stopped as it started (${code})`));
    });
  });
}

/**
 * Start the window's Studio. `onExit` hears when it stops after it had started (a crash): `restart()` starts it again.
 * @param {{ home: string, port: number, env: Record<string, string>, onOpen: (url: string) => void,
 *           onBrowser: (state: { state: string, message?: string }) => void, onExit: (code: number) => void,
 *           log: (line: string) => void }} options
 */
export async function startWindowStudio(options) {
  await takeOver(options.home, options.log);
  let studio;
  try {
    studio = await fork(options);
  } catch (e) {
    if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e;
    options.log(`port ${options.port} is taken; Studio takes another\n`);
    studio = await fork({ ...options, port: 0 });
  }
  let quitting = false;
  studio.child.once('exit', (code) => { if (!quitting) options.onExit(code); });
  return {
    ...studio,
    /** Stop Studio: it writes its history first. */
    quit() {
      quitting = true;
      return new Promise((done) => {
        if (studio.child.pid == null) return done(undefined);
        const timer = setTimeout(() => { studio.child.kill(); done(undefined); }, QUIT_WAIT_MS);
        studio.child.once('exit', () => { clearTimeout(timer); done(undefined); });
        studio.child.postMessage({ type: 'quit' });
      });
    },
  };
}
