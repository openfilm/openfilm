// @ts-check
/**
 * What Studio works out from media files, with ffmpeg and ffprobe: a video's poster, a frame at a moment (timeline
 * thumbnails), a sound's waveform, the loudness of a part of it, and any media's length and size. Each is cached in `.film/cache/`, keyed by the
 * file's path, size and modification time, so a changed file is worked out again and an unchanged one never is.
 *
 * ffmpeg runs a few at a time: a project opened with fifty clips must not start fifty decoders. The editor's sound of
 * each file (soundOf) is made a few at a time of its own, so a long recording's does not hold up the thumbnails.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { availableParallelism, setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioClips, fileOf, knowAudioChannels, mix } from '../../src/shared.mjs';
import { hardwareDecoding } from '../../src/encoders.mjs';
import { clipKind } from '../../src/film-doc.mjs';
import { hasAlpha, keyFrameGap } from '../../src/seekable.mjs';
import { readable } from './files.mjs';
import { TOOL_DIR } from './projects.mjs';
import { writeAtomic } from './atomic.mjs';

export class MediaError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

/** @typedef {{ size: number, busy: number, waiting: (() => void)[] }} Slots */
/**
 * How many ffmpeg and ffprobe run at once for what the editor is waiting on (a file's facts, a poster, a frame, a
 * strip of key frames): three, and on a machine of more cores half of them, up to six. A film's strips are begun
 * together when it is opened (server.mjs filmStripsSoon); with five at once on ten cores its thumbnails were all in
 * a seventh sooner than with three.
 * @type {Slots}
 */
const SLOTS = { size: Math.max(3, Math.min(6, Math.floor(availableParallelism() / 2))), busy: 0, waiting: [] };
/** @type {Slots} */
const SOUND_SLOTS = { size: 2, busy: 0, waiting: [] };
/** Run `tool` with `args` when one of `slots` is free; resolves with its stdout (`stderr`: its stderr) as a Buffer. */
async function tool(/** @type {'ffmpeg' | 'ffprobe'} */ name, /** @type {string[]} */ args, slots = SLOTS, stderrOut = false, low = false) {
  if (slots.busy >= slots.size) await new Promise((r) => slots.waiting.push(() => r(undefined)));
  slots.busy++;
  try {
    return await new Promise((resolve, reject) => {
      const child = execFile(name, args, { encoding: 'buffer', maxBuffer: 64 << 20, windowsHide: true }, (error, stdout, stderr) => {
        if (!error) return resolve(stderrOut ? stderr : stdout);
        if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
          return reject(new MediaError(`${name} is not installed (macOS: brew install ffmpeg · Debian/Ubuntu: sudo apt install ffmpeg · Windows: winget install ffmpeg)`, 501));
        }
        reject(new MediaError(stderr.toString().trim().split('\n').pop() || error.message));
      });
      /* `low`: work nobody is waiting on (a closer strip) gives way to the editor and the person's other apps */
      if (low) try { if (child.pid) setPriority(child.pid, 10); } catch { /* left as it is */ }
    });
  } finally {
    slots.busy--;
    slots.waiting.shift()?.();
  }
}

/** The file, and the cache key that changes when it does. */
async function source(/** @type {string} */ root, /** @type {string} */ rel) {
  const abs = readable(root, rel);
  const info = await stat(abs).catch(() => null);
  if (!info?.isFile()) throw new MediaError(`${rel} is not there`, 404);
  const key = createHash('sha1').update(`${rel}\0${info.size}\0${Math.round(info.mtimeMs)}`).digest('hex').slice(0, 20);
  return { abs, key };
}

/** A cached result: the file in `.film/cache/<kind>/`, made by `make` (written whole, through a temporary name). */
async function cached(/** @type {string} */ root, /** @type {string} */ kind, /** @type {string} */ name, /** @type {() => Promise<Buffer>} */ make) {
  const dir = join(root, TOOL_DIR, 'cache', kind);
  const file = join(dir, name);
  if (existsSync(file)) return readFile(file);
  const bytes = await make();
  await mkdir(dir, { recursive: true });
  await writeAtomic(file, bytes);
  return bytes;
}

/**
 * Length and picture size of a media file: `{ duration (s), width, height, fps, audio, codec, pixfmt, profile, level }`;
 * a still has no duration. The size is the picture as it is shown: a video turned a quarter (a phone's portrait video)
 * has its sides swapped. `codec`, `pixfmt`, `profile` and `level` are its picture's (proxies.mjs tells heavy footage by
 * them, and asks the editor whether its browser decodes it).
 * @param {string} root @param {string} rel
 */
export async function probe(root, rel) {
  const { abs, key } = await source(root, rel);
  /* a photograph a phone took upright has its pixels on their side and an Exif that says so, which ffprobe does not
     say: its size is as it is shown, like a turned video's (kept under a name of its own: one read before was not) */
  const photo = /\.jpe?g$/i.test(rel);
  const bytes = await cached(root, 'probe', `${key}.${photo ? 6 : 5}.json`, async () => {
    const out = JSON.parse((await tool('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', abs])).toString());
    const video = out.streams?.find((/** @type {{ codec_type: string, disposition?: { attached_pic?: number } }} */ s) =>
      s.codec_type === 'video' && !s.disposition?.attached_pic);
    const audio = out.streams?.some((/** @type {{ codec_type: string }} */ s) => s.codec_type === 'audio');
    const [n, d] = String(video?.avg_frame_rate ?? '0/1').split('/').map(Number);
    const duration = Number(out.format?.duration);
    const turn = Number(video?.side_data_list?.find((/** @type {{ rotation?: number }} */ s) => s.rotation != null)?.rotation ?? video?.tags?.rotate ?? 0);
    const quarter = photo ? await jpegOrientation(abs) >= 5 : Math.abs(Math.round(turn / 90)) % 2 === 1;
    return Buffer.from(JSON.stringify({
      ...(Number.isFinite(duration) && duration > 0 && !/image|png|mjpeg/.test(String(out.format?.format_name)) ? { duration } : {}),
      ...(video ? (quarter ? { width: video.height, height: video.width } : { width: video.width, height: video.height }) : {}),
      ...(d && n ? { fps: Math.round((n / d) * 100) / 100 } : {}),
      ...(video?.codec_name ? { codec: String(video.codec_name), pixfmt: String(video.pix_fmt ?? '') } : {}),
      ...(video?.profile ? { profile: String(video.profile) } : {}),
      ...(video && hasAlpha(video) ? { alpha: true } : {}),
      ...(Number(video?.level) > 0 ? { level: Number(video.level) } : {}),
      audio: Boolean(audio),
    }));
  });
  return JSON.parse(bytes.toString());
}

/**
 * How far apart a video's key frames are (s; null when it cannot tell): what a seek in it costs (src/seekable.mjs
 * keyFrameGap). Kept with the file's probe.
 * @param {string} root @param {string} rel @returns {Promise<number | null>}
 */
export async function keyGap(root, rel) {
  const { abs, key } = await source(root, rel);
  const bytes = await cached(root, 'probe', `${key}.gop.json`, async () => Buffer.from(JSON.stringify({ gap: await keyFrameGap(abs) })));
  return JSON.parse(bytes.toString()).gap ?? null;
}

/**
 * A video's or a picture's poster: one frame a second in (or its first), 480 px wide, as JPEG; as PNG when it has an
 * alpha in its pixels (a ProRes 4444, a PNG), so what it leaves clear stays clear. A picture file's is the picture
 * itself, small (the timeline draws a picture clip's cells from it: the file itself, a photograph of twelve million
 * pixels, was read and decoded whole by the editor for a cell a few dozen pixels wide, each time the project opened).
 */
export async function poster(/** @type {string} */ root, /** @type {string} */ rel) {
  const { abs, key } = await source(root, rel);
  const clear = hasAlpha({ pix_fmt: (await probe(root, rel).catch(() => null))?.pixfmt });
  const as = clear ? ['-pix_fmt', 'rgba', '-vcodec', 'png'] : ['-vcodec', 'mjpeg', '-q:v', '4'];
  const still = clipKind(rel) === 'still';
  /* a picture's is kept under a name of its own: one kept before could be empty (below) */
  return cached(root, 'posters', `${key}${still ? '.p' : ''}.${clear ? 'png' : 'jpg'}`, async () => {
    const grab = (/** @type {string[]} */ reading, turned = '') => tool('ffmpeg', ['-v', 'error', ...reading, '-i', abs, '-frames:v', '1', '-vf', `${turned}scale=480:-2`, '-f', 'image2pipe', ...as, '-']);
    if (still) {
      /* a picture has one frame, at no moment: sought (even to 0), a JPEG gives none (ffmpeg 8), and the poster kept
         was an empty file. A photograph is turned as its Exif says, as a browser shows it: said here, since an ffmpeg
         before 7 does not turn it by itself, and the thumbnail lay on its side */
      const turned = /\.jpe?g$/i.test(rel) ? TURNED[await jpegOrientation(abs)] ?? '' : null;
      const made = await grab(turned == null ? [] : ['-noautorotate'], turned ?? '');
      if (!made.length) throw new MediaError(`no picture could be read from ${rel}`);
      return made;
    }
    const frame = await grab(['-ss', '1']).catch(() => Buffer.alloc(0));
    return frame.length ? frame : grab(['-ss', '0']);
  });
}

/** What turns a JPEG upright, by the orientation its Exif says (2 to 8), as ffmpeg filters before the next. */
const TURNED = /** @type {Record<number, string>} */ ({ 2: 'hflip,', 3: 'hflip,vflip,', 4: 'vflip,', 5: 'transpose=0,', 6: 'transpose=1,', 7: 'transpose=3,', 8: 'transpose=2,' });

/** A JPEG's orientation as its Exif says (1 to 8); 1, as stored, when it says none or cannot be read. */
async function jpegOrientation(/** @type {string} */ abs) {
  const file = await open(abs, 'r').catch(() => null);
  if (!file) return 1;
  try {
    /* the Exif is in a segment before the picture's data, at most 64 KB, after at most a few others */
    const { buffer, bytesRead } = await file.read(Buffer.alloc(262144), 0, 262144, 0);
    const b = buffer.subarray(0, bytesRead);
    if (b.readUInt16BE(0) !== 0xffd8) return 1;
    for (let i = 2; b[i] === 0xff && b[i + 1] !== 0xda && b[i + 1] !== 0xd9; i += 2 + b.readUInt16BE(i + 2)) {
      if (b[i + 1] !== 0xe1 || b.toString('latin1', i + 4, i + 10) !== 'Exif\0\0') continue;
      const tiff = i + 10;
      const little = b.toString('latin1', tiff, tiff + 2) === 'II';
      const u16 = (/** @type {number} */ at) => (little ? b.readUInt16LE(at) : b.readUInt16BE(at));
      const ifd = tiff + (little ? b.readUInt32LE(tiff + 4) : b.readUInt32BE(tiff + 4));
      for (let n = u16(ifd), entry = ifd + 2; n > 0; n -= 1, entry += 12) {
        if (u16(entry) === 0x0112) return u16(entry + 8) >= 1 && u16(entry + 8) <= 8 ? u16(entry + 8) : 1;
      }
      return 1;
    }
  } catch { /* cut short, or not as a JPEG is written: as stored */ } finally {
    await file.close().catch(() => {});
  }
  return 1;
}

/**
 * The input options that decode a video's picture on the graphics chip, where that is the faster way to its
 * thumbnails; none where the processor is. Measured on Apple silicon, 4K: an HEVC file's key frames come 1.4 times
 * sooner from the chip, a frame deep in a long group of pictures twice, the whole file three times; H.264 is the other
 * way round (the processor decodes it on every core, the chip at a few times the speed it plays), so it and every
 * other codec stay on the processor. What the chip cannot take, ffmpeg decodes on the processor by itself.
 * @param {string} root @param {string} rel @returns {Promise<string[]>}
 */
async function chipDecoding(root, rel) {
  const codec = (await probe(root, rel).catch(() => null))?.codec;
  return codec === 'hevc' ? hardwareDecoding().catch(() => []) : [];
}

/** The frame of a video at `ms`, `width` px wide (the timeline's thumbnails). */
export async function frame(/** @type {string} */ root, /** @type {string} */ rel, /** @type {number} */ ms, /** @type {number} */ width, /** @type {string | null} */ lighter = null) {
  if (!(Number.isFinite(ms) && ms >= 0)) throw new MediaError('which moment?', 400);
  const w = Math.max(32, Math.min(640, Math.round(width / 2) * 2 || 160));
  const { abs, key } = await source(root, rel);
  const cut = (/** @type {string} */ from, /** @type {string[]} */ decoding = []) => tool('ffmpeg', [
    '-v', 'error', ...decoding, '-ss', String(ms / 1000), '-i', from, '-frames:v', '1', '-vf', `scale=${w}:-2`, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', '-',
  ]);
  /* from the file itself, on the graphics chip where that is the faster way (chipDecoding), else by the processor */
  const own = async () => {
    const chip = await chipDecoding(root, rel);
    return chip.length ? cut(abs, chip).catch(() => cut(abs)) : cut(abs);
  };
  /* `lighter`: a copy of the file with the same frames at the same times, smaller and with key frames close together
     (the preview's proxy): a frame is cut from it several times sooner (a seek decodes from the key frame before it),
     and is the same picture at a thumbnail's size; from the file itself when that fails */
  return cached(root, 'frames', `${key}-${Math.round(ms)}-${w}.jpg`, () => (lighter ? cut(lighter).catch(own) : own()));
}

/*
 * A video's strip: pictures from all along it, in one image, made by one run of ffmpeg and kept. The timeline draws a
 * clip's thumbnails from its file's strip at once (as an editor does, from the pictures it keeps of each recording),
 * at any zoom and through any trim, split or move, where each cell was a frame of its own to ask for and to cut: a
 * file opened, sought and decoded for every one, two at a time, and a row stood empty or borrowed until they came.
 * The frames asked for one by one (frame) still come after, where a cell stands between two of the strip's pictures.
 *
 * A file's key frames are read without decoding anything between them, in a fraction of a second however long it is:
 * where they are as close as the pictures wanted, they are the strip. Where they are further apart (a generated clip
 * with a single one, a screen recording), they are its first strip, there at once, and a closer one is made behind
 * it by decoding the whole file, one such file at a time at low priority; whoever asked is told a closer one is coming.
 */
/** A strip's pictures: at most STRIP_MOST, no closer than STRIP_STEP (s), each inside a STRIP_SIDE box (two device
    pixels to a timeline cell's px), STRIP_COLS to a row. */
const STRIP_MOST = 120, STRIP_STEP = 0.5, STRIP_SIDE = 160, STRIP_COLS = 12;
/** How much decoding a closer strip may cost, in 1080p frames (ten minutes of 1080p at 30 a second): past that a
    file keeps its key frames' strip, and the frames asked for one by one fill in. */
const STRIP_DECODE_MOST = 20_000;
/** Closer strips are made one at a time, apart from everything else ffmpeg is asked: each decodes a whole file. */
/** @type {Slots} */
const STRIP_SLOTS = { size: 1, busy: 0, waiting: [] };
/** @typedef {{ cols: number, rows: number, w: number, h: number, times: number[] }} StripIndex its grid, each picture's size, and each one's moment in the file (ms), in the grid's order */
/** @typedef {{ index: StripIndex, picture: string, part: 'keys' | 'all', closer: boolean }} Strip `part`: of its key frames alone, or all it will ever be; `closer`: a closer one is being made */
/** @type {Map<string, Promise<{ index: StripIndex, picture: string }>>} strips being made, by their picture's file */
const stripping = new Map();
/** @type {Set<string>} closer strips that could not be made (by their picture's file): not tried again this launch */
const stripFailed = new Set();

/** A strip kept at `picture` with its index at `list`; null when it is not (the index is written last). */
const keptStrip = async (/** @type {string} */ picture, /** @type {string} */ list) => {
  const index = await readFile(list, 'utf8').then((t) => /** @type {StripIndex} */ (JSON.parse(t)), () => null);
  return index && existsSync(picture) ? { index, picture } : null;
};

/**
 * Make one strip of `abs` into `picture` and `list`: `keys`, of its key frames alone (no closer than `step` s);
 * else of every frame decoded, at low priority in a line of its own.
 * @param {string} abs @param {string} rel @param {string} picture @param {string} list
 * @param {{ step: number, w: number, h: number, rows: number }} plan @param {boolean} keys
 * @param {string[]} [chip] the input options that decode it on the graphics chip, where that is the faster way
 */
function makeStrip(abs, rel, picture, list, plan, keys, chip = []) {
  let making = stripping.get(picture);
  if (making) return making;
  making = (async () => {
    await mkdir(join(picture, '..'), { recursive: true });
    const part = `${picture}.${process.pid}.part.jpg`;
    const most = STRIP_COLS * plan.rows;
    const drawn = `scale=${plan.w}:${plan.h},tile=${STRIP_COLS}x${plan.rows}`;
    const run = (/** @type {string[]} */ reading, /** @type {string} */ select, slots = SLOTS, low = false) => tool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-v', 'info', ...reading, '-i', abs, '-an', '-sn', '-dn',
      '-vf', `select='${select}',showinfo,${drawn}`, '-frames:v', '1', '-fps_mode', 'passthrough', '-q:v', '5', '-update', '1', part], slots, true, low);
    /* the first picture, then each one at least a step (less a tenth: frames are not on the step) after the last */
    const apart = `isnan(prev_selected_t)+gte(t-prev_selected_t\\,${(plan.step * 0.9).toFixed(4)})`;
    /* each picture's moment as the filter says it passed (showinfo), in the grid's order */
    const said = (/** @type {Buffer} */ log) => [...log.toString().matchAll(/Parsed_showinfo[^\n]*pts_time:\s*(-?[\d.]+)/g)]
      .map((m) => Math.max(0, Math.round(Number(m[1]) * 1000))).slice(0, most);
    try {
      /** @type {number[]} */
      let times = [];
      if (keys) {
        /* its key frames alone, left unread by the file's reader (`-discard`): read so, the decoder says a key frame's
           moment wrong (up to a few frames off), so the moments are the file's own list of them, and the ones drawn
           are picked from that list by their place in it */
        const at = await keyTimes(abs).catch(() => /** @type {number[]} */ ([]));
        /** @type {number[]} */
        const picked = [];
        let last = -Infinity;
        at.forEach((t, i) => { if (picked.length < most && t - last >= plan.step * 0.9) { picked.push(i); last = t; } });
        const unread = ['-discard:v', 'nokey', '-skip_frame', 'nokey'];
        const these = picked.map((i) => `eq(n\\,${i})`).join('+');
        const ran = picked.length
          ? await (chip.length ? run([...chip, ...unread], these).catch(() => run(unread, these)) : run(unread, these)).then(() => true, () => false)
          : false;
        if (ran) times = picked.map((i) => Math.max(0, Math.round(at[i] * 1000)));
        /* a file whose key frames cannot be listed or read apart: decoded as they come, the others skipped, each at
           the moment the decoder says (right, read so) */
        else times = said(await run(['-skip_frame', 'nokey'], apart));
      } else {
        /* every frame: on the chip where that is faster; else without what a small picture does not show (the loop
           filter), nor the frames nothing is built on */
        const light = () => run(['-skip_loop_filter', 'all', '-skip_frame', 'noref'], apart, STRIP_SLOTS, true).catch(() => run([], apart, STRIP_SLOTS, true));
        times = said(await (chip.length ? run(chip, apart, STRIP_SLOTS, true).catch(light) : light()));
      }
      if (!times.length || !existsSync(part)) throw new MediaError(`${rel}: no picture could be read from it`, 422);
      await rename(part, picture);
      /** @type {StripIndex} */
      const index = { cols: STRIP_COLS, rows: Math.ceil(times.length / STRIP_COLS), w: plan.w, h: plan.h, times };
      await writeAtomic(list, Buffer.from(JSON.stringify(index)));
      return { index, picture };
    } finally {
      await rm(part, { force: true }).catch(() => {});
    }
  })().finally(() => stripping.delete(picture));
  stripping.set(picture, making);
  return making;
}

/** When each key frame of a video's picture is (s), in order: the file's own list, read without decoding anything. */
async function keyTimes(/** @type {string} */ abs) {
  const listed = await tool('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', abs]);
  /** @type {number[]} */
  const out = [];
  for (const line of listed.toString().split('\n')) {
    const [pts, flags] = line.split(',');
    const t = Number(pts);
    if (flags?.startsWith('K') && Number.isFinite(t)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The strip of video `rel` as it is now: the one of all it will ever be when that is made (or its key frames are it),
 * else the one of its key frames, made at once, a closer one begun behind it.
 * @param {string} root @param {string} rel @returns {Promise<Strip>}
 */
export async function strip(root, rel) {
  const { abs, key } = await source(root, rel);
  const dir = join(root, TOOL_DIR, 'cache', 'strips');
  const all = { picture: join(dir, `${key}.2.jpg`), list: join(dir, `${key}.2.json`) };
  const whole = await keptStrip(all.picture, all.list);
  if (whole) return { ...whole, part: 'all', closer: false };
  const facts = await probe(root, rel);
  const seconds = Number(facts.duration), width = Number(facts.width), height = Number(facts.height);
  if (!(seconds > 0 && width > 0 && height > 0)) throw new MediaError(`${rel} has no moving picture`, 422);
  const most = Math.max(1, Math.min(STRIP_MOST, Math.round(seconds / STRIP_STEP)));
  const even = (/** @type {number} */ n) => Math.max(2, Math.round(n / 2) * 2);
  const k = STRIP_SIDE / Math.max(width, height);
  const plan = { step: seconds / most, w: even(width * k), h: even(height * k), rows: Math.ceil((most + 1) / STRIP_COLS) };
  const gap = await keyGap(root, rel).catch(() => null);
  const chip = await chipDecoding(root, rel);
  /* its key frames are as close as the pictures wanted: they are all its strip will ever be */
  if (gap != null && gap <= plan.step * 2) return { ...await makeStrip(abs, rel, all.picture, all.list, plan, true, chip), part: 'all', closer: false };
  const keys = { picture: join(dir, `${key}.2k.jpg`), list: join(dir, `${key}.2k.json`) };
  const first = await keptStrip(keys.picture, keys.list) ?? await makeStrip(abs, rel, keys.picture, keys.list, plan, true, chip);
  /* a closer one, of every frame, where decoding the whole file is not too much; made behind, and kept for next time */
  const decoding = seconds * (Number(facts.fps) > 0 ? Number(facts.fps) : 30) * ((width * height) / (1920 * 1080));
  const closer = decoding <= STRIP_DECODE_MOST && !stripFailed.has(all.picture);
  if (closer) void makeStrip(abs, rel, all.picture, all.list, plan, false, chip).catch(() => { stripFailed.add(all.picture); });
  return { ...first, part: 'keys', closer };
}

/** Where a strip's picture is kept: of its key frames (`keys`), or all it will ever be; null when not made. */
export async function stripPicture(/** @type {string} */ root, /** @type {string} */ rel, /** @type {'keys' | 'all'} */ part) {
  const { key } = await source(root, rel);
  const picture = join(root, TOOL_DIR, 'cache', 'strips', `${key}.${part === 'keys' ? '2k' : '2'}.jpg`);
  return existsSync(picture) ? picture : null;
}

/** Peaks per second of waveform: enough to see a word, few enough to send for an hour of sound. */
const PEAKS_PER_SECOND = 40;
const RATE = 8000;

/**
 * A sound's waveform (or a video's sound): `{ duration (s), peaks }`, `peaks` between 0 and 1, PEAKS_PER_SECOND of them
 * a second.
 * @param {string} root @param {string} rel
 */
export async function waveform(root, rel) {
  const { abs, key } = await source(root, rel);
  const bytes = await cached(root, 'waves', `${key}.json`, async () => {
    /* read as ffmpeg writes it: a two-hour recording is never held in memory whole */
    const wave = await streamedPeaks(['-v', 'error', '-nostdin', '-i', abs, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-']);
    return Buffer.from(JSON.stringify(wave));
  });
  return JSON.parse(bytes.toString());
}

/** @type {Map<string, Promise<Buffer>>} */
const mixingWaves = new Map();

/**
 * A compound clip's waveform, mixed on the source timeline so every use can trim its own slice.
 * @param {string} root @param {import('../../src/host.mjs').FilmSound[]} sounds @param {number} duration
 */
export async function mixedWaveform(root, sounds, duration) {
  const clips = audioClips(root, 'film.html', sounds).filter((clip) => clip.at < duration && clip.volume > 0);
  if (!clips.length) return { duration, peaks: [] };
  const versions = await Promise.all([...new Set(clips.map((clip) => clip.file))].map(async (file) => {
    const info = await stat(file);
    return [file, info.size, info.mtimeMs];
  }));
  const key = createHash('sha256').update(JSON.stringify([duration, clips, versions])).digest('hex').slice(0, 24);
  const name = `mix-${key}.json`;
  const id = join(root, name);
  let pending = mixingWaves.get(id);
  if (!pending) {
    pending = cached(root, 'waves', name, async () => {
      const scratch = await mkdtemp(join(tmpdir(), 'openfilm-wave-'));
      const pcm = join(scratch, 'mix.pcm');
      try {
        await mix(clips, duration, pcm, ['-ac', '1', '-ar', String(RATE), '-f', 's16le']);
        const peaks = peakCounter();
        for await (const piece of createReadStream(pcm)) peaks.add(piece);
        return Buffer.from(JSON.stringify(peaks.done()));
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }).finally(() => mixingWaves.delete(id));
    mixingWaves.set(id, pending);
  }
  return JSON.parse((await pending).toString());
}

/** @type {Map<string, Promise<Buffer>>} */
const measuringMixes = new Map();

/**
 * How loud the film's sound is as mixed (EBU R128): `{ lufs, peak }` of the sounds the preview plays, added together
 * as a render adds them, before any loudness target or limiter (`lufs` null: silence). What the preview turns the
 * mix by so it is heard at the loudness the film is delivered at. Kept by the sounds and their files' versions.
 * @param {string} root @param {import('../../src/host.mjs').FilmSound[]} sounds @param {number} duration
 * @returns {Promise<{ lufs: number | null, peak: number | null }>}
 */
export async function mixLoudness(root, sounds, duration) {
  await knowAudioChannels(sounds.map((s) => { try { return fileOf(root, 'film.html', s.src); } catch { return ''; } }).filter(Boolean));
  const clips = audioClips(root, 'film.html', sounds).filter((clip) => clip.at < duration && clip.volume > 0);
  if (!clips.length) return { lufs: null, peak: null };
  const versions = await Promise.all([...new Set(clips.map((clip) => clip.file))].map(async (file) => {
    const info = await stat(file);
    return [file, info.size, info.mtimeMs];
  }));
  const name = `mix-${createHash('sha256').update(JSON.stringify([duration, clips, versions])).digest('hex').slice(0, 24)}.json`;
  const id = join(root, name);
  let pending = measuringMixes.get(id);
  if (!pending) {
    pending = cached(root, 'loudness', name, async () => {
      const scratch = await mkdtemp(join(tmpdir(), 'openfilm-mix-'));
      const wav = join(scratch, 'mix.wav');
      try {
        /* 32-bit float: sounds added together pass full scale, and are measured as they are */
        await mix(clips, duration, wav, ['-c:a', 'pcm_f32le']);
        const log = (await tool('ffmpeg', ['-nostdin', '-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], SLOTS, true)).toString();
        return Buffer.from(JSON.stringify(loudnessOf(log)));
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }).finally(() => measuringMixes.delete(id));
    measuringMixes.set(id, pending);
  }
  return JSON.parse((await pending).toString());
}

/**
 * ffmpeg's mono 16-bit samples at RATE, made into `{ duration (s), peaks }` as they come out of it (peakCounter), in
 * one of `slots`: any length of sound in the memory of one window of samples.
 * @param {string[]} args @param {Slots} [slots]
 * @returns {Promise<{ duration: number, peaks: number[] }>}
 */
async function streamedPeaks(args, slots = SLOTS) {
  if (slots.busy >= slots.size) await new Promise((r) => slots.waiting.push(() => r(undefined)));
  slots.busy++;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', ['-hide_banner', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const counter = peakCounter();
      let err = '';
      child.stdout.on('data', counter.add);
      child.stderr.on('data', (/** @type {Buffer} */ d) => { err = (err + d.toString()).slice(-4000); });
      child.on('error', (error) => reject(/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT'
        ? new MediaError('ffmpeg is not installed (macOS: brew install ffmpeg · Debian/Ubuntu: sudo apt install ffmpeg · Windows: winget install ffmpeg)', 501)
        : error));
      child.on('close', (code) => {
        if (code !== 0) return reject(new MediaError(err.trim().split('\n').pop() || `ffmpeg ended with ${code}`));
        resolve(counter.done());
      });
    });
  } finally {
    slots.busy--;
    slots.waiting.shift()?.();
  }
}

/**
 * Mono 16-bit samples at RATE, taken a piece at a time (`add`) → `{ duration (s), peaks }` (`done`): the loudest
 * sample of each 1/PEAKS_PER_SECOND s, between 0 and 1. A piece may end inside a sample: its byte waits for the next.
 */
export function peakCounter() {
  const per = RATE / PEAKS_PER_SECOND;
  /** @type {number[]} */
  const peaks = [];
  let max = 0;
  let inWindow = 0;
  let count = 0;
  /** @type {Buffer | null} */
  let half = null;
  const peak = () => peaks.push(Math.round((max / 32768) * 1000) / 1000);
  return {
    add: (/** @type {Buffer} */ piece) => {
      const bytes = half ? Buffer.concat([half, piece]) : piece;
      const n = bytes.length >> 1;
      half = bytes.length & 1 ? bytes.subarray(bytes.length - 1) : null;
      for (let i = 0; i < n; i++) {
        const v = Math.abs(bytes.readInt16LE(i * 2));
        if (v > max) max = v;
        if (++inWindow === per) { peak(); max = 0; inWindow = 0; }
      }
      count += n;
    },
    done: () => {
      if (inWindow) peak();
      return { duration: count / RATE, peaks };
    },
  };
}

/** Sound files small and compressed enough to be played as they are. */
const COMPACT = /\.(mp3|m4a|aac|ogg|oga|opus)$/i;
const COMPACT_BYTES = 16 << 20;
/** @type {Map<string, Promise<string | null>>} copies being made, by where they go */
const makingSound = new Map();

/**
 * The sound of a media file as the editor plays it, small: a compressed sound file of up to COMPACT_BYTES is its
 * own; any other (a video, a WAV, a long recording) gets a copy of its sound in `.film/cache/audio/`, AAC in .m4a:
 * the file's own AAC as it is, any other sound encoded at 128 kb/s, stereo at most. Made once per version of the
 * file; returns the path to play, or null when there is no sound in it. Exports mix from the files themselves.
 * @param {string} root @param {string} rel
 */
export async function soundOf(root, rel) {
  const { abs, key } = await source(root, rel);
  if (COMPACT.test(rel) && (await stat(abs)).size <= COMPACT_BYTES) return abs;
  const out = join(root, TOOL_DIR, 'cache', 'audio', `${key}.m4a`);
  if (existsSync(out)) return out;
  let made = makingSound.get(out);
  if (!made) {
    made = (async () => {
      if (!(await probe(root, rel)).audio) return null;
      const info = JSON.parse((await tool('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels', '-of', 'json', abs])).toString());
      const stream = info.streams?.[0] ?? {};
      const channels = Number(stream.channels) || 2;
      /* AAC is what a browser decodes everywhere: kept as it is when it is that already (no loss, no time) */
      const codec = stream.codec_name === 'aac' && channels <= 2 ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k', '-ac', String(Math.min(2, channels))];
      await mkdir(join(root, TOOL_DIR, 'cache', 'audio'), { recursive: true });
      const part = `${out}.part`;
      try {
        await tool('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', abs, '-map', '0:a:0', '-vn', '-sn', '-dn', ...codec, '-f', 'mp4', part], SOUND_SLOTS);
        await rename(part, out);
      } catch (e) {
        await rm(part, { force: true });
        throw e;
      }
      return out;
    })().finally(() => makingSound.delete(out));
    makingSound.set(out, made);
  }
  return made;
}

/**
 * The loudness of the part of a media file's sound from `from` to `to` (its own seconds; no `to`: to its end), as
 * EBU R128 measures it: `{ lufs, peak }`, the integrated loudness (LUFS) and the true peak (dBTP); `lufs` is null when
 * there is no sound in it. What the timeline's "Normalize loudness" sets a clip's volume by.
 * @param {string} root @param {string} rel @param {number} from @param {number} [to]
 * @returns {Promise<{ lufs: number | null, peak: number | null }>}
 */
export async function loudness(root, rel, from = 0, to) {
  if (!(Number.isFinite(from) && from >= 0) || (to != null && !(Number.isFinite(to) && to > from))) throw new MediaError('which part? from < to, in seconds', 400);
  const { abs, key } = await source(root, rel);
  const span = `${Math.round(from * 1000)}-${to == null ? 'end' : Math.round(to * 1000)}`;
  const bytes = await cached(root, 'loudness', `${key}-${span}.json`, async () => {
    if (!(await probe(root, rel)).audio) return Buffer.from(JSON.stringify({ lufs: null, peak: null }));
    const part = ['-ss', String(from), ...(to == null ? [] : ['-t', String(to - from)])];
    const log = (await tool('ffmpeg', ['-nostdin', '-hide_banner', '-nostats', ...part, '-i', abs, '-map', '0:a:0', '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], SLOTS, true)).toString();
    return Buffer.from(JSON.stringify(loudnessOf(log)));
  });
  return JSON.parse(bytes.toString());
}

/** ebur128's summary → `{ lufs, peak }`; silence (−70 LUFS, the gate) has no loudness. @param {string} log */
export function loudnessOf(log) {
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const number = (/** @type {RegExp} */ re) => {
    const m = re.exec(summary);
    const v = m ? Number(m[1]) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const lufs = number(/\bI:\s+(-?[\d.]+|-inf) LUFS/);
  return { lufs: lufs != null && lufs > -70 ? lufs : null, peak: number(/\bPeak:\s+(-?[\d.]+|-inf) dBFS/) };
}
