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
import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioClips, mix } from '../../src/shared.mjs';
import { hasAlpha } from '../../src/seekable.mjs';
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
/** @type {Slots} */
const SLOTS = { size: 3, busy: 0, waiting: [] };
/** @type {Slots} */
const SOUND_SLOTS = { size: 2, busy: 0, waiting: [] };
/** Run `tool` with `args` when one of `slots` is free; resolves with its stdout (`stderr`: its stderr) as a Buffer. */
async function tool(/** @type {'ffmpeg' | 'ffprobe'} */ name, /** @type {string[]} */ args, slots = SLOTS, stderrOut = false) {
  if (slots.busy >= slots.size) await new Promise((r) => slots.waiting.push(() => r(undefined)));
  slots.busy++;
  try {
    return await new Promise((resolve, reject) => {
      execFile(name, args, { encoding: 'buffer', maxBuffer: 64 << 20, windowsHide: true }, (error, stdout, stderr) => {
        if (!error) return resolve(stderrOut ? stderr : stdout);
        if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
          return reject(new MediaError(`${name} is not installed (macOS: brew install ffmpeg · Debian/Ubuntu: sudo apt install ffmpeg · Windows: winget install ffmpeg)`, 501));
        }
        reject(new MediaError(stderr.toString().trim().split('\n').pop() || error.message));
      });
    });
  } finally {
    slots.busy--;
    slots.waiting.shift()?.();
  }
}

/**
 * Run ffmpeg with `args` when one of SLOTS is free, its stdout handed to `take` a piece at a time as it comes, never
 * held whole: a waveform's samples of a recording of hours would outgrow any buffer.
 * @param {string[]} args @param {(piece: Buffer) => void} take
 */
async function streamed(args, take) {
  if (SLOTS.busy >= SLOTS.size) await new Promise((r) => SLOTS.waiting.push(() => r(undefined)));
  SLOTS.busy++;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let said = '';
      child.stdout.on('data', take);
      child.stderr.on('data', (/** @type {Buffer} */ piece) => { said = (said + piece.toString()).slice(-4096); });
      child.on('error', (/** @type {NodeJS.ErrnoException} */ e) => reject(e.code === 'ENOENT'
        ? new MediaError('ffmpeg is not installed (macOS: brew install ffmpeg · Debian/Ubuntu: sudo apt install ffmpeg · Windows: winget install ffmpeg)', 501)
        : new MediaError(e.message)));
      child.on('close', (code) => (code === 0 ? resolve(undefined) : reject(new MediaError(said.trim().split('\n').pop() || `ffmpeg exited with ${code}`))));
    });
  } finally {
    SLOTS.busy--;
    SLOTS.waiting.shift()?.();
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
  /* `.4`: since the size is as shown (an older answer has a turned video's sides as stored), with the codec, its
     profile and level */
  const bytes = await cached(root, 'probe', `${key}.4.json`, async () => {
    const out = JSON.parse((await tool('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', abs])).toString());
    const video = out.streams?.find((/** @type {{ codec_type: string }} */ s) => s.codec_type === 'video');
    const audio = out.streams?.some((/** @type {{ codec_type: string }} */ s) => s.codec_type === 'audio');
    const [n, d] = String(video?.avg_frame_rate ?? '0/1').split('/').map(Number);
    const duration = Number(out.format?.duration);
    const turn = Number(video?.side_data_list?.find((/** @type {{ rotation?: number }} */ s) => s.rotation != null)?.rotation ?? video?.tags?.rotate ?? 0);
    const quarter = Math.abs(Math.round(turn / 90)) % 2 === 1;
    return Buffer.from(JSON.stringify({
      ...(Number.isFinite(duration) && duration > 0 && !/image|png|mjpeg/.test(String(out.format?.format_name)) ? { duration } : {}),
      ...(video ? (quarter ? { width: video.height, height: video.width } : { width: video.width, height: video.height }) : {}),
      ...(d && n ? { fps: Math.round((n / d) * 100) / 100 } : {}),
      ...(video?.codec_name ? { codec: String(video.codec_name), pixfmt: String(video.pix_fmt ?? '') } : {}),
      ...(video?.profile ? { profile: String(video.profile) } : {}),
      ...(Number(video?.level) > 0 ? { level: Number(video.level) } : {}),
      audio: Boolean(audio),
    }));
  });
  return JSON.parse(bytes.toString());
}

/**
 * A video's or a picture's poster: one frame a second in (or its first), 480 px wide, as JPEG; as PNG when it has an
 * alpha in its pixels (a ProRes 4444, a PNG), so what it leaves clear stays clear.
 */
export async function poster(/** @type {string} */ root, /** @type {string} */ rel) {
  const { abs, key } = await source(root, rel);
  const clear = hasAlpha({ pix_fmt: (await probe(root, rel).catch(() => null))?.pixfmt });
  const as = clear ? ['-pix_fmt', 'rgba', '-vcodec', 'png'] : ['-vcodec', 'mjpeg', '-q:v', '4'];
  return cached(root, 'posters', `${key}.${clear ? 'png' : 'jpg'}`, async () => {
    const grab = (/** @type {string} */ at) => tool('ffmpeg', ['-v', 'error', '-ss', at, '-i', abs, '-frames:v', '1', '-vf', 'scale=480:-2', '-f', 'image2pipe', ...as, '-']);
    const frame = await grab('1').catch(() => Buffer.alloc(0));
    return frame.length ? frame : grab('0');
  });
}

/** The frame of a video at `ms`, `width` px wide (the timeline's thumbnails). */
export async function frame(/** @type {string} */ root, /** @type {string} */ rel, /** @type {number} */ ms, /** @type {number} */ width) {
  if (!(Number.isFinite(ms) && ms >= 0)) throw new MediaError('which moment?', 400);
  const w = Math.max(32, Math.min(640, Math.round(width / 2) * 2 || 160));
  const { abs, key } = await source(root, rel);
  return cached(root, 'frames', `${key}-${Math.round(ms)}-${w}.jpg`, () => tool('ffmpeg', [
    '-v', 'error', '-ss', String(ms / 1000), '-i', abs, '-frames:v', '1', '-vf', `scale=${w}:-2`, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', '-',
  ]));
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
    const peaks = peakCounter();
    await streamed(['-v', 'error', '-i', abs, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], peaks.add);
    return Buffer.from(JSON.stringify(peaks.done()));
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
