// @ts-check
/**
 * A headless browser held to a share of the machine's memory. Chromium sets no bound of its own on what drawing a page
 * takes (host.mjs launch names a case that took gigabytes a frame: on a Mac the GPU's memory is the machine's). So
 * every browser the host starts is watched: each of its processes' footprint (what it holds of the machine's memory,
 * the GPU's included; `ps` shows far less) is read every WATCH_MS, and past MEMORY_MAX_MB the browser is ended at
 * once. A page that grows that fast (gigabytes a second) is past the bound before it is read; one that grows frame by
 * frame is stopped at it. What the browser was drawing fails, and `memoryExceeded` says why, so a caller does not
 * draw the same page again.
 *
 * Read on macOS (`footprint`) and Linux (/proc); elsewhere a browser is not watched.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The most one process of a headless browser may hold, in MB: a quarter of the machine's memory, 2 to 8 GB. */
export const MEMORY_MAX_MB = Math.round(Math.min(8192, Math.max(2048, (totalmem() / 1048576) * 0.25)));
/** How often a browser's memory is read. */
const WATCH_MS = 500;

/** Thrown, or said, for what a browser was drawing when it was ended for its memory. */
export class BrowserMemoryError extends Error {
  /** @param {number} mb */
  constructor(mb) {
    super(`the page took more memory than this computer can spare (${(mb / 1024).toFixed(1)} GB, the most is ${(MEMORY_MAX_MB / 1024).toFixed(1)} GB) and was stopped`);
    this.mb = mb;
  }
}

/** @type {WeakMap<object, number>} the browsers ended for their memory, and how much one of their processes held (MB) */
const exceeded = new WeakMap();

/** How much (MB) the browser's process held when it was ended for its memory; null: it was not. @param {object} browser */
export const memoryExceeded = (browser) => exceeded.get(browser) ?? null;

/** The error for what a browser ended for its memory was drawing; null: it was not ended so. @param {object} browser */
export function memoryError(browser) {
  const mb = memoryExceeded(browser);
  return mb == null ? null : new BrowserMemoryError(mb);
}

/** The pids of the process whose command line holds `marker` and of every process under it. */
export async function processesOf(/** @type {string} */ marker) {
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=,command='], { maxBuffer: 16 * 1024 * 1024 });
  const rows = stdout.split('\n').map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter((m) => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
  const root = rows.find((r) => r.command.includes(marker));
  if (!root) return [];
  const pids = [root.pid];
  for (let i = 0; i < pids.length; i += 1) for (const r of rows) if (r.ppid === pids[i]) pids.push(r.pid);
  return pids;
}

const UNIT = /** @type {Record<string, number>} */ ({ B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024, TB: 1048576 });

/** Each process's footprint in MB, by pid; empty where it cannot be read on this system. @param {number[]} pids */
export async function footprints(pids) {
  /** @type {Map<number, number>} */
  const out = new Map();
  if (!pids.length) return out;
  if (process.platform === 'darwin') {
    const { stdout } = await run('/usr/bin/footprint', pids.flatMap((p) => ['-p', String(p)]), { maxBuffer: 16 * 1024 * 1024 }).catch((e) => ({ stdout: String(e?.stdout ?? '') }));
    for (const m of stdout.matchAll(/\[(\d+)\]:.*?Footprint:\s*([\d.]+)\s*(B|KB|MB|GB|TB)/g)) out.set(Number(m[1]), Number(m[2]) * (UNIT[m[3]] ?? 1));
  } else if (process.platform === 'linux') {
    await Promise.all(pids.map(async (p) => {
      const status = await readFile(`/proc/${p}/status`, 'utf8').catch(() => '');
      const kb = status.match(/^VmRSS:\s*(\d+)\s*kB/m);
      if (kb) out.set(p, Number(kb[1]) / 1024);
    }));
  }
  return out;
}

/** Whether this system's footprints are read. */
const READABLE = process.platform === 'darwin' || process.platform === 'linux';
/** The footprints (MB) of the browser started with `marker`, each of its processes. @param {string} marker */
const readMemory = async (marker) => [...(await footprints(await processesOf(marker))).values()];

/**
 * Watch `browser` (started with `marker` among its arguments) until it disconnects: past `max` MB in one of its
 * processes, they are all ended and `memoryExceeded(browser)` says how much. `read`: how the footprints are read
 * (tests); on a system where they are not, the browser is not watched.
 * @param {import('playwright-core').Browser} browser @param {string} marker
 * @param {{ max?: number, every?: number, read?: (marker: string) => Promise<number[]> }} [opts]
 */
export function guard(browser, marker, { max = MEMORY_MAX_MB, every = WATCH_MS, read = READABLE ? readMemory : undefined } = {}) {
  if (!read) return;
  let stopped = false;
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const stop = () => { stopped = true; clearTimeout(timer); };
  browser.on('disconnected', stop);
  const tick = async () => {
    if (stopped) return;
    try {
      const sizes = await read(marker);
      const most = Math.max(0, ...sizes);
      if (!stopped && most > max) {
        exceeded.set(browser, Math.round(most));
        stop();
        /* ended, not closed: a browser this deep in memory may not answer a close for a long while */
        for (const pid of await processesOf(marker).catch(() => [])) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
        await browser.close().catch(() => {});
        return;
      }
    } catch { /* not read this time */ }
    if (!stopped) { timer = setTimeout(tick, every); timer.unref?.(); }
  };
  timer = setTimeout(tick, every);
  timer.unref?.();
}
