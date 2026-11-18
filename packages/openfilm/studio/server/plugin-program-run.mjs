// @ts-check
/**
 * What stands between Studio and a plugin's program (plugin-programs.mjs): `node plugin-program-run.mjs <command line>`
 * runs the command by the system's shell, as the head of its own group of processes, and stops that whole group when
 * Studio says so (a signal) or is gone (this process's input closes, however Studio ended). So no plugin's program
 * outlives the Studio that started it. What the program prints is passed on; its exit status is this one's.
 */
import { spawn } from 'node:child_process';

/* this Node may be Electron run as Node: what the program starts is not to be */
delete process.env.ELECTRON_RUN_AS_NODE;
const windows = process.platform === 'win32';
const child = spawn(process.argv[2] ?? '', { shell: true, stdio: ['ignore', 'inherit', 'inherit'], detached: !windows, windowsHide: true });

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) { process.exit(0); return; }
  const group = (/** @type {NodeJS.Signals} */ signal) => { try { process.kill(-(/** @type {number} */ (child.pid)), signal); } catch { child.kill(signal); } };
  if (windows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
  else group('SIGTERM');
  /* one that does not stop when asked is stopped */
  setTimeout(() => { if (!windows) group('SIGKILL'); process.exit(0); }, 3000).unref();
}
process.stdin.on('end', stop).on('close', stop).on('error', stop).resume();
for (const signal of /** @type {const} */ (['SIGTERM', 'SIGINT', 'SIGHUP'])) process.on(signal, stop);
child.on('error', (e) => { console.error(e.message); process.exit(1); });
child.on('exit', (code, signal) => process.exit(stopping ? 0 : code ?? (signal ? 1 : 0)));
