/**
 * What the benchmark measures, and how it reads it.
 *
 *   · frames   — in a page (or a frame of one): every animation frame's interval while a scenario runs, and the long
 *                tasks (main thread busy past 50 ms). A frame later than 1.5 intervals of the display is a dropped one.
 *   · video    — in the film's frame: each <video>'s own count of frames it decoded and dropped.
 *   · memory   — the resident memory of the app's whole process tree: main, its pages, its helpers (GPU, network,
 *                Studio's server), Studio's background browser, and the agents' processes.
 */
import { execFileSync } from 'node:child_process';

/** A probe put into a page (or one of its frames): counts frames and long tasks between start() and stop(). */
const PROBE = `(() => {
  if (window.__bench) return;
  const b = window.__bench = { on: false, last: 0, gaps: [], long: [], start() { b.on = true; b.last = 0; b.gaps = []; b.long = []; b.videos = b.videoCounts(); },
    stop() { b.on = false; return { gaps: b.gaps, long: b.long, videos: b.videoCounts(), videos0: b.videos }; },
    videoCounts() { return [...document.querySelectorAll('video')].map((v) => { const q = v.getVideoPlaybackQuality?.(); return { total: q?.totalVideoFrames ?? 0, dropped: q?.droppedVideoFrames ?? 0, paused: v.paused }; }); } };
  const tick = (now) => { if (b.on) { if (b.last) b.gaps.push(now - b.last); b.last = now; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((list) => { if (b.on) for (const e of list.getEntries()) b.long.push(e.duration); }).observe({ type: 'longtask', buffered: false }); } catch {}
})()`;

/** Put the probe in every frame of a page that can take it. @param {import('playwright-core').Page} page */
export async function probe(page) {
  for (const frame of page.frames()) await frame.evaluate(PROBE).catch(() => {});
}

/** @param {import('playwright-core').Frame} frame */
export const startFrame = (frame) => frame.evaluate(() => window.__bench?.start()).catch(() => {});
/** @param {import('playwright-core').Frame} frame */
export const stopFrame = (frame) => frame.evaluate(() => window.__bench?.stop() ?? null).catch(() => null);

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** One frame's counts as figures. `hz`: the display's rate, read from the median interval. */
export function summarizeFrames(raw) {
  if (!raw || raw.gaps.length < 2) return null;
  const sorted = [...raw.gaps].sort((a, b) => a - b);
  const median = pct(sorted, 0.5);
  const budget = median * 1.5;
  const dropped = raw.gaps.reduce((n, g) => n + Math.max(0, Math.round(g / median) - 1), 0);
  const seconds = raw.gaps.reduce((a, g) => a + g, 0) / 1000;
  const late = raw.gaps.filter((g) => g > budget).length;
  const video = raw.videos?.map((v, i) => {
    const before = raw.videos0?.[i] ?? { total: 0, dropped: 0 };
    return { decoded: v.total - before.total, dropped: v.dropped - before.dropped };
  }).filter((v) => v.decoded > 0) ?? [];
  return {
    fps: round(raw.gaps.length / seconds),
    displayHz: round(1000 / median, 0),
    frameMs: { p50: round(median), p95: round(pct(sorted, 0.95)), p99: round(pct(sorted, 0.99)), max: round(sorted[sorted.length - 1]) },
    droppedFrames: dropped,
    droppedPct: round((100 * dropped) / (raw.gaps.length + dropped)),
    lateFrames: late,
    longTasks: { count: raw.long.length, totalMs: round(raw.long.reduce((a, d) => a + d, 0), 0), maxMs: round(Math.max(0, ...raw.long), 0) },
    ...(video.length ? { video: { decoded: video.reduce((a, v) => a + v.decoded, 0), dropped: video.reduce((a, v) => a + v.dropped, 0) } } : {}),
  };
}

/** The resident memory of a process and all it started, in MB, by kind of process. */
export function treeMemory(rootPid) {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8' }).trim().split('\n').map((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]), comm: m[4] } : null;
  }).filter(Boolean);
  const children = new Map();
  for (const r of rows) { if (!children.has(r.ppid)) children.set(r.ppid, []); children.get(r.ppid).push(r); }
  const tree = [];
  const walk = (pid) => { for (const c of children.get(pid) ?? []) { tree.push(c); walk(c.pid); } };
  const root = rows.find((r) => r.pid === rootPid);
  if (root) tree.push(root);
  walk(rootPid);
  /* by what each is: the app's own (main, its pages, GPU and services), Studio's background browser, the agents */
  const kind = (r) => {
    const name = r.comm.split('/').pop() ?? '';
    if (r.pid === rootPid) return 'main';
    if (/\(Renderer\)/.test(name)) return 'pages';
    if (/Helper/.test(name)) return 'helpers';
    if (/headless|Chromium|chrome/i.test(name)) return 'studioBrowser';
    return 'agents';
  };
  const byKind = {};
  for (const r of tree) byKind[kind(r)] = round((byKind[kind(r)] ?? 0) + r.rss / 1024, 0);
  return { totalMB: round(tree.reduce((a, r) => a + r.rss, 0) / 1024, 0), processes: tree.length, byKind };
}
