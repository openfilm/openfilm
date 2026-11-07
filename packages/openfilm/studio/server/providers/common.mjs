// @ts-check
/**
 * What the own-key providers share: calling a service and saying plainly what went wrong, the flags as values, where
 * results land, word timings, WAV and picture sizes, and subtitle translation's prompt and answer.
 */
import { execFile } from 'node:child_process';
import { basename, extname, join } from 'node:path';

/** @typedef {import('./contract.mjs').RunContext} RunContext */

/** A service's address: the public one, or `OPENFILM_<NAME>_URL` (a test server, a proxy). */
export const serviceUrl = (/** @type {string} */ name, /** @type {string} */ fallback) =>
  (process.env[`OPENFILM_${name}_URL`]?.trim() || fallback).replace(/\/+$/, '');

/**
 * `fetch` that answers only when the service said yes. Otherwise it throws a sentence naming the service and its
 * reason, with the key blanked out wherever the service echoed it.
 * @param {string} service @param {string} url @param {RequestInit} init @param {RunContext} ctx
 */
export async function call(service, url, init, ctx) {
  let res;
  try { res = await fetch(url, { ...init, signal: ctx.signal }); }
  catch (e) {
    if (ctx.signal.aborted) throw e;
    throw new Error(`${service} could not be reached (${/** @type {Error} */ (e).message}).`);
  }
  if (res.ok) return res;
  const text = await res.text().catch(() => '');
  if (KEY_LIMIT.test(text)) throw keyLimit(service);
  if (outOfBalance(res.status, text)) throw noBalance(service);
  /* with no key (a keyless provider) there is nothing to blank out */
  const reason = (ctx.key ? reasonOf(text).split(ctx.key).join('•••') : reasonOf(text)).slice(0, 500);
  if (PAID_PLAN.test(text)) throw new Error(`${service} needs a paid plan for this (${res.status})${reason ? `: ${reason}` : ''}`);
  if (res.status === 401 || res.status === 403) throw new Error(`${service} did not accept your key (${res.status}). Check it in Studio: Settings (the OpenFilm logo at the top left) → Services.`);
  throw new Error(`${service} answered ${res.status}${reason ? `: ${reason}` : ''}`);
}

/**
 * What the account's plan does not include, balance or not: ElevenLabs' free plan and its music, or a voice from its
 * library. Its documented codes are `subscription_required` and `feature_not_available` (403s); `paid_plan_required`
 * comes as a 402.
 */
const PAID_PLAN = /paid_plan_required|subscription_required|feature_not_available/i;

/**
 * Whether a service's error says its account has no balance left for this, as each says it: 402 Payment Required
 * (but a plan that does not include it); Tavily's 432 and 433; OpenAI's `insufficient_quota` (a 429); ElevenLabs'
 * `quota_exceeded` (a 401); fal's "Exhausted balance" (a 403, the account locked until it is topped up); Gemini's
 * depleted prepayment credits (a 429). A plain rate limit is not one.
 * @param {number} status @param {string} text the error's body
 */
export function outOfBalance(status, text) {
  if (PAID_PLAN.test(text)) return false;
  if (status === 402) return true;
  /* Tavily's plan and pay-as-you-go limits */
  if (status === 432 || status === 433) return true;
  return /insufficient_quota|quota_exceeded|insufficient_credits|insufficient[ _]balance|exhausted balance|credit balance is too low|credits are depleted/i.test(text);
}

/**
 * What a provider throws when its account has no balance left: `get` tells the person (with where to top it up) and
 * the agent, the same for every provider.
 * @param {string} service
 */
export const noBalance = (service) => Object.assign(new Error(`${service} doesn't have enough balance for this.`), { code: 'balance' });

/** A key that reached the spending limit set on the key itself (OpenRouter: "Key limit exceeded"), money left or not. */
const KEY_LIMIT = /key limit exceeded/i;

/**
 * What a provider throws when its key reached the spending limit set on it: like a balance used up (`code: 'balance'`,
 * nothing more runs until the person acts), but what to change is the key's limit (`limit`), not the balance.
 * @param {string} service
 */
export const keyLimit = (service) => Object.assign(new Error(`${service}: this key reached the spending limit set on it.`), { code: 'balance', limit: true });

/** The human part of a service's error body (each service nests it its own way). */
function reasonOf(/** @type {string} */ text) {
  let body;
  try { body = JSON.parse(text); } catch { return text.trim(); }
  const detail = body?.error?.message ?? body?.detail?.message ?? body?.detail ?? body?.message ?? body?.error;
  if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? d?.message ?? JSON.stringify(d)).join('; ');
  return typeof detail === 'string' ? detail : JSON.stringify(body);
}

/**
 * An address a service answered with, which its key goes to: only on the service's own origin (`base`), so a key is
 * never sent anywhere else. Throws a sentence otherwise.
 * @param {string} service @param {unknown} url @param {string} base
 */
export function ownAddress(service, url, base) {
  let at = null;
  try { at = new URL(String(url)); } catch { /* not an address */ }
  if (!at || at.origin !== new URL(base).origin) throw new Error(`${service} answered with an address that is not its own; your key was not sent there.`);
  return at.href;
}

/** Wait `ms`, or stop when the run is cancelled. */
export function sleep(/** @type {number} */ ms, /** @type {AbortSignal} */ signal) {
  return new Promise((done, fail) => {
    if (signal.aborted) { fail(signal.reason); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); done(undefined); }, ms);
    const stop = () => { clearTimeout(timer); fail(signal.reason); };
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** A flag as text ('' when not given). */
export const text = (/** @type {unknown} */ v) => typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
/** A flag as a number (null when not given or not one). */
export const number = (/** @type {unknown} */ v) => v === undefined || v === null || v === '' || typeof v === 'boolean' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
/** A flag that may be repeated, as a list. */
export const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(text).filter(Boolean);
export const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

/** A required flag, or a sentence saying it is missing. */
export function needed(/** @type {Record<string, unknown>} */ args, /** @type {string} */ flag) {
  const value = text(args[flag]);
  if (!value) throw new Error(`--${flag} is required.`);
  return value;
}

/** Where a result lands: `assets/<dir>/<out>.<ext>`; `--out` is a name, not a path. */
export function landing(/** @type {string} */ dir, /** @type {unknown} */ out, /** @type {string} */ ext) {
  const name = text(out).replace(/\.[a-z0-9]{2,4}$/i, '');
  if (!name || name === '.' || name === '..' || /[/\\\u0000-\u001f]/.test(name)) throw new Error('--out is a name (no folders, no extension), e.g. --out intro.');
  return `assets/${dir}/${name}.${ext}`;
}

/** The extension for a media type a service answered with. */
export function extOf(/** @type {string | null | undefined} */ mime, fallback = 'bin') {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim();
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' })[m] ?? fallback;
}

/** The media type of a project file, by its extension (what an upload says it is). */
export function mimeOf(/** @type {string} */ path) {
  const ext = extname(path).slice(1).toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
    aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime', mpeg: 'audio/mpeg', mpga: 'audio/mpeg' })[ext] ?? 'application/octet-stream';
}

/**
 * The speech of a project file as an upload part. What `read` gives may be a copy in another format than the file's
 * name says, so the format is told by the bytes themselves.
 */
export async function speechUpload(/** @type {string} */ path, /** @type {RunContext} */ ctx) {
  const bytes = await ctx.read(path);
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ext = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE' ? 'wav'
    : b.toString('ascii', 4, 8) === 'ftyp' ? (b.toString('ascii', 8, 11) === 'M4A' ? 'm4a' : 'mp4')
    : b.toString('ascii', 0, 4) === 'OggS' ? 'ogg'
    : b.toString('ascii', 0, 4) === 'fLaC' ? 'flac'
    : b.readUInt32BE(0) === 0x1a45dfa3 ? 'webm'
    : b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? 'mp3'
    : extname(path).slice(1).toLowerCase();
  const name = `${basename(path, extname(path))}.${ext}`;
  return { blob: new Blob([new Uint8Array(bytes)], { type: mimeOf(name) }), name, size: bytes.length };
}

/** A project file as a data: URI (services that take a picture inline). */
export const dataUri = async (/** @type {string} */ path, /** @type {RunContext} */ ctx) => `data:${mimeOf(path)};base64,${Buffer.from(await ctx.read(path)).toString('base64')}`;

/** Download what a service made (a file address it answered with). */
export async function download(/** @type {string} */ service, /** @type {string} */ url, /** @type {RunContext} */ ctx, /** @type {RequestInit} */ init = {}) {
  const res = await call(service, url, init, ctx);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') };
}

/**
 * Words with their times from per-character timings (speech services time each character). Spaces end a word; each
 * Chinese or Japanese character is a word of its own, as those scripts have no spaces; punctuation stays with the
 * word before it. Times are clamped to the file's length.
 * @param {string[]} chars @param {number[]} starts @param {number[]} ends @param {number | null} [dur]
 */
export function wordsFromCharacters(chars, starts, ends, dur = null) {
  /** @type {{ token: string, start: number, end: number }[]} */
  const words = [];
  /** @type {{ token: string, start: number, end: number } | null} */
  let word = null;
  const cut = (/** @type {number} */ t) => round(dur === null ? t : Math.min(t, dur));
  chars.forEach((ch, i) => {
    const start = cut(Number(starts[i]) || 0);
    const end = cut(Number(ends[i]) || start);
    if (/\s/.test(ch)) { word = null; return; }
    if (/\p{P}/u.test(ch) && !word && words.length) { words[words.length - 1].token += ch; words[words.length - 1].end = end; return; }
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) { words.push({ token: ch, start, end }); word = null; return; }
    if (word) { word.token += ch; word.end = end; }
    else words.push(word = { token: ch, start, end });
  });
  return words;
}

/**
 * Words with their times from per-word timings, as services that time words give them: a token with no letter or
 * digit (a space, punctuation) stays with the word before it. Times are clamped to the file's length and kept to the
 * millisecond.
 * @param {unknown[]} tokens @param {unknown[]} starts @param {unknown[]} ends @param {number | null} [dur]
 */
export function wordsFromTokens(tokens, starts, ends, dur = null) {
  /** @type {{ token: string, start: number, end: number }[]} */
  const words = [];
  const cut = (/** @type {number} */ t) => round(dur === null ? t : Math.min(t, dur));
  tokens.forEach((raw, i) => {
    const token = text(raw);
    if (!token) return;
    const start = cut(Number(starts[i]) || 0);
    const end = cut(Number(ends[i]) || start);
    const last = words.at(-1);
    if (!/[\p{L}\p{N}]/u.test(token)) { if (last) { last.token += token; last.end = Math.max(last.end, end); } return; }
    words.push({ token, start, end });
  });
  return words;
}

/** 16-bit mono PCM as a WAV file. */
export function wav(/** @type {Uint8Array} */ pcm, rate = 24000) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([head, pcm]));
}

/** How long a PCM WAV plays, in seconds, excluding trailing chunks and capped by the data that is there. */
export function wavSeconds(/** @type {Uint8Array} */ bytes) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF') return null;
  let rate = 0;
  for (let at = 12; at + 8 <= b.length;) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(at + 16);
    if (id === 'data') {
      const there = b.length - at - 8;
      return rate ? round((size && size < there ? size : there) / rate) : null;
    }
    at += 8 + size + (size & 1);
  }
  return null;
}

/** How long a constant-bitrate MP3 plays (what the services here deliver at the bitrate asked for). */
export const mp3Seconds = (/** @type {Uint8Array} */ bytes, kbps = 128) => round((bytes.length * 8) / (kbps * 1000));

export const round = (/** @type {number} */ s) => Math.round(s * 1000) / 1000;

/** A picture's pixel size from its header (PNG, JPEG, WebP), null when it is none of those. */
export function imageSize(/** @type {Uint8Array} */ bytes) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let at = 2; at + 9 < b.length;) {
      if (b[at] !== 0xff) { at += 1; continue; }
      const marker = b[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: b.readUInt16BE(at + 7), h: b.readUInt16BE(at + 5) };
      at += 2 + b.readUInt16BE(at + 2);
    }
  }
  if (b.length > 10 && b.toString('ascii', 0, 4) === 'GIF8') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  /* an SVG: its width and height, else its viewBox's */
  const head = b.toString('utf8', 0, Math.min(b.length, 4096));
  const svg = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (svg) {
    const attr = (/** @type {string} */ name) => Number(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i').exec(svg)?.[1]);
    const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
    const w = attr('width') || Number(box?.[1]);
    const h = attr('height') || Number(box?.[2]);
    if (w > 0 && h > 0) return { w: Math.round(w), h: Math.round(h) };
  }
  return null;
}

/**
 * An MP4's length and picture size from its boxes (moov: mvhd, and the first track with a picture size in its tkhd),
 * null when it has no movie header.
 * @returns {{ seconds: number, w: number | null, h: number | null } | null}
 */
export function mp4Facts(/** @type {Uint8Array} */ bytes) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** The boxes between two offsets: type, where the body starts, where the box ends. */
  const boxes = function* (/** @type {number} */ start, /** @type {number} */ end) {
    for (let at = start; at + 8 <= end;) {
      let size = b.readUInt32BE(at);
      let head = 8;
      if (size === 1 && at + 16 <= end) { size = Number(b.readBigUInt64BE(at + 8)); head = 16; }
      else if (size === 0) size = end - at;
      if (size < head || at + size > end) return;
      yield { type: b.toString('ascii', at + 4, at + 8), body: at + head, end: at + size };
      at += size;
    }
  };
  let seconds = null, w = null, h = null;
  for (const moov of boxes(0, b.length)) {
    if (moov.type !== 'moov') continue;
    for (const box of boxes(moov.body, moov.end)) {
      const v1 = b[box.body] === 1;
      if (box.type === 'mvhd' && box.body + (v1 ? 32 : 20) <= box.end) {
        const scale = b.readUInt32BE(box.body + (v1 ? 20 : 12));
        const length = v1 ? Number(b.readBigUInt64BE(box.body + 24)) : b.readUInt32BE(box.body + 16);
        if (scale) seconds = round(length / scale);
      }
      if (box.type !== 'trak' || w !== null) continue;
      for (const tkhd of boxes(box.body, box.end)) {
        const at = tkhd.body + (b[tkhd.body] === 1 ? 88 : 76);
        if (tkhd.type !== 'tkhd' || at + 8 > tkhd.end) continue;
        const tw = Math.round(b.readUInt32BE(at) / 65536), th = Math.round(b.readUInt32BE(at + 4) / 65536);
        if (tw && th) { w = tw; h = th; }
      }
    }
  }
  return seconds === null ? null : { seconds, w, h };
}

/**
 * How long a recording in the project lasts (ffprobe), in seconds, or null when it cannot be told.
 * @param {string} root the project @param {string} rel the file, in it
 * @returns {Promise<number | null>}
 */
export function mediaSeconds(root, rel) {
  return new Promise((done) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(root, rel)], { timeout: 15_000 }, (error, out) => {
      const seconds = Number(String(out).trim());
      done(!error && seconds > 0 ? seconds : null);
    });
  });
}

/** A picture service that makes PNGs alone refuses a GIF or an SVG, and says where they are made. */
export function pngOnly(/** @type {Record<string, unknown>} */ args, /** @type {string} */ name) {
  const format = text(args.format);
  if (format && format !== 'png') throw new Error(`--format ${format}: ${name} makes still pictures. A GIF or an SVG is GPT Image 2.6's: use OpenAI for it.`);
}

/* GPT Image makes a GIF's frames on one sheet: by how many there are, the grids it lays them out on (columns × rows) */
const GIF_GRIDS = (/** @type {number} */ n) => (n <= 8 ? [[4, 2], [2, 4]] : n === 9 ? [[3, 3]] : n <= 12 ? [[4, 3], [3, 4], [4, 4]] : [[4, 4]]);

/**
 * The largest frame of a GIF of `frames` frames in `ratio`'s shape, no larger than `cap` (the size asked), that GPT Image
 * makes: each side a multiple of 16, and the sheet of all of them at most 3840 px on its longest side, of 655,360 to
 * 8,294,400 pixels. null when none fits.
 * @param {string} ratio @param {number} frames @param {{ width: number, height: number }} cap
 */
export function gifFrameSize(ratio, frames, cap) {
  const shape = RATIO_SIZE[ratio];
  const a = shape.width / shape.height;
  /** @type {{ width: number, height: number } | null} */
  let best = null;
  for (const [cols, rows] of GIF_GRIDS(frames)) {
    const h = Math.min(3840 / rows, 3840 / (cols * a), Math.sqrt(8_294_400 / (cols * rows * a)), cap.height, cap.width / a);
    const height = Math.floor(h / 16) * 16;
    const width = Math.floor((height * a) / 16) * 16;
    if (cols * rows * width * height < 655_360) continue;
    if (!best || width * height > best.width * best.height) best = { width, height };
  }
  return best;
}

/** Pixel sizes for `--ratio` at about 1.3 megapixels, each side a multiple of 16 (what image services accept). */
export const RATIO_SIZE = /** @type {Record<string, { width: number, height: number }>} */ ({
  '16:9': { width: 1536, height: 864 }, '9:16': { width: 864, height: 1536 }, '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1344, height: 1008 }, '3:4': { width: 1008, height: 1344 }, '3:2': { width: 1536, height: 1024 }, '2:3': { width: 1024, height: 1536 },
  '21:9': { width: 1680, height: 720 },
});

/** The pixels a picture of each `--size` has, about: 1K a square of 1024, 2K of 2048, 4K as many as 3840 × 2160. */
const SIZE_PIXELS = /** @type {Record<string, number>} */ ({ '2k': 2048 * 2048, '4k': 3840 * 2160 });

/**
 * A picture's width and height for `--ratio` and `--size` (1k, 2k, 4k), in multiples of 16 as image models take them:
 * 1K as RATIO_SIZE has it, 2K and 4K that many pixels in that shape, no side past 3840.
 * @param {string} ratio @param {string} size
 */
export function pictureSize(ratio, size) {
  const one = RATIO_SIZE[ratio];
  const pixels = SIZE_PIXELS[size];
  if (!one || !pixels) return one ?? null;
  /* the longer side at most 3840, the other in proportion */
  const scale = Math.min(Math.sqrt(pixels / (one.width * one.height)), 3840 / Math.max(one.width, one.height));
  const side = (/** @type {number} */ v) => Math.floor((v * scale) / 16) * 16;
  return { width: side(one.width), height: side(one.height) };
}

/** The index row and receipt of one picture made from a prompt. */
export function madePicture(/** @type {{ path: string, bytes: Uint8Array, prompt: string, provider: string, model: string, notes: string[] }} */ p) {
  const size = imageSize(p.bytes);
  /* PNG color types 4 and 6 carry an alpha channel */
  const alpha = p.path.endsWith('.png') && (p.bytes[25] === 4 || p.bytes[25] === 6);
  return {
    files: [{ path: p.path, bytes: p.bytes }],
    index: [{ src: p.path, kind: 'image', ...(size ? { w: size.w, h: size.h } : {}), from: { mode: 'generate', prompt: p.prompt, provider: p.provider, model: p.model } }],
    receipt: { provider: p.provider, model: p.model, images: [{ src: p.path, width: size?.w ?? null, height: size?.h ?? null, alpha }], ...notes(p.notes) },
  };
}

/**
 * Pictures found on the web, downloaded and landed as `assets/image/<out>.<ext>`, `<out>_2.<ext>`, ...: as many as were
 * asked, from the hits in order (one that cannot be downloaded is skipped). Each says who made it and its page, the
 * credit a film gives it. Throws a sentence when none landed.
 * @param {{ service: string, provider: string, args: Record<string, unknown>, hits: { url: string, page: string, credit: string }[], notes: string[] }} p
 * @param {RunContext} ctx
 */
export async function foundPictures({ service, provider, args, hits, notes: said }, ctx) {
  const prompt = needed(args, 'prompt');
  const asked = Math.round(number(args.n) ?? 1);
  /** @type {{ path: string, bytes: Uint8Array }[]} */
  const files = [];
  const index = [];
  const images = [];
  for (const hit of hits) {
    if (files.length >= asked) break;
    const got = await download(service, hit.url, ctx).catch((e) => { if (ctx.signal.aborted) throw e; return null; });
    if (!got) continue;
    const name = files.length ? `${text(args.out).replace(/\.[a-z0-9]{2,4}$/i, '')}_${files.length + 1}` : args.out;
    const path = landing('image', name, extOf(got.type, 'jpg'));
    const size = imageSize(got.bytes);
    files.push({ path, bytes: got.bytes });
    index.push({ src: path, kind: 'image', ...(size ? { w: size.w, h: size.h } : {}), from: { mode: 'search', prompt, provider, sourceUrl: hit.page, credit: hit.credit } });
    images.push({ src: path, width: size?.w ?? null, height: size?.h ?? null, source: 'web', alpha: false, credit: hit.credit, page: hit.page });
  }
  if (!files.length) throw new Error(`${service} found no pictures for "${prompt}". Try other words.`);
  return {
    files,
    index,
    receipt: { provider, images, asked, landed: files.length, ...notes(said) },
  };
}

/**
 * Clips found on the web, downloaded and landed as `assets/video/<out>.mp4`, `<out>_2.mp4`, ...: as many as were asked,
 * from the hits in order (one that cannot be downloaded is skipped), each with its length and size as the search said,
 * and who made it and its page: the credit a film gives it. Throws a sentence when none landed.
 * @param {{ service: string, provider: string, args: Record<string, unknown>, hits: { url: string, page: string, credit: string, dur: number | null, w: number | null, h: number | null }[], notes: string[] }} p
 * @param {RunContext} ctx
 */
export async function foundClips({ service, provider, args, hits, notes: said }, ctx) {
  const prompt = needed(args, 'prompt');
  const asked = Math.round(number(args.n) ?? 1);
  /** @type {{ path: string, bytes: Uint8Array }[]} */
  const files = [];
  const index = [];
  const clips = [];
  for (const hit of hits) {
    if (files.length >= asked) break;
    const got = await download(service, hit.url, ctx).catch((e) => { if (ctx.signal.aborted) throw e; return null; });
    if (!got) continue;
    const name = files.length ? `${text(args.out).replace(/\.[a-z0-9]{2,4}$/i, '')}_${files.length + 1}` : args.out;
    const path = landing('video', name, extOf(got.type, 'mp4'));
    files.push({ path, bytes: got.bytes });
    const facts = { ...(hit.dur ? { dur: hit.dur } : {}), ...(hit.w && hit.h ? { w: hit.w, h: hit.h } : {}) };
    index.push({ src: path, kind: 'video', ...facts, from: { mode: 'search', prompt, provider, sourceUrl: hit.page, credit: hit.credit } });
    clips.push({ src: path, ...facts, source: 'web', credit: hit.credit, page: hit.page });
  }
  if (!files.length) throw new Error(`${service} found no clips for "${prompt}". Try other words.`);
  return { files, index, receipt: { provider, clips, asked, landed: files.length, ...notes(said) } };
}

/** The receipt's `notes` (flags a service could not honor), only when there are some. */
/**
 * The model a run uses: the one the person chose (`ctx.model`) when the provider has it for `verb`, else its first.
 * @param {Partial<Record<string, { id: string, name: string }[]>>} models @param {string} verb @param {RunContext} ctx
 */
export function modelOf(models, verb, ctx) {
  const all = models[verb] ?? [];
  const model = all.find((m) => m.id === ctx.model) ?? all[0];
  if (!model) throw new Error(`no model for ${verb}`);
  return model.id;
}

export const notes = (/** @type {string[]} */ list) => list.length ? { notes: list } : {};

/** What a run tells the person about the bill. */
export const billedBy = (/** @type {string} */ service) => ({ note: `billed by ${service} to your key` });

/**
 * Subtitle translation's instruction: one request for all the lines (strings, or `{ text }`), the answer as
 * `{ "lines": [...] }` with exactly one translated line per line given, in order (the lines keep their own times).
 */
export function translationAsk(/** @type {unknown} */ lines, /** @type {unknown} */ language) {
  const texts = (Array.isArray(lines) ? lines : []).map((l) => text(typeof l === 'object' && l ? /** @type {{ text?: unknown }} */ (l).text : l));
  const target = text(language);
  if (!target) throw new Error('translate needs a language.');
  if (!texts.length) throw new Error('translate needs lines.');
  return {
    count: texts.length,
    system: `You translate video subtitles into the language with the code "${target}". Answer with JSON only, no other text: `
      + `{"lines": [string, ...]} holding exactly ${texts.length} strings, the i-th being the translation of the i-th line given. `
      + 'Keep each line\'s meaning in its own line: never merge, split, drop or reorder lines. Keep names as they are. Add no notes.',
    user: JSON.stringify({ language: target, lines: texts }),
  };
}

/** The translated lines from a model's answer, one string per line asked. Throws when it does not fit. */
export function translatedLines(/** @type {string} */ answer, /** @type {number} */ count) {
  let body;
  try { body = JSON.parse(answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new Error('The translation did not come back as JSON.'); }
  const out = body?.lines;
  if (!Array.isArray(out) || out.length !== count || out.some((l) => typeof l !== 'string')) {
    throw new Error(`The translation came back with ${Array.isArray(out) ? out.length : 'no'} lines for ${count}.`);
  }
  return out.map((l) => l.trim());
}
