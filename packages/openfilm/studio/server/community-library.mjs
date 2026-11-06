// @ts-check
/** The approved community catalog and its content-addressed files. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const PREFIX = 'community/v1';
const MAX_CATALOG = 2 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const REFRESH = 60_000;
const TIMEOUT = 8000;
const HEX = /^[a-f0-9]{64}$/;
const ITEM = /^(sound|music|transition|effect)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const languages = ['en', 'zh-CN', 'ja', 'ko', 'es'];
const sha256 = (/** @type {Buffer} */ bytes) => createHash('sha256').update(bytes).digest('hex');
const endpoint = () => (process.env.OPENFILM_COMMUNITY_LIBRARY_URL ??
  `${(process.env.OPENFILM_LIBRARY_URL || 'https://openfilm.dev/library').replace(/\/+$/, '')}/${PREFIX}`).replace(/\/+$/, '');

/** @typedef {{ sha256: string, bytes: number }} Blob */
/** @typedef {{ group: string, id: string, cat: string, kind: 'sound' | 'page', name: Record<string,string>, durationMs: number, tags: string[], about: string, by: string, src?: string, place?: 'cut' }} Item */
/** @typedef {{ items: Item[], groups: Record<string, { id: string, name: Record<string,string> }[]>, files: Map<string, Blob>, bundles: Map<string,string[]> }} Catalog */
const empty = () => /** @type {Catalog} */ ({ items: [], groups: {}, files: new Map(), bundles: new Map() });
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
  for (const entry of json.items) {
    const { id, version, revision, name, about, tags, by, durationMs, files } = entry ?? {};
    const kind = typeof id === 'string' && id.length < 100 ? ITEM.exec(id)?.[1] : undefined;
    if (!kind || seen.has(id) || !Number.isSafeInteger(version) || version < 1 || !HEX.test(revision) ||
        typeof by !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(by) ||
        !name || !languages.every((lang) => typeof name[lang] === 'string' && name[lang].trim() && name[lang].length <= 60) ||
        typeof about !== 'string' || about.length > 300 ||
        !Array.isArray(tags) || tags.length > 12 || !tags.every((t) => typeof t === 'string' && /^[a-z0-9-]{1,40}$/.test(t)) ||
        !Number.isInteger(durationMs) || durationMs < 1 || durationMs > 3_600_000 ||
        !files || typeof files !== 'object') throw new Error('Invalid community item');
    seen.add(id);
    const base = `${PREFIX}/${id}-v${version}-${revision}`;
    const audio = kind === 'sound' || kind === 'music';
    const basename = `community-${id.replace('/', '-')}`;
    const sound = [`${basename}.m4a`, `${basename}.mp3`].find((key) => Object.hasOwn(files, key));
    const expected = audio ? [sound, `waves/${basename}.png`] : ['saved.json', 'files/overlay.html', 'poster.jpg', 'preview.mp4'];
    if (Object.keys(files).length !== expected.length) throw new Error('Invalid community files');
    for (const key of expected) {
      const file = key ? files[key] : null;
      if (!key || !file || typeof file.sha256 !== 'string' || !HEX.test(file.sha256) ||
          !Number.isInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_FILE) throw new Error('Invalid community file');
      result.files.set(`${base}/${key}`, file);
    }
    if (!audio) result.bundles.set(base, ['saved.json', 'files/overlay.html'].map((key) => `${base}/${key}`));
    result.groups[kind] ??= [{ id: 'community', name: { en: 'Community' } }];
    result.items.push({ id: audio ? `${base}/${sound}` : base, cat: kind, group: 'community', kind: audio ? 'sound' : 'page',
      name, about, tags, by, durationMs, ...(!audio ? { src: 'overlay.html', ...(kind === 'transition' ? { place: /** @type {const} */ ('cut') } : {}) } : {}) });
  }
  return result;
}

export const communityCatalog = () => catalog;
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
