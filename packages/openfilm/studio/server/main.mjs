// @ts-check
/**
 * Studio's process: `openfilm open` starts it in the background when none is running. It writes where it listens and
 * its launch key to ~/.openfilm/run.json (readable by this user only), which is how the CLI finds it, and removes the
 * file when it stops.
 */
import { fstatSync, openSync } from 'node:fs';
import { setPriority } from 'node:os';

/* fds 0–2 open before anything else is: a launcher that closed one (a detached shell, a service) would make every
   spawn of ffmpeg, ffprobe or git fail with EBADF from then on, while the page still says Studio is up */
for (const fd of [0, 1, 2]) {
  try { fstatSync(fd); } catch { openSync('/dev/null', fd === 0 ? 'r' : 'a'); }
}
/* below the person's own apps: an export or a poster never takes the computer from them, and what Studio starts
   (its browsers, ffmpeg) runs at this priority too */
try { setPriority(10); } catch { /* not allowed here: as it is */ }
/* each line of studio.log with its time */
for (const level of /** @type {const} */ (['log', 'warn', 'error'])) {
  const write = console[level].bind(console);
  console[level] = (...args) => write(new Date().toISOString(), ...args);
}

const { startStudio } = await import('./server.mjs');
const { closePageFrames } = await import('./pageframes.mjs');
const { closeBrowsers } = await import('../../src/host.mjs');

/* A browser's pipe that breaks (Playwright then throws where nothing can catch it) ends only the work on that browser:
   every browser is closed, so a render waiting on one fails and says so, the next one starts a new browser, and Studio
   keeps serving. Anything else still ends the process, its state unknown. */
process.on('uncaughtException', (e) => {
  console.error('uncaught:', e);
  if (/playwright-core/.test(String(e?.stack ?? ''))) { void closePageFrames().catch(() => {}); void closeBrowsers(); return; }
  process.exit(1);
});
process.on('unhandledRejection', (e) => { console.error('unhandled rejection:', e); });

const given = process.env.OPENFILM_STUDIO_PORT;
const port = given != null && given !== '' && Number.isInteger(Number(given)) ? Number(given) : 4747;
/** @type {Awaited<ReturnType<typeof startStudio>> | undefined} */
let studio;
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await studio?.close();
  process.exit(0);
};
/* the port is taken (by something else: the CLI asks run.json for a running Studio first) or reserved (Windows keeps
   ranges for Hyper-V and WSL, and refuses them with EACCES): any free one does, the CLI finds it through run.json */
const taken = (/** @type {unknown} */ e) => ['EADDRINUSE', 'EACCES'].includes(/** @type {NodeJS.ErrnoException} */ (e).code ?? '');
try {
  studio = await startStudio({ port, advertise: true, onQuit: stop }).catch((e) => {
    if (!port || !taken(e)) throw e;
    console.error(`port ${port} is not free; Studio takes another`);
    return startStudio({ port: 0, advertise: true, onQuit: stop });
  });
} catch (e) {
  console.error(e);
  process.exit(1);
}
console.log(`OpenFilm Studio · ${studio.origin}`);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
