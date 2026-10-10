// film render: the deliverable. Frames are rendered in parallel page instances, averaged
// over the shutter for motion blur, encoded with tagged BT.709 color, and muxed with the mix of the film's sounds.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { FilmPage } from './host.mjs';
import { ffmpeg, filmSound, fmt, mix, open, outDir, parseTarget, shown, UsageError, write } from './shared.mjs';

const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const TAG_709 = ['-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0'];

/** Output formats: picture codec, pixel format, sound codec. Transparency needs .webm or .mov. */
const FORMATS = {
  '.mp4': { video: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', ...BT709], pix: 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', audio: ['-c:a', 'aac', '-b:a', '192k'], tag: TAG_709 },
  '.webm': { video: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '20', '-row-mt', '1'], pix: 'format=yuva420p', audio: ['-c:a', 'libopus', '-b:a', '160k'], tag: [] },
  '.mov': { video: ['-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0'], pix: 'format=yuva444p10le', audio: ['-c:a', 'pcm_s16le'], tag: [] },
};

export async function render(args, opts = {}) {
  const started = Date.now();
  const { film: target, at, range } = parseTarget(args);
  if (at != null) throw new UsageError(`render takes a range (for example ${at}-${at + 2}), not one time; for one frame use openfilm look ${at}`);
  /* `root`: the folder to serve (a host rendering an edit kept elsewhere in a project serves the project) */
  const probe = await open(target, opts.root ? { root: opts.root } : {});
  const { entry, dir, name, site, browser, isFilm } = probe;
  const meta = probe.film.meta;
  await probe.film.close();

  const fps = Number(opts.fps ?? 30);
  /* a page without a duration has no end: it is rendered by a range */
  const end = meta.duration ?? Infinity;
  if (!range && meta.duration == null) { await probe.close(); throw new UsageError('this page has no duration, so it has no end: give a range to render, e.g. openfilm render 0-6'); }
  const [from, to] = range ? [range[0], Math.min(range[1], end)] : [0, end];
  const f0 = Math.round(from * fps);
  const f1 = Math.round(to * fps);
  const total = f1 - f0;
  if (total <= 0) { await probe.close(); throw new UsageError(`nothing to render between ${fmt(from)} and ${fmt(to)}${meta.duration != null ? `: the film is ${fmt(meta.duration)} long` : ''}`); }
  if (range && range[1] > end) console.error(`openfilm render: ${fmt(range[0])}-${fmt(range[1])} runs past the film's end (${fmt(meta.duration)}): rendered to there`);
  const scale = opts.scale ?? (opts['4k'] ? 3840 / meta.width : 1);
  const samples = Math.max(1, Number(opts.samples ?? (opts.blur ? 8 : 1)));
  const shutter = Number(opts.shutter ?? 0.5);
  const alpha = !!opts.alpha;
  /* the whole film is the person's, beside film.html; a stretch rendered to check something stays in the tool's folder */
  const out = resolve(opts.out ?? (range
    ? join(outDir(dir, 'render'), `${name}-${from}-${to}${alpha ? '.webm' : '.mp4'}`)
    : join(dir, `${name}${alpha ? '.webm' : '.mp4'}`)));
  mkdirSync(dirname(out), { recursive: true });
  const container = FORMATS[extname(out).toLowerCase()];
  if (!container) { await probe.close(); throw new UsageError(`can't write ${extname(out)}: use .mp4, .webm or .mov`); }
  /* a host may encode the container its own way (Studio's export: another codec, a quality, a frame around the film) */
  const format = { ...container, ...opts.format };
  if (alpha && extname(out).toLowerCase() === '.mp4') { await probe.close(); throw new UsageError('mp4 has no transparency: write .webm or .mov with --alpha'); }
  const workers = Math.max(1, Math.min(Number(opts.workers ?? defaultWorkers()), total));

  if (!process.stderr.isTTY && !opts.onProgress) process.stderr.write(`  rendering ${total} frames with ${workers} browser${workers > 1 ? 's' : ''}…\n`);
  const work = join(outDir(dir, 'render'), `.parts-${process.pid}`);
  mkdirSync(work, { recursive: true });
  let done = 0;
  /* a terminal gets a live counter; an agent's shell (no TTY) a line every tenth, so a long render never looks hung */
  let t0 = Date.now();
  let told = 0;
  const progress = () => {
    done++;
    if (done === 1) t0 = Date.now(); // the rate from the first frame on: starting the browsers is not a frame's cost
    /* a host showing its own progress (Studio's export) is told each frame, and the terminal is left alone */
    if (opts.onProgress) { opts.onProgress(done, total); return; }
    if (process.stderr.isTTY) { process.stderr.write(`\r  ${done}/${total} frames`); return; }
    const tenth = Math.floor((done / total) * 10);
    if (tenth > told && done < total) {
      told = tenth;
      const left = ((Date.now() - t0) / Math.max(1, done - 1)) * (total - done) / 1000;
      process.stderr.write(`  ${done}/${total} frames · about ${Math.ceil(left)} s left\n`);
    }
  };
  const problems = [];
  /* cancelled (`signal`): stop now, not once every browser has drawn the frame it is on; the finally closes them */
  const cancelled = opts.signal?.aborted ? Promise.reject(new Error('cancelled'))
    : new Promise((_, fail) => opts.signal?.addEventListener('abort', () => fail(new Error('cancelled')), { once: true }));
  cancelled.catch(() => {});
  /* what is left of a step given up fails as the browsers close: that is no one's error */
  const unlessCancelled = (/** @type {Promise<any>} */ step) => { step.catch(() => {}); return Promise.race([step, cancelled]); };
  try {
    const pages = await unlessCancelled(Promise.all(Array.from({ length: workers }, () => FilmPage.open(browser, site.url, entry, { scale, transparent: alpha }))));
    /* a film paints its stage behind its clips (black, or its own background): with alpha, only what the clips draw is kept */
    if (alpha && isFilm) await Promise.all(pages.map((p) => p.page.addStyleTag({ content: 'html, body { background: transparent !important; }' })));
    const per = Math.ceil(total / workers);
    const parts = pages.map((film, i) => ({ film, a: f0 + i * per, b: Math.min(f1, f0 + (i + 1) * per), file: join(work, `part-${i}${extname(out)}`) })).filter((p) => p.a < p.b);
    await unlessCancelled(Promise.all(parts.map((p) => encode(p, { fps, samples, shutter, duration: end, format, onFrame: progress, still: alpha ? 'png' : 'jpeg', signal: opts.signal }))));
    if (process.stderr.isTTY && !opts.onProgress) process.stderr.write('\n');
    for (const p of pages) problems.push(...p.problems);

    /* names, not paths: concat reads them beside the list, and a path can hold a `'` (C:\\Users\\O'Brien) */
    writeFileSync(join(work, 'list.txt'), parts.map((p) => `file '${basename(p.file)}'`).join('\n'));
    const video = join(work, `video${extname(out)}`);
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-c', 'copy', video]).done;
    const clips = opts.silent ? [] : await filmSound(probe, from);
    if (opts.signal?.aborted) throw new Error('cancelled');
    if (clips.length) {
      const sound = join(work, `sound${extname(out) === '.mp4' ? '.m4a' : extname(out) === '.webm' ? '.webm' : '.wav'}`);
      await mix(clips, to - from, sound, format.audio);
      await ffmpeg(['-i', video, '-i', sound, '-map', '0:v', '-map', '1:a', '-c', 'copy', ...format.tag, ...(extname(out) === '.mp4' ? ['-movflags', '+faststart'] : []), out]).done;
    } else {
      await ffmpeg(['-i', video, '-c', 'copy', ...format.tag, ...(extname(out) === '.mp4' ? ['-movflags', '+faststart'] : []), out]).done;
    }
  } finally {
    /* Windows lets go of a file a moment after ffmpeg exits */
    rmSync(work, { recursive: true, force: true, maxRetries: 5 });
    await probe.close();
  }
  const seconds = (Date.now() - started) / 1000;
  return {
    out,
    lines: [
      `→ ${shown(out)}`,
      `  ${total} frames · ${fmt(to - from)} at ${fps} fps · ${Math.round(meta.width * scale)}×${Math.round(meta.height * scale)}${samples > 1 ? ` · ${samples} samples/frame` : ''}${alpha ? ' · alpha' : ''} · ${workers} worker${workers > 1 ? 's' : ''} · ${seconds.toFixed(1)} s`,
      ...problems.map((p) => `✗ ${p.kind === 'request' ? 'request' : 'page'}: ${p.message}`),
    ],
  };
}

/**
 * One browser per three cores, at most four, and memory to spare (a page with its media takes 1.5 GB or more, and the
 * encoder and the person's own apps need theirs): a render leaves the computer usable while it runs.
 */
function defaultWorkers() {
  return Math.max(1, Math.min(4, Math.floor(availableParallelism() / 3), Math.floor(totalmem() / (4 * 2 ** 30))));
}

/** Frames [a, b) of one page into one file; sub-frames are averaged by ffmpeg (tmix) and every n-th kept. */
async function encode({ film, a, b, file }, { fps, samples, shutter, duration, format, onFrame, still, signal }) {
  const blur = samples > 1 ? `tmix=frames=${samples},select='eq(mod(n\\,${samples})\\,${samples - 1})',setpts=N/(${fps}*TB),` : '';
  const enc = ffmpeg(['-f', 'image2pipe', '-framerate', String(fps * samples), '-c:v', still === 'png' ? 'png' : 'mjpeg', '-i', '-',
    '-vf', blur + format.pix, '-r', String(fps), ...format.video, file], { input: true });
  /* a cancelled render stops its encoder at once: the frames ffmpeg still holds are thrown away, not encoded (a 4K
     encode takes seconds to drain); the parts folder goes with it (see render's finally) */
  const stop = () => enc.proc.kill('SIGKILL');
  enc.proc.stdin.on('error', () => {});
  signal?.addEventListener('abort', stop, { once: true });
  try {
    for (let f = a; f < b; f++) {
      if (signal?.aborted) {
        stop();
        throw new Error('cancelled');
      }
      for (let k = 0; k < samples; k++) {
        const t = (f + (samples > 1 ? (k / samples - 0.5) * shutter : 0)) / fps;
        await film.seek(Math.min(Math.max(0, t), duration - 1e-4));
        await write(enc.proc.stdin, await film.capture(still === 'png' ? { format: 'png' } : { format: 'jpeg', quality: 95 }));
      }
      onFrame();
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    enc.proc.stdin.end();
  }
  await enc.done;
}
