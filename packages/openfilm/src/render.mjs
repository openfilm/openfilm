// film render: the deliverable. Frames are rendered in parallel page instances, averaged
// over the shutter for motion blur, encoded with tagged BT.709 color, and muxed with the mix of the film's sounds.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { clipKind, FILM_FILE } from './film-doc.mjs';
import { alphaCompositeFilter, broken, chipDelivery, encoders, FRAMES_709, hardwareEncoder, holdsQuality, prores709, unheld } from './encoders.mjs';
import { memoryError } from './browser-memory.mjs';
import { encoderWait } from './encoder-wait.mjs';
import { FilmPage, launch, SOFTWARE_GL } from './host.mjs';
import { exactRate, ffmpegRate } from './rate.mjs';
import { browserCopies, filmGrades, filmVideos, gradedCopies, gradeKey, gradeRange } from './seekable.mjs';
import { ffmpeg, filmSound, fmt, kill, locate, mix, open, outDir, parseTarget, shown, UsageError, write } from './shared.mjs';
import { burned } from './burn.mjs';
import { renderSelection, selectionClips, selectionFrame } from './render-ranges.mjs';
import { isLoudness, LOUDNESS_RANGE, LOUDNESS_SLACK, loudnessText, toLoudness, TRUE_PEAK } from './loudness.mjs';
import { CHUNK_SECONDS, chunkStore, chunksOf, settingsOf, signature } from './render-resume.mjs';
import { alike, captionsAlone, layersOf, settle, straight, straightPlan, straightRuns } from './direct.mjs';

const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const TAG_709 = ['-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0'];

/** Output formats: picture codec, pixel format, sound codec. Transparency needs .webm or .mov. */
const FORMATS = {
  '.mp4': { video: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', ...BT709], pix: 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', audio: ['-c:a', 'aac', '-b:a', '192k'], tag: TAG_709 },
  '.webm': { video: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '20', '-row-mt', '1', ...BT709], pix: `scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,${FRAMES_709}`, audio: ['-c:a', 'libopus', '-b:a', '160k'], tag: [] },
  '.mov': { ...prores709('prores_ks', true), audio: ['-c:a', 'pcm_s16le'], tag: [] },
};

/** Bits per pixel per frame for the chip's H.264: Studio's "high", with room for screen text (exports.mjs). */
const CHIP_BPP = 0.165;

/**
 * The container's picture through the graphics chip, when it has an encoder that works and takes the picture's size:
 * H.264 for an MP4, held to Studio's "high" quality when the chip holds one (else given its bitrate), a key frame
 * every two seconds; ProRes 4444 for a MOV. Null otherwise: the container's own.
 * @param {string} ext @param {{ w: number, h: number }} size @param {number} fps
 */
async function chipFormat(ext, size, fps) {
  if (Math.min(size.w, size.h) < 64 || Math.max(size.w, size.h) > 4096) return null;
  const have = await encoders();
  if (ext === '.mp4') {
    const encoder = await hardwareEncoder('h264', have);
    const bits = Math.min(120e6, Math.max(2e6, size.w * size.h * fps * CHIP_BPP));
    if (!encoder) return null;
    const quality = await holdsQuality(encoder) ? /** @type {const} */ ('high') : undefined;
    return { encoder, format: chipDelivery(encoder, bits, { gop: fps * 2, quality }, BT709) };
  }
  if (ext === '.mov') {
    const encoder = await hardwareEncoder('prores', have);
    return encoder ? { encoder, format: prores709(encoder, true) } : null;
  }
  return null;
}

/** `from` renamed `to`, if the system lets it now: not onto another disk, nor a file Windows still holds a moment. @param {string} from @param {string} to */
function moved(from, to) {
  try {
    renameSync(from, to);
    return true;
  } catch {
    return false;
  }
}

/** The encoder a format's picture options name. @param {string[] | undefined} video */
const encoderOf = (video = []) => video[video.indexOf('-c:v') + 1] ?? 'ffmpeg';

/** What an encoder out of memory says: x264's failed malloc, ffmpeg's ENOMEM, or Windows ending it (STATUS_NO_MEMORY). */
const OUT_OF_MEMORY = /malloc of size \d+ failed|cannot allocate memory|out of memory|exit 3221225495\b/i;

/**
 * An encode's error, said plainly when the encoder ran out of memory: each browser feeds an encoder of its own, so
 * fewer browsers is what helps. Any other error as it is.
 * @param {unknown} e @param {number} workers
 */
export function outOfMemory(e, workers) {
  if (!(e instanceof Error) || !OUT_OF_MEMORY.test(e.message)) return e;
  const said = workers > 1
    ? `ffmpeg ran out of memory with ${workers} browsers rendering at once: try fewer, for example --workers ${Math.floor(workers / 2)}`
    : 'ffmpeg ran out of memory: close other apps and try again';
  return new Error(`${said}\n${e.message}`, { cause: e });
}

export async function render(args, opts = {}) {
  const started = Date.now();
  const { film: target, at, range } = parseTarget(args);
  if (range && opts.ranges) throw new UsageError('choose a range or ranges, not both');
  if (opts.loudness != null && !isLoudness(opts.loudness)) throw new UsageError(`--loudness is a target from ${LOUDNESS_RANGE[0]} to ${LOUDNESS_RANGE[1]} LUFS, e.g. --loudness=-14 for online video`);
  if (at != null) throw new UsageError(`render takes a range (for example ${at}-${at + 2}), not one time; for one frame use openfilm look ${at}`);
  /* --subtitles: a project's subtitles from before caption tracks (its voices' transcripts in the style Studio kept),
     the project's film drawn around by a page that burns them in (the export's own, burn.mjs),
     rendered in its place, from the project's folder, named as the film's own render is. Studio burns only the
     project's film, so a page of it is refused */
  if (opts.subtitles) {
    const loc = locate(target);
    const own = existsSync(join(loc.root, FILM_FILE)) ? FILM_FILE : 'index.html';
    if (decodeURI(loc.entry) !== own) throw new UsageError(`--subtitles burns the subtitles into the project's film: render the project's folder, not ${decodeURI(loc.entry)}`);
    const { subtitlesForExport } = await import('../studio/server/captions.mjs');
    /* a film with caption tracks has its subtitles in its picture already: rendered as it is */
    if ((await subtitlesForExport(loc.root)).tracks) return await render(args, { ...opts, subtitles: false });
    const burn = await burned(loc.root, { burnSubtitles: true }, subtitlesForExport, !!opts.alpha);
    if (!burn) throw new UsageError('--subtitles: the film has no subtitles to burn in');
    try {
      return await render([burn.dir, ...(range ? [`${range[0]}-${range[1]}`] : [])], { ...opts, subtitles: false, root: loc.root, nameAs: { dir: loc.dir, name: loc.name } });
    } finally {
      await burn.remove();
    }
  }
  /* `root`: the folder to serve (a host rendering an edit kept elsewhere in a project serves the project). The videos
     the pages ask for are noted, and served as their fast-seeking copies once there are some (seekable.mjs). */
  const videos = new Set();
  /** @type {Map<string, string>} each file the pages asked for, as it was when first asked: what the chunks are drawn
   * from. One asked for and not there (or refused: a link out of the folder) is '' — the page draws otherwise once it is */
  const used = new Map();
  const missed = (/** @type {string} */ file) => { if (!used.has(file)) used.set(file, ''); };
  /** @type {Map<string, string>} */
  let copies = new Map();
  /** @type {Map<string, string>} the graded copies of the film's videos graded by LUTs, by their keys (seekable.mjs) */
  let graded = new Map();
  const swap = (/** @type {string} */ file, /** @type {URLSearchParams | undefined} */ query, /** @type {string} */ source = file) => {
    if (clipKind(file) === 'video') videos.add(file);
    if (!used.has(file)) used.set(file, signature(file));
    if (source !== file && !used.has(source)) used.set(source, signature(source));
    return graded.get(query?.get('of-grade') ?? '') ?? copies.get(file) ?? null;
  };
  /* a video graded by LUTs plays its graded copy, made before any frame is drawn; its LUTs are what its chunks are
     drawn from too */
  const grade = (/** @type {string} */ file, /** @type {string[]} */ luts, /** @type {number[] | null} */ time = null) => {
    for (const lut of luts) if (!used.has(lut)) used.set(lut, signature(lut));
    const range = gradeRange(time);
    const key = gradeKey(file, luts, !!opts.fine, range);
    return key && graded.has(key) ? { key, from: range?.from ?? 0 } : null;
  };
  /* `browsers` (a BrowserPool): the render borrows `workers` of its browsers, draws in a tab of its own in each, and
     gives them back; else it starts its own and closes them */
  const pool = opts.browsers ?? null;
  const lent = pool ? await pool.take(Math.max(1, Number(opts.workers ?? 1))) : [];
  let failed = true;
  let probe;
  try {
    probe = await open(target, { ...(opts.root ? { root: opts.root } : {}), swap, missed, grade, ...(pool ? { browser: lent[0] } : {}) });
  } catch (e) {
    await pool?.give(lent, { retire: true });
    throw e;
  }
  const { entry, site, browser, isFilm, root } = probe;
  /* a burned-in render names the project it is for, not the page drawn for it */
  const dir = opts.nameAs?.dir ?? probe.dir;
  const name = opts.nameAs?.name ?? probe.name;
  const meta = probe.film.meta;
  /* drawn without a graphics chip (no driver that reaches it, a virtual machine): every frame is slow, and a host is
     told at once (`onSoftware`), to say so while it waits */
  const software = SOFTWARE_GL.test(await probe.film.gpu().catch(() => ''));
  if (software) opts.onSoftware?.();
  /* 29.97 is 30000/1001, as the footage shot at it is (rate.mjs) */
  const rate = exactRate(Number(opts.fps ?? 30));
  const fps = rate.fps;
  /** @type {Map<number, Promise<FilmPage>>} pages of the film that draw its captions alone, by their scale (direct.mjs) */
  const captionPages = new Map();
  const captionPage = (/** @type {number} */ k) => {
    if (!captionPages.has(k)) captionPages.set(k, FilmPage.open(browser, site.url, entry, { scale: k, transparent: true }).then(async (page) => { await captionsAlone(page); return page; }));
    return /** @type {Promise<FilmPage>} */ (captionPages.get(k));
  };
  const closeCaptionPages = async () => {
    const open = [...captionPages.values()];
    captionPages.clear();
    await Promise.allSettled(open.map((page) => page.then((p) => p.close())));
  };
  const film = isFilm ? entry : opts.root ? FILM_FILE : null;
  /* the film's videos graded by LUTs (SPEC.md --of-lut) get their graded copies, the ones the preview plays (a master
     export's of its own, as its other copies); one that can't be made is drawn as it is, and said. Made before the
     footage is looked at: a graded clip's copy is what is read straight (direct.mjs), and what its frame is drawn
     from when the two are compared */
  const grades = film ? filmGrades(root, film) : [];
  /** @type {string[]} the videos of grades that failed: played as they are, so they may need a copy as they are */
  const ungraded = [];
  if (grades.length) {
    try {
      graded = await gradedCopies(grades, root, { signal: opts.signal, fine: !!opts.fine, failed: ({ file, luts }) => {
        ungraded.push(file);
        console.error(`openfilm render: ${shown(file)}: its copy graded by ${luts.map(shown).join(', ')} could not be made, so it is drawn as it is`);
      } });
    } catch (e) {
      await probe.close();
      await pool?.give(lent, { retire: true });
      throw e;
    }
  }
  /* a film's footage that is its whole picture is read straight from its files, not drawn here (direct.mjs): which
     clips are plain footage is read from the film's page while it is open, and a frame of each file drawn both ways
     has to be the same picture. Not for a picture with alpha, frames mixed for motion blur, or a film in pieces */
  const footage = opts.straight !== false && isFilm && meta.duration != null && !opts.alpha && !opts.ranges && !(Number(opts.samples ?? (opts.blur ? 8 : 1)) > 1)
    ? await (async () => {
      /* a graded clip's footage is its graded copy, made above */
      const film = await layersOf(probe.film, root, entry, (file, luts, time) => {
        const range = gradeRange(time);
        const key = gradeKey(file, luts, !!opts.fine, range);
        const copy = key ? graded.get(key) : null;
        return copy ? { file: copy, from: range?.from ?? 0 } : null;
      });
      if (film?.layers.some((l) => l.footage)) await settle(probe.film, film, rate, meta.duration);
      if (!film?.layers.some((l) => l.footage)) return null;
      /* its captions, drawn alone and laid over the footage, have to come to the picture the page draws: told on
         the first frame that has both. When they do not, the frames with a cue on are drawn */
      if (film.captions.tracks.length && film.captions.still) {
        let same = false;
        const total = Math.round(meta.duration * fps);
        for (let f = 0; f < total; f++) {
          const plan = straightPlan(film, f, f + 1, fps, meta.duration);
          if (!plan?.overlays.length || !plan.files.length) continue;
          const t = Math.min(f / fps, meta.duration - 1e-4);
          const alone = await captionPage(1);
          await alone.seek(t);
          const picture = join(outDir(dir, 'render'), `.captions-check-${process.pid}.png`);
          mkdirSync(dirname(picture), { recursive: true });
          writeFileSync(picture, await alone.capture({ format: 'png' }));
          await probe.film.seek(t);
          same = await alike(plan, await probe.film.capture({ format: 'png' }), { stage: film.stage, rate, ground: film.ground, pictures: new Map([[plan.overlays[0].key, picture]]) });
          rmSync(picture, { force: true });
          break;
        }
        film.captions.still = same;
        await closeCaptionPages();
      }
      return film;
    })().catch(() => null)
    : null;
  await probe.film.close();

  /* a page without a duration has no end: it is rendered by a range */
  const end = meta.duration ?? Infinity;
  if (!range && !opts.ranges && meta.duration == null) { await probe.close(); await pool?.give(lent); throw new UsageError('this page has no duration, so it has no end: give a range to render, e.g. openfilm render 0-6'); }
  let selection = null;
  try { if (opts.ranges) selection = renderSelection(opts.ranges, fps, end); }
  catch (e) { await probe.close(); await pool?.give(lent); throw e; }
  const [from, to] = selection ? [0, selection.duration] : range ? [range[0], Math.min(range[1], end)] : [0, end];
  const f0 = Math.round(from * fps);
  const f1 = Math.round(to * fps);
  const total = f1 - f0;
  if (total <= 0) { await probe.close(); await pool?.give(lent); throw new UsageError(`nothing to render between ${fmt(from)} and ${fmt(to)}${meta.duration != null ? `: the film is ${fmt(meta.duration)} long` : ''}`); }
  if (range && range[1] > end) console.error(`openfilm render: ${fmt(range[0])}-${fmt(range[1])} runs past the film's end (${fmt(meta.duration)}): rendered to there`);
  const scale = opts.scale ?? (opts['4k'] ? 3840 / meta.width : 1);
  const samples = Math.max(1, Number(opts.samples ?? (opts.blur ? 8 : 1)));
  // A host that has proved static picture intervals (isolated caption cues) may reuse the captured PNG between
  // these source-frame boundaries. Encoding and the output clock still include every frame, including alpha reads.
  if (opts.frameHolds != null && (!opts.alpha || !opts.silent || samples !== 1 || range || opts.ranges
    || !Array.isArray(opts.frameHolds) || !opts.frameHolds.every((f) => Number.isInteger(f) && f >= f0 && f < f1))) {
    await probe.close(); await pool?.give(lent); throw new UsageError('frameHolds requires an isolated, silent transparent render with frame-grid boundaries');
  }
  const frameHolds = opts.frameHolds == null ? null : new Set(opts.frameHolds);
  const shutter = Number(opts.shutter ?? 0.5);
  const alpha = !!opts.alpha;
  /* the whole film is the person's, beside film.html; a stretch rendered to check something stays in the tool's folder */
  const out = resolve(opts.out ?? (range
    ? join(outDir(dir, 'render'), `${name}-${from}-${to}${alpha ? '.webm' : '.mp4'}`)
    : join(dir, `${name}${alpha ? '.webm' : '.mp4'}`)));
  mkdirSync(dirname(out), { recursive: true });
  const container = FORMATS[extname(out).toLowerCase()];
  if (!container) { await probe.close(); await pool?.give(lent); throw new UsageError(`can't write ${extname(out)}: use .mp4, .webm or .mov`); }
  if (alpha && extname(out).toLowerCase() === '.mp4') { await probe.close(); await pool?.give(lent); throw new UsageError('mp4 has no transparency: write .webm or .mov with --alpha'); }
  /* a host may encode the container its own way (Studio's export: another codec, a quality, a frame around the film),
     and gets exactly that; else the picture goes through the graphics chip when it can */
  const own = { ...container, ...opts.format };
  /* `clear` (with `alpha`): the format for a page that lets anything through. The page is drawn with `format` while
     every frame is opaque, each frame's alpha read as it is drawn; at the first pixel that shows through it is drawn
     again with `clear`, in the same tabs (an editing project's page: H.264 when it can, PNG with its alpha when not).
     The result says which (`clear`) */
  const clearFormat = alpha && opts.clear ? { ...container, ...opts.clear } : null;
  let clear = false;
  const evenSize = (/** @type {number} */ n) => n - (n % 2);
  /* the size as it will be written, not as the maths says: the chip is asked about this one, and the summary names it */
  const size = { w: evenSize(Math.round(meta.width * scale)), h: evenSize(Math.round(meta.height * scale)) };
  const chip = opts.format || opts.hardware === false ? null : await chipFormat(extname(out).toLowerCase(), size, fps);
  let format = chip ? { ...own, ...chip.format } : own;
  let encoder = chip?.encoder ?? encoderOf(own.video);
  let onChip = !!chip;
  /* the film in chunks (render-resume.mjs). A film with footage read straight is cut where that footage begins and
     ends being its whole picture, on whole seconds from its first frame as any chunk is: each stretch of it in chunks
     as long as they come (one ffmpeg reads them, one after another), each stretch drawn in chunks for the browsers
     to share. The cut depends on the film alone, so a render that stopped finds its chunks. `partSeconds` (a host
     encoding at a bitrate): each part drawn that long at least, and no more browsers than parts */
  const second = Math.max(1, Math.round(fps));
  const chunks = footage
    ? straightRuns(footage, f0, f1, fps, end, { grid: second, least: second }).flatMap((run) => (run.straight
      ? Array.from({ length: Math.ceil((run.b - run.a) / (CHUNK_SECONDS * second)) }, (_, i) => ({ a: run.a + i * CHUNK_SECONDS * second, b: Math.min(run.b, run.a + (i + 1) * CHUNK_SECONDS * second) }))
      : chunksOf(run.a, run.b, fps, opts.partSeconds)))
    : chunksOf(f0, f1, fps, opts.partSeconds);
  /** @type {Map<{ a: number, b: number }, import('./direct.mjs').Plan>} the chunks that are footage alone, each with its plan */
  const plans = new Map();
  if (footage) for (const c of chunks) { const plan = straightPlan(footage, c.a, c.b, fps, end); if (plan) plans.set(c, plan); }
  /* the browsers draw the rest: as many as those frames are worth */
  const drawnFrames = Math.max(1, chunks.reduce((n, c) => n + (plans.has(c) ? 0 : c.b - c.a), 0));
  const workers = Math.max(1, Math.min(pool ? lent.length : Number(opts.workers ?? defaultWorkers(machine(), drawnFrames)), drawnFrames, chunks.length));
  /** @type {string[]} videos whose copy could not be made: drawn as they are, said as it happens and in the result */
  const uncopied = [];
  /* the videos get copies this browser plays: those it does not decode here (ProRes; HEVC without a chip for it), and
     for a render of more than a moment those that seek slowly (seekable.mjs). A film's video clips load only when
     their time comes, so they are read from film.html (a page drawn around the project's film, as a burned-in
     subtitle export is, reads the project's); a page's own videos are the ones it asked for */
  if (opts.seekable !== false) {
    /* a video only ever graded plays its graded copy: it needs no other; a file whose every frame in this render is
       read straight needs no copy: no browser plays it */
    const drawn = new Set(footage?.layers.filter((l) => l.file && chunks.some((c) => !plans.has(c) && l.at < c.b / fps && l.end > c.a / fps)).map((l) => l.file));
    const straightOnly = new Set(footage?.layers.filter((l) => l.file && !drawn.has(l.file)).map((l) => l.file));
    /* a file played only graded needs no copy as it is, though the page may have opened it before its graded copy was
       made (that copy is made first, above) */
    const plain = new Set(film ? filmVideos(root, film, { ungraded: true }) : []);
    const gradedOnly = new Set(grades.map((g) => g.file).filter((file) => !plain.has(file) && !ungraded.includes(file)));
    const files = [...new Set([...[...videos].filter((file) => !gradedOnly.has(file)), ...plain, ...ungraded])].filter((file) => !straightOnly.has(file));
    /* one the browser does not decode then fails its first frame, by its clip (timeline.mjs): never drawn black */
    const failed = (/** @type {string} */ file) => {
      uncopied.push(file);
      console.error(`openfilm render: ${shown(file)}: a copy this browser plays could not be made, so it is drawn as it is`);
    };
    try {
      copies = await browserCopies(browser, site.url, root, files, { signal: opts.signal, slow: total >= fps * 2, fine: !!opts.fine, failed });
    } catch (e) {
      await probe.close();
      await pool?.give(lent, { retire: true });
      throw e;
    }
  }
  uncopied.push(...ungraded);

  if (!process.stderr.isTTY && !opts.onProgress) process.stderr.write(`  rendering ${total} frames with ${workers} browser${workers > 1 ? 's' : ''}…\n`);
  /* the film in chunks, kept when the render stops: the next render of `out` (or of `resumeAs`, a host writing a
     partial file first) with the same settings, from files as they were, draws only the chunks not there
     (render-resume.mjs). A pool's process draws several renders at once, each into a folder of its own */
  const store = chunkStore(outDir(dir, 'render'), opts.resumeAs ?? out, extname(out));
  const work = store.folder;
  const settingsFor = (/** @type {typeof format} */ f) => settingsOf({ entry, root, frames: [f0, f1], fps: ffmpegRate(rate), size, scale, samples, shutter, alpha,
    duration: Number.isFinite(end) ? end : null, fine: !!opts.fine, spans: selection?.spans ?? null, format: f,
    ...(frameHolds ? { frameHolds: [...frameHolds] } : {}),
    ...(alpha && samples > 1 ? { alphaMix: 1 } : {}) });
  /* chunks a render that stopped drew with alpha, or without the chip after it gave up, are drawn on so */
  if (clearFormat && store.kept === settingsFor(clearFormat)) { clear = true; format = clearFormat; encoder = encoderOf(format.video); }
  else if (chip && store.kept === settingsFor(own)) { onChip = false; format = own; encoder = encoderOf(own.video); }
  let reused = 0;
  let done = 0;
  let drawn = 0;
  /** frames read straight from their footage (direct.mjs) */
  let straightFrames = 0;
  let heldFrames = 0;
  opts.onEncoder?.(encoder);
  /* a terminal gets a live counter; an agent's shell (no TTY) a line every tenth, so a long render never looks hung */
  let t0 = Date.now();
  let told = 0;
  const progress = () => {
    done++;
    drawn++;
    if (drawn === 1) t0 = Date.now(); // the rate from the first frame drawn on: starting the browsers is not a frame's cost
    /* a host showing its own progress (Studio's export) is told each frame, and the terminal is left alone */
    if (opts.onProgress) { opts.onProgress(done, total); return; }
    if (process.stderr.isTTY) { process.stderr.write(`\r  ${done}/${total} frames`); return; }
    const tenth = Math.floor((done / total) * 10);
    if (tenth > told && done < total) {
      told = tenth;
      const left = ((Date.now() - t0) / Math.max(1, drawn - 1)) * (total - done) / 1000;
      process.stderr.write(`  ${done}/${total} frames · about ${Math.ceil(left)} s left\n`);
    }
  };
  const problems = [];
  /** @type {Awaited<ReturnType<typeof toLoudness>> | null} */
  let loud = null;
  /* cancelled (`signal`): stop now, not once every browser has drawn the frame it is on; the finally closes them */
  const cancelled = opts.signal?.aborted ? Promise.reject(new Error('cancelled'))
    : new Promise((_, fail) => opts.signal?.addEventListener('abort', () => fail(new Error('cancelled')), { once: true }));
  cancelled.catch(() => {});
  /** @type {import('playwright-core').Browser[]} */
  const browsers = [];
  /** @type {FilmPage[]} the tabs drawing, closed at the end (a pool's browsers stay open) */
  const tabs = [];
  /* what is left of a step given up fails as the browsers close: that is no one's error */
  /* a browser that closes while drawing (a crash, or the system ending it for memory) ends the render at once: its tab may never
     answer again, and nothing it was drawing is waited for */
  const gone = new Error('the browser drawing the page closed (it crashed, or the system ended it)');
  /** @type {(e: Error) => void} */
  let crash = () => {};
  const crashed = new Promise((_, fail) => { crash = fail; });
  crashed.catch(() => {});
  /** @type {(() => void)[]} */
  const unwatch = [];
  const watch = (/** @type {import('playwright-core').Browser} */ b) => {
    /* ended for the memory the page took: said so, and not drawn again in new browsers (browserFailed) */
    const closed = () => crash(memoryError(b) ?? gone);
    b.on('disconnected', closed);
    unwatch.push(() => b.off('disconnected', closed));
    if (!b.isConnected()) closed();
  };
  const unlessCancelled = (/** @type {Promise<any>} */ step) => { step.catch(() => {}); return Promise.race([step, cancelled, crashed]); };
  try {
    /* a browser each: pages sharing one browser share its GPU process, and stop getting faster after three or four */
    const more = pool ? lent.slice(1, workers) : await unlessCancelled(Promise.all(Array.from({ length: workers - 1 }, () => launch().then((b) => { browsers.push(b); return b; }))));
    for (const b of [browser, ...more]) watch(b);
    const opening = [browser, ...more].map((b) => FilmPage.open(b, site.url, entry, { scale, transparent: alpha }).then((p) => { tabs.push(p); return p; }));
    const pages = await unlessCancelled(Promise.all(opening));
    /* a film paints its stage behind its clips (black, or its own background): with alpha, only what the clips draw is kept */
    if (alpha && isFilm) await Promise.all(pages.map((p) => p.page.addStyleTag({ content: 'html, body { background: transparent !important; }' })));
    /**
     * The chunks not there yet, encoded with `f`, each tab taking the next in turn: one that fails stops the others
     * before its error is told. Those drawn with `f` before (a render that stopped) are counted done.
     * @param {typeof format} f @param {boolean} opaque
     */
    const encodeAll = async (f, opaque) => {
      await store.start(settingsFor(f));
      const left = chunks.filter((c) => !store.done(c));
      reused = chunks.length - left.length;
      done = total - left.reduce((n, c) => n + c.b - c.a, 0);
      drawn = 0;
      straightFrames = 0;
      told = Math.floor((done / total) * 10);
      if (reused && !opts.onProgress && !process.stderr.isTTY) process.stderr.write(`  ${done} of ${total} frames were drawn by a render that stopped: drawing the rest\n`);
      if (done) opts.onProgress?.(done, total);
      const stop = new AbortController();
      const quit = () => stop.abort();
      opts.signal?.addEventListener('abort', quit, { once: true });
      /* the chunks that are footage alone are read straight from their files, one after another, while the browsers
         draw the others. One ffmpeg fails at is drawn in a browser after all, with the rest */
      const read = left.filter((c) => plans.has(c));
      for (const c of read) left.splice(left.indexOf(c), 1);
      const draw = (/** @type {FilmPage} */ film) => async () => {
        for (let c = left.shift(); c && !stop.signal.aborted; c = left.shift()) {
          const held = await encode({ film, a: c.a, b: c.b, file: store.drawing(c) }, { fps, rate, samples, shutter, alpha, duration: end, first: f0, format: f, onFrame: progress, still: alpha || opts.fine ? 'png' : 'jpeg', opaque, signal: stop.signal, frameHolds, encoderTimeoutMs: opts.encoderTimeoutMs,
            sourceFrame: selection ? (frame) => selectionFrame(selection.spans, frame) : (frame) => frame });
          heldFrames += held;
          store.finished(c, used);
        }
      };
      /** @type {{ a: number, b: number }[]} */
      const refused = [];
      /** @type {Map<string, string>} the captions' pictures made so far, by the cues in them */
      const pictures = new Map();
      const reading = (async () => {
        for (const c of read) {
          if (stop.signal.aborted) return;
          const plan = /** @type {import('./direct.mjs').Plan} */ (plans.get(c));
          try {
            /* the captions over it: each set of cues drawn once, alone, the first time it is on */
            for (const over of plan.overlays) {
              if (pictures.has(over.key)) continue;
              const alone = await captionPage(scale);
              await alone.seek(Math.min(over.at / fps, end - 1e-4));
              const picture = join(work, `captions-${pictures.size}.png`);
              writeFileSync(picture, await alone.capture({ format: 'png' }));
              pictures.set(over.key, picture);
            }
            await straight(plan, store.drawing(c), { size, rate, ground: /** @type {import('./direct.mjs').Layers} */ (footage).ground, format: f, pictures, signal: stop.signal });
          } catch (e) {
            if (stop.signal.aborted) throw e;
            refused.push(c);
            continue;
          }
          for (const file of plan.files) if (!used.has(file)) used.set(file, signature(file));
          store.finished(c, used);
          straightFrames += c.b - c.a;
          for (let n = c.a; n < c.b; n++) progress();
        }
      })();
      const runs = [...pages.map((film) => draw(film)()), reading];
      try {
        await unlessCancelled(Promise.all(runs));
        /* what could not be read straight: drawn now, from a copy the browser plays where it needs one */
        if (refused.length && !stop.signal.aborted) {
          for (const c of refused) plans.delete(c);
          if (opts.seekable !== false) {
            const late = [...new Set(refused.flatMap((c) => /** @type {import('./direct.mjs').Layers} */ (footage).layers.filter((l) => l.file && l.at < c.b / fps && l.end > c.a / fps).map((l) => /** @type {string} */ (l.file))))].filter((file) => !copies.has(file));
            copies = new Map([...copies, ...await browserCopies(browser, site.url, root, late, { signal: opts.signal, slow: true, fine: !!opts.fine, failed: () => {} })]);
          }
          left.push(...refused);
          await unlessCancelled(Promise.all(pages.map((film) => draw(film)())));
        }
      } catch (e) {
        stop.abort();
        if (e !== gone) await Promise.allSettled(runs);
        throw e === gone ? e : outOfMemory(e, pages.length);
      } finally {
        opts.signal?.removeEventListener('abort', quit);
      }
    };
    /** The frames with `f`, watched for a pixel that shows through while the page may be opaque. @param {typeof format} f */
    const drawAll = async (f) => {
      if (!clearFormat || clear) return encodeAll(f, false);
      try {
        await encodeAll(f, true);
      } catch (e) {
        if (/** @type {{ code?: unknown }} */ (e)?.code !== 'CLEAR') throw e;
        /* a pixel shows through: every part stopped between two frames, and the frames are drawn again with alpha */
        clear = true;
        heldFrames = 0;
        format = clearFormat;
        encoder = encoderOf(format.video);
        opts.onEncoder?.(encoder);
        await encodeAll(format, false);
      }
    };
    try {
      await drawAll(format);
    } catch (e) {
      /* the chip's encoder gave up partway (a driver, a size it does not take): the frames again without it, and the
         rest of this launch does without it. One held to a quality is first given its bitrate, as it was before it
         could be held, and only gives the frames to the processor's when that fails too */
      const gaveUp = (/** @type {unknown} */ err) => !!chip && onChip && !clear && !opts.signal?.aborted && /^ffmpeg/.test(err instanceof Error ? err.message : '');
      if (!chip || !gaveUp(e)) throw e;
      let failure = /** @type {unknown} */ (e);
      const stalled = /** @type {{ code?: string }} */ (e)?.code === 'ENCODER_STALLED';
      if (chip.format.ceiling && !stalled) {
        unheld(chip.encoder);
        format = { ...own, video: chip.format.ceiling.video };
        failure = await drawAll(format).then(() => null, (err) => err);
        if (failure && !gaveUp(failure)) throw failure;
      }
      if (failure) {
        broken(chip.encoder);
        onChip = false;
        format = own;
        encoder = encoderOf(own.video);
        if (stalled) process.stderr.write(`openfilm: ${chip.encoder} stopped responding; encoding again with ${encoder}\n`);
        opts.onEncoder?.(encoder);
        await drawAll(format);
      }
    }
    if (process.stderr.isTTY && !opts.onProgress) process.stderr.write('\n');
    for (const p of pages) problems.push(...p.problems);

    const allClips = opts.silent ? [] : await filmSound(probe, selection ? 0 : from);
    const clips = selection ? selectionClips(allClips, selection.spans) : allClips;
    if (opts.signal?.aborted) throw new Error('cancelled');
    const sound = clips.length ? join(work, `sound${extname(out) === '.mp4' ? '.m4a' : extname(out) === '.webm' ? '.webm' : '.wav'}`) : null;
    /* --loudness: the mix as it is (32-bit float: sounds added together pass full scale), brought to the target as it
       is encoded; the picture is not touched. Without it, the mix as it is, its peaks caught under the ceiling: sounds
       added together never clip */
    if (sound && opts.loudness != null) {
      const wav = join(work, 'mix.wav');
      await mix(clips, to - from, wav, ['-c:a', 'pcm_f32le']);
      loud = await toLoudness(wav, sound, format.audio, { lufs: opts.loudness, signal: opts.signal });
    } else if (sound) await mix(clips, to - from, sound, format.audio, { limit: true });
    const after = [...format.tag, ...(extname(out) === '.mp4' ? ['-movflags', '+faststart'] : [])];
    /* the parts straight into `out`, with the sound: a page's frames are on the disk twice at most while it is written,
       not three times (a long page drawn as PNG for an editing project is gigabytes). A part with nothing to add is
       `out` already, moved into place */
    const parts = chunks.map((c) => store.file(c));
    /* a chip held to a quality gives a film busy in every frame (grain, static) many times the file its bitrate
       makes: past what it may come to (`ceiling`, encoders.mjs chipDelivery), the picture is encoded once more at a
       bitrate as the parts are joined, from the parts as they are. Should that fail, the parts are the film */
    const ceiling = format.ceiling;
    const over = !!ceiling && parts.reduce((bytes, p) => bytes + statSync(p).size, 0) * 8 > ceiling.bits * (total / fps);
    if (over || parts.length > 1 || sound || after.length || !moved(parts[0], out)) {
      /* names, not paths: concat reads them beside the list, and a path can hold a `'` (C:\\Users\\O'Brien) */
      if (parts.length > 1) writeFileSync(join(work, 'list.txt'), parts.map((p) => `file '${basename(p)}'`).join('\n'));
      const video = parts.length > 1 ? ['-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt')] : ['-i', parts[0]];
      const joined = (/** @type {string[]} */ codec) => ffmpeg([...video, ...(sound ? ['-i', sound, '-map', '0:v', '-map', '1:a'] : []), ...codec, ...after, out]).done;
      const again = over ? await joined([...ceiling.video, '-c:a', 'copy']).then(() => true, (e) => { if (opts.signal?.aborted) throw e; return false; }) : false;
      if (!again) await joined(['-c', 'copy']);
    }
    failed = false;
  } finally {
    for (const off of unwatch) off();
    /* a render that ended takes its chunks away, and so does one cancelled on purpose (a 4K export's chunks are tens of
       GB, out of sight); one that stopped on its own (an error, a crash, the app quit) keeps those it finished for the next */
    store.close(!failed || !!opts.signal?.aborted);
    await closeCaptionPages();
    await Promise.allSettled(browsers.map((b) => b.close()));
    if (pool) await Promise.allSettled(tabs.map((p) => p.close()));
    await probe.close();
    /* a render that failed or was cancelled may have left a browser stuck: those are not lent again */
    await pool?.give(lent, { retire: failed });
  }
  const seconds = (Date.now() - started) / 1000;
  return {
    out,
    encoder,
    ...(software ? { software } : {}),
    ...(straightFrames ? { straight: straightFrames } : {}),
    ...(heldFrames ? { heldFrames } : {}),
    ...(selection ? { ranges: selection.spans.map((part) => [part.from, part.to]) } : {}),
    ...(clearFormat ? { clear } : {}),
    ...(opts.dependencies ? { dependencies: [...used.keys()].filter((file) => !file.startsWith(work)),
      dependencySignatures: [...used].filter(([file]) => !file.startsWith(work)),
      cacheable: [probe.film, ...tabs].every((p) => p.externalRequests.size === 0) } : {}),
    lines: [
      `→ ${shown(out)}`,
      `  ${total} frames · ${fmt(to - from)} at ${Number(fps.toFixed(3))} fps · ${size.w}×${size.h}${samples > 1 ? ` · ${samples} samples/frame` : ''}${alpha ? ' · alpha' : ''} · ${workers} worker${workers > 1 ? 's' : ''} · ${encoder} · ${seconds.toFixed(1)} s`,
      ...(straightFrames ? [`  ${straightFrames} of them read straight from the footage`] : []),
      ...loudnessLines(opts.loudness, loud, opts.silent),
      ...(reused ? [`  ${reused} of ${chunks.length} chunks were drawn by a render that stopped, and used`] : []),
      ...uncopied.map((file) => `✗ copy: ${shown(file)}: could not be made, drawn as it is`),
      ...problems.map((p) => `✗ ${p.kind === 'request' ? 'request' : 'page'}: ${p.message}`),
    ],
  };
}

/**
 * What --loudness did, as render's lines: the sound before and after, and whether it landed.
 * @param {number | undefined} lufs @param {{ before: { lufs: number, peak: number }, after: { lufs: number, peak: number } } | null} loud @param {boolean} [silent]
 */
function loudnessLines(lufs, loud, silent) {
  if (lufs == null || silent) return [];
  if (!loud) return [`! --loudness: the film has no sound to bring to ${lufs} LUFS`];
  if (!Number.isFinite(loud.before.lufs)) return [`! --loudness: the film's sound is silent, left as it is`];
  const landed = Math.abs(loud.after.lufs - lufs) <= LOUDNESS_SLACK && loud.after.peak <= TRUE_PEAK;
  return [`♪ sound at ${lufs} LUFS: ${loudnessText(loud.before)} → ${loudnessText(loud.after)}`,
    ...(landed ? [] : [`! the sound did not land on ${lufs} LUFS under ${TRUE_PEAK} dBTP: a stretch may be clipped or far louder than the rest; look at the mix`])];
}

/**
 * One browser per three cores, at most four, and memory to spare (a page with its media takes 1.5 GB or more, and the
 * encoder and the person's own apps need theirs): a render leaves the computer usable while it runs.
 */
/** The memory a browser drawing a film takes, with its share of the encoding (a 1080p film's page measured 1.1 GB). */
const WORKER_MEMORY = 1.5 * 2 ** 30;
/** Memory left free for the person's own apps. */
const RESERVE = 2 * 2 ** 30;
/** Frames worth a browser of their own: for fewer, starting one costs more than it saves. */
const FRAMES_PER_WORKER = 60;
/** More browsers stop drawing faster: they share one graphics chip (measured: three draw twice as fast as one;
 * past four, slower, and eight ran out of resources). */
const MAX_WORKERS = 4;

/**
 * What a render may use of this machine: its performance cores (Apple silicon's efficiency cores are slow for
 * drawing; elsewhere a core is two threads) and the memory free now. On a Mac `os.freemem()` counts only memory never
 * used, a fraction of what is free: the system's own share of free memory is read instead.
 */
export function machine() {
  const sysctl = (/** @type {string} */ name) => Number(spawnSync('sysctl', ['-n', name], { encoding: 'utf8', timeout: 2000 }).stdout?.trim());
  let cores = Math.max(1, Math.floor(availableParallelism() / 2));
  let available = freemem();
  if (process.platform === 'darwin') {
    const performance = sysctl('hw.perflevel0.physicalcpu');
    if (performance > 0) cores = performance;
    const free = sysctl('kern.memorystatus_level');
    if (free > 0 && free <= 100) available = (totalmem() * free) / 100;
  }
  return { cores, available };
}

/**
 * How many browsers draw a render: one for each performance core but one (the person keeps one), as many as the
 * memory free now holds with room left for the person's apps, and enough frames for each; at most four. The
 * computer stays usable while it renders: a render takes only memory that is free when it starts.
 * @param {{ cores: number, available: number }} [budget] @param {number} [frames]
 */
export function defaultWorkers({ cores, available } = machine(), frames = Infinity) {
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1, Math.floor((available - RESERVE) / WORKER_MEMORY), Math.floor(frames / FRAMES_PER_WORKER)));
}

/** A manual Studio limit overrides Auto's hardware recommendation, while short pages still earn their browsers.
 * The export API validates 1–8; Auto retains the conservative memory/core budget above.
 * @param {number | undefined} requested @param {number} [frames] @param {{cores:number,available:number}} [budget] */
export function renderWorkerLimit(requested, frames = Infinity, budget = machine()) {
  return requested == null ? defaultWorkers(budget, frames)
    : Math.max(1, Math.min(requested, Math.floor(frames / FRAMES_PER_WORKER)));
}

/** What a part drawn opaque (render's `clear`) stops with: a pixel that shows through, or alpha that could not be read. @param {string} where */
const showsThrough = (where) => Object.assign(new Error(`a pixel shows through ${where}`), { code: 'CLEAR' });

/**
 * Each frame's least alpha, read as the frames are drawn: an ffmpeg beside the encoder takes the same pictures (a
 * picture with nothing clear comes from the browser as a PNG with no alpha, read as opaque). It starts at the first
 * picture (no probing: the stream is known), decodes one at a time (threads would hold a dozen back) and says each
 * frame's at once (`direct`: not held for a buffer to fill), so a render stops a few frames after a pixel shows
 * through. `clear` turns true at that pixel; `read` counts the frames read; `ended`, its exit code.
 */
function alphaWatch() {
  const proc = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-probesize', '32', '-analyzeduration', '0', '-threads', '1', '-f', 'image2pipe', '-c:v', 'png', '-i', '-',
    '-vf', 'format=rgba,alphaextract,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMIN:file=-:direct=1', '-f', 'null', '-'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  proc.stdin.on('error', () => {});
  const watch = { proc, read: 0, clear: false, ended: new Promise((done) => { proc.on('error', () => done(-1)); proc.on('close', (code) => done(code)); }) };
  let rest = '';
  proc.stdout.on('data', (d) => {
    const lines = (rest + d).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      const m = /YMIN=(\d+)/.exec(line);
      if (!m) continue;
      watch.read++;
      if (Number(m[1]) < 255) watch.clear = true;
    }
  });
  return watch;
}

/** Frames [a, b) of one page into one file; sub-frames are averaged by ffmpeg (tmix) and every n-th kept. */
async function encode({ film, a, b, file }, { fps, rate, samples, shutter, alpha, duration, first = a, format, onFrame, still, opaque, signal, frameHolds = null, encoderTimeoutMs, sourceFrame = (frame) => frame }) {
  /* a 4:2:0 picture wants even dimensions. A --scale between two pixels (1920 x .667) makes the browser's surface
     1281 wide: the file was written, and every strict H.264 encoder after it said `width not divisible by 2`.
     Crop the odd last column or row on the way in: scaling 1281 to 1280 would resample the whole frame, a crop keeps
     every pixel as drawn. An even size is left alone. */
  const even = 'crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0,';
  const blur = samples > 1 ? `tmix=frames=${samples},select='eq(mod(n\\,${samples})\\,${samples - 1})',setpts=N/((${ffmpegRate(rate)})*TB),` : '';
  /* Chromium omits PNG's alpha plane for an entirely opaque frame. Reinitializing on that format change resets
     tmix and select's frame index, losing samples or even every frame of a short transparent export. */
  const enc = ffmpeg(['-f', 'image2pipe', '-framerate', ffmpegRate(rate, samples), '-c:v', still === 'png' ? 'png' : 'mjpeg',
    ...(alpha && samples > 1 ? ['-reinit_filter', '0'] : []), '-i', '-',
    '-vf', even + (alpha && samples > 1 ? `${alphaCompositeFilter(blur.slice(0, -1))},` : blur) + format.pix, '-r', ffmpegRate(rate), ...format.video, file], { input: true });
  /* a page drawn opaque: its alpha read beside the encoder, every frame */
  const watch = opaque ? alphaWatch() : null;
  /* a cancelled render stops its encoder at once: the frames ffmpeg still holds are thrown away, not encoded (a 4K
     encode takes seconds to drain); the chunk it was writing goes with it (see render's finally) */
  let stopped = false;
  const stop = () => { stopped = true; kill(enc.proc); if (watch) kill(watch.proc); };
  enc.proc.stdin.on('error', () => {});
  /* a watch that ends before the last frame cannot say the page is opaque */
  const unwatched = watch?.ended.then(() => { throw showsThrough('(its alpha could not be read)'); });
  unwatched?.catch(() => {});
  /* an ffmpeg that ends before its last frame (not found, an encoder that fails to start) never drains its input:
     the frame being written fails with ffmpeg's own error instead of waiting for it forever */
  const ended = enc.done.then(() => { throw new Error('ffmpeg ended before the last frame'); });
  ended.catch(() => {});
  signal?.addEventListener('abort', stop, { once: true });
  let previous = null, held = 0;
  const wait = (pending) => encoderWait(pending, { signal, timeoutMs: encoderTimeoutMs });
  try {
    /* a tab's first two pictures come out a little off the rest (a transparent page's soft edges, by a level or two):
       two are taken and thrown away first, of the two frames before this part (of its first frame for the render's
       first part), so a frame is the same however many browsers share the render */
    for (const f of [a - 2, a - 1].map((n) => Math.max(first, n))) {
      await film.seek(Math.min(Math.max(0, sourceFrame(f) / fps), duration - 1e-4));
      await film.capture(still === 'png' ? { format: 'png' } : { format: 'jpeg', quality: 95 });
    }
    for (let f = a; f < b; f++) {
      if (signal?.aborted) {
        stop();
        throw new Error('cancelled');
      }
      if (watch?.clear) {
        stop();
        throw showsThrough(`by ${fmt(sourceFrame(f) / fps)}`);
      }
      for (let k = 0; k < samples; k++) {
        const t = (sourceFrame(f) + (samples > 1 ? (k / samples - 0.5) * shutter : 0)) / fps;
        let frame = previous;
        if (!frame || !frameHolds || frameHolds.has(sourceFrame(f))) {
          await film.seek(Math.min(Math.max(0, t), duration - 1e-4));
          frame = await film.capture(still === 'png' ? { format: 'png' } : { format: 'jpeg', quality: 95 });
          previous = frame;
        } else held++;
        await wait(Promise.race([write(enc.proc.stdin, frame), ended]));
        if (watch) await wait(Promise.race([write(watch.proc.stdin, frame), unwatched]));
      }
      onFrame();
    }
    enc.proc.stdin.end();
    watch?.proc.stdin.end();
    /* Keep cancellation and the inactivity deadline active while ffmpeg flushes its last frames too. */
    await wait(enc.done);
    if (watch) {
      const code = await wait(watch.ended);
      if (watch.clear) throw showsThrough('in its last frames');
      if (code !== 0 || watch.read !== (b - a) * samples) throw showsThrough(`(its alpha could not be read: ${watch.read} of ${(b - a) * samples} frames, exit ${code})`);
    }
    return held;
  } catch (error) {
    stop();
    throw error;
  } finally {
    signal?.removeEventListener('abort', stop);
    enc.proc.stdin.destroy();
    watch?.proc.stdin.destroy();
    /* stopped: told once ffmpeg has exited, so the part it was writing can be removed (Windows keeps a file open
       until then, and a kill there takes a moment) */
    if (stopped) await Promise.allSettled([enc.done, watch?.ended]);
  }
}
