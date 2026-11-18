// @ts-check
/** The approved community catalog and its content-addressed files. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const PREFIX = 'community/v1';
const MAX_CATALOG = 2 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
/** A media file (footage, a picture, a recording): larger than the library's other files */
const MAX_MEDIA = 50 * 1024 * 1024;
const MEDIA_EXT = { video: ['mp4', 'mov', 'webm'], image: ['jpg', 'jpeg', 'png', 'webp'], audio: ['m4a', 'mp3', 'wav'] };
const REFRESH = 60_000;
const TIMEOUT = 8000;
const HEX = /^[a-f0-9]{64}$/;
const ITEM = /^(sound|music|transition|effect|media|text|sticker|filter|template)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Any item id, of a kind this OpenFilm knows or of one added to the Community later (skipped, not refused) */
const ANY_ITEM = /^[a-z][a-z0-9-]{0,31}\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A text style's variables and a filter's grade, as the catalog carries them (the community's scripts/check.mjs) */
const TEXT_VAR = /^--[a-z][a-z0-9-]{0,39}$/;
/** How a sticker may move while shown (its page and its tile draw the same keyframes) */
const STICKER_IDLE = ['bounce', 'wiggle', 'pulse', 'float', 'spin', 'pop'];
const textVars = (/** @type {any} */ vars) => vars && typeof vars === 'object' && !Array.isArray(vars) && Object.keys(vars).length >= 1 && Object.keys(vars).length <= 24 &&
  Object.entries(vars).every(([key, value]) => TEXT_VAR.test(key) && typeof value === 'string' && value.length <= 200 && /^[\x20-\x7e]*$/.test(value) &&
    !/[<>{};\\@]/.test(value) && !/\b(?:url|image-set|image|src|expression|var)\s*\(/i.test(value));
const numbers = (/** @type {unknown} */ list, /** @type {number} */ n, /** @type {number} */ lo, /** @type {number} */ hi) => Array.isArray(list) && list.length === n && list.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi);
const gradeOk = (/** @type {any} */ g) => g && typeof g === 'object' && !Array.isArray(g) && Object.keys(g).length >= 1 &&
  Object.keys(g).every((k) => ['mix', 'sat', 'all', 'r', 'g', 'b'].includes(k)) && (g.mix === undefined || numbers(g.mix, 12, -4, 4)) &&
  (g.sat === undefined || (typeof g.sat === 'number' && g.sat >= 0 && g.sat <= 4)) && ['all', 'r', 'g', 'b'].every((k) => g[k] === undefined || numbers(g[k], 17, 0, 1));
const languages = ['en', 'zh-CN', 'ja', 'ko', 'es'];
const sha256 = (/** @type {Buffer} */ bytes) => createHash('sha256').update(bytes).digest('hex');
const endpoint = () => (process.env.OPENFILM_COMMUNITY_LIBRARY_URL ??
  `${(process.env.OPENFILM_LIBRARY_URL || 'https://openfilm.dev/library').replace(/\/+$/, '')}/${PREFIX}`).replace(/\/+$/, '');

/** @typedef {{ sha256: string, bytes: number }} Blob */
/** @typedef {{ group: string, id: string, cat: string, kind: 'sound' | 'page' | 'file' | 'textstyle' | 'look' | 'group', name: Record<string,string>, durationMs: number, tags: string[], about: string, by: string, src?: string, place?: 'cut', media?: 'video' | 'image' | 'audio', poster?: string, vars?: Record<string,string>, grade?: Record<string,unknown>, sample?: string, w?: number, h?: number, fit?: number, idle?: string, slots?: number }} Item */
/**
 * A pack: things of one maker's put together (a music pack of forty pieces), or one thing listed alone, as a pack of
 * its own (`lone`). Its id is `<maker>/<name>`; its things' `group` in the library is that id, so it is a group of
 * each category it has things in.
 * @typedef {{ id: string, name: Record<string,string>, about: string, by: string, license?: string, version: number, cover?: string, items: string[], lone?: true }} Pack
 */
/** @typedef {{ items: Item[], groups: Record<string, { id: string, name: Record<string,string>, by: string }[]>, packs: Pack[], files: Map<string, Blob>, bundles: Map<string,string[]> }} Catalog */
const empty = () => /** @type {Catalog} */ ({ items: [], groups: {}, packs: [], files: new Map(), bundles: new Map() });
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
let catalog = empty();
let last = '';
let checked = 0;
/** @type {Promise<void> | null} */
let refreshing = null;

/** @param {Response} res @param {number} limit */
async function bounded(res, limit) {
  if (!res.ok || !res.body || Number(res.headers.get('content-length')) > limit) throw new Error('Community library response unavailable');
  const chunks = [];
  let total = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) throw new Error('Community library response exceeds its size limit');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, total);
}

/** @param {any} json */
function decode(json) {
  if (json?.version !== 1 || !Array.isArray(json.items) || json.items.length > 1000) throw new Error('Invalid community catalog');
  const result = empty();
  const seen = new Set();
  /* the packs first: which pack each thing is in (one at most), the pack's things in its own order */
  if (json.packs !== undefined && (!Array.isArray(json.packs) || json.packs.length > 200)) throw new Error('Invalid community packs');
  /** @type {Map<string, Pack>} */
  const packOf = new Map();
  for (const entry of json.packs ?? []) {
    const { id, version, revision, name, about, by, license, items, cover } = entry ?? {};
    if (typeof id !== 'string' || id.length > 64 || !SLUG.test(id) || !Number.isSafeInteger(version) || version < 1 || !HEX.test(revision) ||
        typeof by !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(by) ||
        !name || !languages.every((lang) => typeof name[lang] === 'string' && name[lang].trim() && name[lang].length <= 60) ||
        typeof about !== 'string' || about.length > 300 || (license !== undefined && typeof license !== 'string') ||
        !Array.isArray(items) || !items.length || items.length > 200 || !items.every((x) => typeof x === 'string' && ANY_ITEM.test(x) && !packOf.has(x)) ||
        new Set(items).size !== items.length) throw new Error('Invalid community pack');
    const pack = /** @type {Pack} */ ({ id: `${by.toLowerCase()}/${id}`, name, about, by, version, items: [], ...(typeof license === 'string' ? { license } : {}) });
    if (result.packs.some((p) => p.id === pack.id)) throw new Error('Invalid community pack');
    if (cover !== undefined) {
      if (!cover || typeof cover.sha256 !== 'string' || !HEX.test(cover.sha256) || !Number.isInteger(cover.bytes) || cover.bytes < 1 || cover.bytes > MAX_FILE) throw new Error('Invalid community pack cover');
      pack.cover = `${PREFIX}/packs/${id}-v${version}-${revision}/cover.jpg`;
      result.files.set(pack.cover, cover);
    }
    for (const item of items) packOf.set(item, pack);
    result.packs.push(pack);
    /* a pack of only kinds a later OpenFilm knows has nothing here, and is left out with its things (below) */
  }
  for (const entry of json.items) {
    const { id, version, revision, name, about, tags, by, durationMs, files, media, vars, grade, w, h, idle, slots } = entry ?? {};
    const kind = typeof id === 'string' && id.length < 100 ? ITEM.exec(id)?.[1] : undefined;
    /* a kind added to the Community after this OpenFilm: skipped, so the rest of the catalog still shows */
    if (!kind && typeof id === 'string' && ANY_ITEM.test(id) && !seen.has(id)) { seen.add(id); continue; }
    /* a media file: footage, a picture or a recording, one file (a poster beside footage); a picture lasts nothing */
    const isMedia = kind === 'media';
    if (isMedia && !['video', 'image', 'audio'].includes(media)) throw new Error('Invalid community item');
    /* a text style is its variables, a filter its grade (neither lasts); a sticker its picture at its size */
    const timeless = kind === 'text' || kind === 'filter';
    if ((kind === 'text' && !textVars(vars)) || (kind === 'filter' && !gradeOk(grade)) ||
        (kind === 'sticker' && (![w, h].every((n) => Number.isInteger(n) && n >= 1 && n <= 1024) || (idle !== undefined && !STICKER_IDLE.includes(idle))))) throw new Error('Invalid community item');
    if (!kind || seen.has(id) || !Number.isSafeInteger(version) || version < 1 || !HEX.test(revision) ||
        typeof by !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(by) ||
        !name || !languages.every((lang) => typeof name[lang] === 'string' && name[lang].trim() && name[lang].length <= 60) ||
        typeof about !== 'string' || about.length > 300 ||
        !Array.isArray(tags) || tags.length > 12 || !tags.every((t) => typeof t === 'string' && /^[a-z0-9-]{1,40}$/.test(t)) ||
        !Number.isInteger(durationMs) || durationMs < ((isMedia && media === 'image') || timeless ? 0 : 1) || durationMs > 3_600_000 ||
        !files || typeof files !== 'object') throw new Error('Invalid community item');
    seen.add(id);
    const base = `${PREFIX}/${id}-v${version}-${revision}`;
    const audio = kind === 'sound' || kind === 'music';
    const basename = `community-${id.replace('/', '-')}`;
    const sound = [`${basename}.m4a`, `${basename}.mp3`].find((key) => Object.hasOwn(files, key));
    const mediaFile = isMedia ? MEDIA_EXT[/** @type {'video' | 'image' | 'audio'} */ (media)].map((ext) => `${basename}.${ext}`).find((key) => Object.hasOwn(files, key)) : undefined;
    /* a template: its group, poster and preview, and its locked pages and pictures under files/ */
    const parts = kind === 'template' && files && typeof files === 'object' ? Object.keys(files).filter((key) => /^files\/[a-z0-9][a-z0-9-]{0,30}\.(?:html|jpg)$/.test(key)) : [];
    if (kind === 'template' && (!Number.isInteger(slots) || slots < 0 || slots > 24 || parts.length > 29)) throw new Error('Invalid community item');
    const picture = kind === 'sticker' ? ['files/sticker.png', 'files/sticker.webp'].find((key) => Object.hasOwn(files, key)) : undefined;
    const expected = isMedia ? [mediaFile, ...(media === 'video' ? ['poster.jpg'] : [])]
      : audio ? [sound, `waves/${basename}.png`] : kind === 'text' ? [] : kind === 'filter' ? ['sample.jpg']
        : kind === 'sticker' ? ['saved.json', 'files/sticker.html', picture] : kind === 'template' ? ['saved.json', 'poster.jpg', 'preview.mp4', ...parts]
          : ['saved.json', 'files/overlay.html', 'poster.jpg', 'preview.mp4'];
    if (Object.keys(files).length !== expected.length) throw new Error('Invalid community files');
    for (const key of expected) {
      const file = key ? files[key] : null;
      const limit = isMedia && key === mediaFile ? MAX_MEDIA : MAX_FILE;
      if (!key || !file || typeof file.sha256 !== 'string' || !HEX.test(file.sha256) ||
          !Number.isInteger(file.bytes) || file.bytes < 1 || file.bytes > limit) throw new Error('Invalid community file');
      result.files.set(`${base}/${key}`, file);
    }
    if (kind === 'template') result.bundles.set(base, ['saved.json', ...parts].map((key) => `${base}/${key}`));
    else if (kind === 'sticker') result.bundles.set(base, ['saved.json', 'files/sticker.html', /** @type {string} */ (picture)].map((key) => `${base}/${key}`));
    else if (!audio && !timeless) result.bundles.set(base, ['saved.json', 'files/overlay.html'].map((key) => `${base}/${key}`));
    /* its pack, or one of its own when it is listed alone */
    let pack = packOf.get(id);
    if (pack && pack.by.toLowerCase() !== by.toLowerCase()) throw new Error('Invalid community pack');
    if (!pack) {
      pack = { id: `${by.toLowerCase()}/${id.replace('/', '-')}`, name, about, by, version, items: [], lone: true };
      if (result.packs.some((p) => p.id === pack?.id)) throw new Error('Invalid community pack');
      result.packs.push(pack);
    }
    const itemId = isMedia ? `${base}/${mediaFile}` : audio ? `${base}/${sound}` : base;
    pack.items.push(itemId);
    const groups = (result.groups[kind] ??= []);
    if (!groups.some((g) => g.id === pack.id)) groups.push({ id: pack.id, name: pack.name, by: pack.by });
    const common = { id: itemId, cat: kind, group: pack.id, name, about, tags, by, durationMs };
    result.items.push(isMedia
      ? { ...common, kind: 'file', media, ...(media === 'video' ? { poster: `${base}/poster.jpg` } : {}) }
      /* OpenFilm's text component draws a text style; a filter's picture is shown with its grade; a sticker is a page */
      : kind === 'text' ? { ...common, kind: 'textstyle', vars, w: 1600, h: 260, fit: 0.2 }
      : kind === 'filter' ? { ...common, kind: 'look', grade, sample: `${base}/sample.jpg` }
      : kind === 'template' ? { ...common, kind: 'group', slots, poster: `${base}/poster.jpg` }
      : kind === 'sticker' ? { ...common, kind: 'page', src: 'sticker.html', w, h, fit: 0.32, poster: `${base}/${picture}`, ...(idle ? { idle } : {}) }
      : { id: itemId, cat: kind, group: pack.id, kind: audio ? 'sound' : 'page',
        name, about, tags, by, durationMs, ...(!audio ? { src: 'overlay.html', ...(kind === 'transition' ? { place: /** @type {const} */ ('cut') } : {}) } : {}) });
  }
  /* a pack keeps only the things the catalog has (in its own order); one left with none is no pack */
  for (const pack of result.packs) {
    const listed = (json.packs ?? []).find((/** @type {any} */ p) => `${String(p?.by).toLowerCase()}/${p?.id}` === pack.id);
    if (listed) pack.items = listed.items.map((/** @type {string} */ x) => pack.items.find((it) => it.includes(`/${x}-v`))).filter(Boolean);
  }
  result.packs = result.packs.filter((p) => p.items.length);
  return result;
}

export const communityCatalog = () => catalog;
/** The catalog as read from its JSON (for the tests). */
export const decodeForTest = decode;
export const isCommunity = (/** @type {string} */ rel) => rel.startsWith('community/');

/** A failed refresh leaves the previously verified catalog in memory until a successful refresh. */
export function refreshCommunity() {
  if (process.env.NODE_TEST_CONTEXT && !process.env.OPENFILM_COMMUNITY_LIBRARY_URL) return Promise.resolve();
  if (refreshing) return refreshing;
  if (Date.now() - checked < REFRESH) return Promise.resolve();
  refreshing = (async () => {
    try {
      const res = await fetch(`${endpoint()}/catalog.json`, { signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store' });
      const bytes = await bounded(res, MAX_CATALOG);
      const digest = sha256(bytes);
      if (digest !== last) {
        catalog = decode(JSON.parse(bytes.toString('utf8')));
        last = digest;
      }
    } catch { /* The built-in catalog works offline. */ }
    finally { checked = Date.now(); refreshing = null; }
  })();
  return refreshing;
}

/** @param {string} root @param {string} rel */
function ready(root, rel) {
  const file = catalog.files.get(rel);
  const path = join(root, rel);
  return Boolean(file && existsSync(path) && statSync(path).isFile() && statSync(path).size === file.bytes);
}

/** @param {string} root @param {string} rel */
export function communityReady(root, rel) {
  const files = catalog.bundles.get(rel) ?? [rel];
  return files.every((file) => ready(root, file));
}

/** @type {Map<string, Promise<string | null>>} */
const loading = new Map();

/**
 * A sound or a piece of music of the Community heard before it is here: its bytes passed on to `res` as they arrive, so
 * it plays at once, then kept and checked once whole, as fetchCommunity keeps it. False, with nothing sent, when it is
 * here already, being fetched, not the catalog's, or not reachable: the caller serves it the usual way.
 * @param {string} root @param {string} rel @param {import('node:http').ServerResponse} res
 */
export async function streamCommunity(root, rel, res) {
  await refreshCommunity();
  const file = catalog.files.get(rel);
  const target = join(root, rel);
  if (!file || !/\.(m4a|mp3)$/.test(rel) || ready(root, rel) || loading.has(target)) return false;
  /** @type {(sent: boolean) => void} */
  let started = () => {};
  const began = new Promise((resolve) => { started = resolve; });
  const job = (async () => {
    const response = await fetch(`${endpoint()}/blobs/${file.sha256}`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body || Number(response.headers.get('content-length') || file.bytes) !== file.bytes) throw new Error('Community library response unavailable');
    res.writeHead(200, { 'content-type': rel.endsWith('.mp3') ? 'audio/mpeg' : 'audio/mp4', 'content-length': file.bytes, 'cache-control': 'no-store' });
    started(true);
    const chunks = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > file.bytes) throw new Error('Community library response exceeds its size limit');
      chunks.push(part.value);
      /* the listener may have gone (another sound picked): the file is still kept for the next time */
      if (!res.destroyed) res.write(part.value);
    }
    if (!res.destroyed) res.end();
    const bytes = Buffer.concat(chunks, total);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('Community file checksum mismatch');
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.part-${randomUUID()}`;
    try {
      await writeFile(temp, bytes, { flag: 'wx' });
      await rename(temp, target);
    } finally { await rm(temp, { force: true }); }
    return target;
  })().finally(() => loading.delete(target));
  loading.set(target, job);
  job.then(() => {}, () => { if (res.headersSent) res.destroy(); started(false); });
  return began;
}

/** Only approved paths are served, even if a withdrawn asset is still cached. @param {string} root @param {string} rel */
export async function fetchCommunity(root, rel) {
  await refreshCommunity();
  const files = catalog.bundles.get(rel) ?? [rel];
  try {
    for (const key of files) {
      const file = catalog.files.get(key);
      if (!file) return null;
      const target = join(root, key);
      if (ready(root, key) && sha256(readFileSync(target)) === file.sha256) continue;
      let job = loading.get(target);
      if (!job) {
        job = (async () => {
          const response = await fetch(`${endpoint()}/blobs/${file.sha256}`, { signal: AbortSignal.timeout(30_000) });
          const bytes = await bounded(response, file.bytes);
          if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('Community file checksum mismatch');
          await mkdir(dirname(target), { recursive: true });
          const temp = `${target}.part-${randomUUID()}`;
          try {
            await writeFile(temp, bytes, { flag: 'wx' });
            await rename(temp, target);
          } finally { await rm(temp, { force: true }); }
          return target;
        })().finally(() => loading.delete(target));
        loading.set(target, job);
      }
      await job;
    }
    return files.every((file) => catalog.files.has(file)) ? join(root, rel) : null;
  } catch { return null; }
}
