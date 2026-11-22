// @ts-check
/**
 * Sharing the person's own media with the Community, from Studio, with their OpenFilm account and no git.
 *
 * The person picks a name for themselves in the Community once (their profile). Then a file of their library, or
 * several as a pack, is shared in one go: this checks each file against what the Community takes, draws a video's
 * poster, and hands the lot to OpenFilm's service, which keeps the files private until the Community's reviewers have
 * looked at them, under the person's name; `submissions` says how that went.
 *
 *   communityProfile / saveCommunityProfile   the person's name and page in the Community (their account's)
 *   publicProfile(name)                       anyone's page, for the author's page in the Community window
 *   shareable(library, path)                  a library file as it would be shared, or why it cannot be;
 *                                             shareables(library, paths) for several, a folder standing for its files
 *   startShare(library, request)              shares in the background; shareJob(id) says how far it is
 *   mySubmissions()                           what the person shared, and how each review went
 *   withdrawSubmission(id)                    takes back one of them
 *
 * And a film, a whole project others open as their own: the person picks what of it goes. Its edit always (film.html
 * and every file it plays, with how its subtitles look and the timeline's settings); its canvas when they say so (the
 * boards, with the notes and prompts on them, and the files they show); the rest of its media when they say so. Never
 * its history, its conversations, its logs or its cache.
 *
 *   filmShareable(project)                    what each part holds, and what stands in the way
 *   startFilmShare(project, request, how)     shares it in the background, as startShare does
 *
 * Only the files named are sent, and only once the person said they are theirs to share. The account's key goes to
 * OpenFilm's service alone; the upload addresses it answers with take one file each and are not kept.
 */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { clipKind } from '../../src/film-doc.mjs';
import { filmClosure, folderView } from './closure.mjs';
import { probe } from './derived.mjs';
import { projectFiles } from './exports.mjs';
import { readable } from './files.mjs';
import { HttpError } from './http.mjs';
import { providerKey, readSettings } from './keys.mjs';
import { idleSignal } from './media-transfer.mjs';
import { serviceUrl } from './providers/common.mjs';
import { listProviders } from './providers/index.mjs';
import { LIBRARY, libraryRel } from './saved.mjs';

const MIB = 1024 * 1024;
/** What the Community takes as media (its assets/CONTRIBUTING.md): the kinds, their files, sizes and lengths. */
export const SHARE_MEDIA = /** @type {const} */ ({
  video: { exts: ['mp4', 'mov', 'webm'], maxBytes: 50 * MIB, maxMs: 60_000, codecs: ['h264', 'hevc', 'vp9', 'av1'], maxWidth: 3840, maxHeight: 2160 },
  image: { exts: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 10 * MIB, maxMs: 0, maxWidth: 8192, maxHeight: 8192 },
  audio: { exts: ['m4a', 'mp3', 'wav'], maxBytes: 20 * MIB, maxMs: 600_000 },
});
/** A poster or a cover: a JPEG of at most this, and no larger than this picture. */
const PICTURE_MAX_BYTES = MIB;
const PICTURE_WIDTHS = [1280, 960, 640];
/** The items one share may hold (the service's own limit). */
export const SHARE_MAX_ITEMS = 40;
const LANGUAGES = ['en', 'zh-CN', 'ja', 'ko', 'es'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const api = () => serviceUrl('API', 'https://openfilm.dev');

/** @typedef {{ fetch?: typeof fetch }} Options */
/** @typedef {{ id?: number, name: string, displayName: string, bio: string, avatar: string | null, since: string }} Profile `id`: the account's UID */
/** @typedef {{ id: string, state: 'uploading' | 'reviewing' | 'approved' | 'declined' | 'failed' | 'withdrawing' | 'withdrawn', title: string, items: { id: string, title: string, version: number }[], pack?: { id: string, title: string }, film?: { id: string, title: string, version: number }, review?: string, note?: string, createdAt: string, updatedAt: string }} Submission */
/**
 * @typedef {{ path: string, media: 'video' | 'image' | 'audio' | null, ext: string, bytes: number, durationMs: number, name: string, title: string,
 *   problem?: 'not-media' | 'format' | 'too-big' | 'too-long' | 'codec' | 'too-large' }} Shareable
 */

/** The account's key, or null when no one is signed in. */
async function accountKey() {
  const provider = listProviders().find((p) => p.id === 'openfilm');
  return provider ? providerKey(provider, await readSettings())?.key ?? null : null;
}

const signInFirst = () => new HttpError(409, 'Sign in to your OpenFilm account first: what you share is published under your name.', { code: 'sign-in' });

/**
 * One call to OpenFilm's service. Its refusals come back as they were said, with their code (`name_taken`,
 * `profile_required`, `not_yours`, `in_progress`, `rate_limited`, `not_configured` …) for the editor's own words.
 * @param {string} method @param {string} path @param {{ key?: string | null, body?: unknown, fetch?: typeof fetch, timeoutMs?: number }} [o]
 */
async function ask(method, path, { key, body, fetch: get = fetch, timeoutMs = 30_000 } = {}) {
  let res;
  try {
    res = await get(`${api()}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new HttpError(502, 'OpenFilm\'s service could not be reached. Check your connection and try again.', { code: 'network' });
  }
  const answer = await res.json().catch(() => null);
  if (res.ok) return answer;
  if (res.status === 401) throw new HttpError(409, 'Your OpenFilm sign-in is no longer valid. Sign in again.', { code: 'sign-in' });
  const { error, message, ...more } = answer && typeof answer === 'object' ? answer : {};
  throw new HttpError(res.status >= 500 ? 502 : res.status, typeof message === 'string' ? message : `OpenFilm's service answered ${res.status}.`, { ...more, code: typeof error === 'string' ? error : 'failed' });
}

/**
 * The person's name and page in the Community. Not signed in: `{ signedIn: false, profile: null }`. Signed in: `id`,
 * their account's UID (it has one before any name); with no name yet, `profile` null and `suggested`, a free name they
 * could take.
 * @param {Options} [o] @returns {Promise<{ signedIn: boolean, profile: Profile | null, id?: number, suggested?: string }>}
 */
export async function communityProfile({ fetch: get } = {}) {
  const key = await accountKey();
  if (!key) return { signedIn: false, profile: null };
  const { profile, id, suggested } = await ask('GET', '/v1/community/profile', { key, fetch: get });
  return { signedIn: true, profile: profile ?? null, ...(Number.isSafeInteger(id) ? { id } : {}), ...(typeof suggested === 'string' ? { suggested } : {}) };
}

/** Takes the name (the first time) and writes the page's words. @param {unknown} body @param {Options} [o] */
export async function saveCommunityProfile(body, { fetch: get } = {}) {
  const key = await accountKey();
  if (!key) throw signInFirst();
  const { name, displayName, bio, avatar } = /** @type {Record<string, unknown>} */ (body && typeof body === 'object' ? body : {});
  const { profile } = await ask('PUT', '/v1/community/profile', { key, fetch: get, body: { name, displayName, bio, avatar } });
  publicProfiles.delete(profile?.name);
  return { signedIn: true, profile: /** @type {Profile} */ (profile) };
}

/** @type {Map<string, { at: number, profile: Profile | null }>} */
const publicProfiles = new Map();
const PROFILE_MAX_AGE_MS = 5 * 60_000;

/**
 * Anyone's page in the Community, or null when no account has that name (a GitHub author's name has none). Kept five
 * minutes; a service that cannot be reached answers null and is asked again.
 * @param {string} name @param {Options & { now?: number }} [o] @returns {Promise<Profile | null>}
 */
export async function publicProfile(name, { fetch: get, now = Date.now() } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(name)) return null;
  const kept = publicProfiles.get(name);
  if (kept && now - kept.at < PROFILE_MAX_AGE_MS) return kept.profile;
  try {
    const { profile } = await ask('GET', `/v1/community/profiles/${name}`, { fetch: get, timeoutMs: 5000 });
    publicProfiles.set(name, { at: now, profile: profile ?? null });
    return profile ?? null;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) { publicProfiles.set(name, { at: now, profile: null }); return null; }
    return null;
  }
}

/** A name for an item from its file's: what of it is Latin letters and digits, as a slug; '' when none of it is. */
export function slugOf(/** @type {string} */ words) {
  return words.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

/**
 * A file of the library as it would be shared: what kind of media it is, its size and length, and a name and a title
 * from its file's. `problem` says why the Community would not take it as it is.
 * @param {string} library the library's folder @param {string} path its `saved/…` path @returns {Promise<Shareable>}
 */
export async function shareable(library, path) {
  const rel = libraryRel(path);
  const ext = extname(rel).slice(1).toLowerCase();
  const title = basename(rel, extname(rel)).replace(/[_-]+/g, ' ').trim().slice(0, 60) || 'Untitled';
  /** @type {Shareable} */
  const out = { path, media: null, ext, bytes: 0, durationMs: 0, name: slugOf(basename(rel, extname(rel))), title };
  const info = rel ? await stat(readable(library, rel)).catch(() => null) : null;
  const kind = clipKind(rel);
  const media = kind === 'video' ? 'video' : kind === 'still' ? 'image' : kind === 'sound' ? 'audio' : null;
  /* a folder is a bundle (a clip with what it loads) or a place: neither is a plain media file */
  if (!info?.isFile() || !media) return { ...out, problem: 'not-media' };
  const rule = SHARE_MEDIA[media];
  out.media = media;
  out.bytes = info.size;
  if (!(/** @type {readonly string[]} */ (rule.exts)).includes(ext)) return { ...out, problem: 'format' };
  if (info.size > rule.maxBytes) return { ...out, problem: 'too-big' };
  const facts = await probe(library, rel).catch(() => null);
  if (!facts) return { ...out, problem: 'format' };
  out.durationMs = media === 'image' ? 0 : Math.round((facts.duration ?? 0) * 1000);
  if (media !== 'image' && (out.durationMs < 1 || out.durationMs > rule.maxMs)) return { ...out, problem: out.durationMs < 1 ? 'format' : 'too-long' };
  if (media === 'video' && !(/** @type {readonly string[]} */ (SHARE_MEDIA.video.codecs)).includes(String(facts.codec))) return { ...out, problem: 'codec' };
  if ('maxWidth' in rule && ((facts.width ?? 0) > rule.maxWidth || (facts.height ?? 0) > rule.maxHeight)) return { ...out, problem: 'too-large' };
  return out;
}

/**
 * What a share was asked for, as it would be shared: each file, and for a folder of the library the media files in it
 * (not its folders, nor the clips saved in it). `folder`: the one folder asked for, a pack's name to start from.
 * @param {string} library @param {string[]} paths @returns {Promise<{ items: Shareable[], folder?: string }>}
 */
export async function shareables(library, paths) {
  /** @type {Shareable[]} */
  const items = [];
  let folder;
  for (const path of paths) {
    const rel = libraryRel(path);
    const abs = rel ? readable(library, rel) : library;
    const isFolder = (await stat(abs).catch(() => null))?.isDirectory() && !(await stat(join(abs, 'saved.json')).catch(() => null));
    if (!isFolder) { items.push(await shareable(library, path)); continue; }
    if (paths.length === 1 && rel) folder = basename(rel);
    for (const name of (await readdir(abs)).sort()) {
      if (name.startsWith('.')) continue;
      const one = await shareable(library, `${path}/${name}`);
      if (one.problem !== 'not-media') items.push(one);
    }
  }
  return { items: items.slice(0, 200), ...(folder ? { folder } : {}) };
}

/** A JPEG of a video's frame a second in (or its first), or of a picture, small enough to be a poster or a cover. */
async function pictureOf(/** @type {string} */ abs, /** @type {'video' | 'image'} */ media, /** @type {number} */ durationMs) {
  for (const width of PICTURE_WIDTHS) {
    for (const quality of ['3', '6']) {
      const args = ['-v', 'error', ...(media === 'video' ? ['-ss', durationMs > 2000 ? '1' : '0'] : []), '-i', abs, '-frames:v', '1',
        '-vf', `scale='min(${width},iw)':-2`, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-pix_fmt', 'yuvj420p', '-q:v', quality, '-'];
      const jpeg = await new Promise((resolve, reject) => {
        execFile('ffmpeg', args, { encoding: 'buffer', maxBuffer: 16 * MIB, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
      }).catch(() => null);
      if (jpeg instanceof Buffer && jpeg.length > 0 && jpeg.length <= PICTURE_MAX_BYTES) return jpeg;
    }
  }
  throw new HttpError(422, 'No poster could be drawn from this file.', { code: 'poster' });
}

const sha256Of = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');
/** A file's SHA-256, read through once, never held whole. */
async function sha256OfFile(/** @type {string} */ abs) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(abs)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * @typedef {{ state: 'preparing' | 'uploading' | 'handing' | 'done' | 'failed', sent: number, total: number, submission?: Submission, error?: string, code?: string, item?: string }} ShareJob
 */
/** @type {Map<string, ShareJob & { at: number }>} */
const jobs = new Map();
const JOB_KEPT_MS = 60 * 60_000;

/** How far a share is; null for one this Studio does not know (it was restarted since: the submissions say the rest). */
export function shareJob(/** @type {string} */ id) {
  const job = jobs.get(id);
  if (!job) return null;
  const { at: _at, ...shown } = job;
  return shown;
}

const text = (/** @type {unknown} */ v, /** @type {number} */ min, /** @type {number} */ max) => (typeof v === 'string' && v.trim().length >= min && v.trim().length <= max ? v.trim() : null);
const wrong = (/** @type {string} */ message) => new HttpError(400, message, { code: 'invalid' });

/** What the editor asked to share, read strictly: anything not as it should be is said, nothing is guessed. */
function readRequest(/** @type {unknown} */ raw) {
  const r = /** @type {Record<string, any>} */ (raw && typeof raw === 'object' ? raw : {});
  if (r.agreed !== true) throw wrong('Say first that this work is yours to share.');
  if (!LANGUAGES.includes(r.language)) throw wrong('language: the language the words are written in');
  if (!Array.isArray(r.items) || !r.items.length || r.items.length > SHARE_MAX_ITEMS) throw wrong(`Share 1 to ${SHARE_MAX_ITEMS} files at a time.`);
  const names = new Set();
  const items = r.items.map((/** @type {Record<string, any>} */ it) => {
    const title = text(it?.title, 1, 60), about = text(it?.about, 10, 300);
    if (typeof it?.path !== 'string' || !it.path.startsWith(`${LIBRARY}/`)) throw wrong('path: a file of your library');
    if (typeof it.name !== 'string' || !SLUG.test(it.name) || it.name.length > 40) throw wrong('Each item needs a short name of lowercase letters, digits and dashes.');
    if (names.has(it.name)) throw wrong(`Two items are named ${it.name}. Give each its own name.`);
    names.add(it.name);
    if (!title) throw wrong('Each item needs a title of at most 60 characters.');
    if (!about) throw wrong('Each item needs a description of 10 to 300 characters.');
    const source = it.source?.kind === 'own' ? { kind: 'own' }
      : it.source?.kind === 'ai' && text(it.source.tool, 2, 80) ? { kind: 'ai', tool: text(it.source.tool, 2, 80) }
        : it.source?.kind === 'cc0' && typeof it.source.url === 'string' && /^https:\/\/\S+$/.test(it.source.url) && it.source.url.length <= 500 ? { kind: 'cc0', url: it.source.url }
          : null;
    if (!source) throw wrong('Say where each item comes from: your own work, the tool that generated it, or the address of its CC0 source.');
    const words = Array.isArray(it.tags) ? it.tags.filter((/** @type {unknown} */ t) => typeof t === 'string' && t.trim()).map((/** @type {string} */ t) => t.trim()).slice(0, 8) : [];
    /* a search word that is a slug already is a tag; one in any other script goes to the reviewer as it was written */
    const tags = [...new Set(words.filter((/** @type {string} */ t) => SLUG.test(t) && t.length <= 40))].slice(0, 5);
    const keywords = [...new Set(words.filter((/** @type {string} */ t) => !SLUG.test(t)).map((/** @type {string} */ t) => t.slice(0, 40)))];
    return { path: it.path, name: it.name, title, about, tags, keywords, source };
  });
  let pack;
  if (r.pack !== undefined && r.pack !== null) {
    const title = text(r.pack?.title, 1, 60), about = text(r.pack?.about, 10, 300);
    if (typeof r.pack?.name !== 'string' || !SLUG.test(r.pack.name) || r.pack.name.length > 30) throw wrong('The pack needs a short name of lowercase letters, digits and dashes.');
    if (!title || !about) throw wrong('The pack needs a title, and a description of 10 to 300 characters.');
    pack = { name: r.pack.name, title, about };
  }
  return { language: /** @type {string} */ (r.language), items, pack };
}

/** One file to the address the service gave for it: streamed, cut when it stops moving, tried three times. */
async function put(/** @type {{ url: string, headers: Record<string, string> }} */ to, /** @type {{ abs?: string, bytes?: Uint8Array }} */ file, /** @type {typeof fetch} */ get, /** @type {(n: number) => void} */ sent) {
  for (let attempt = 0; ; attempt += 1) {
    const idle = idleSignal(new AbortController().signal);
    let moved = 0;
    try {
      const source = file.abs ? /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(createReadStream(file.abs))) : new Blob([new Uint8Array(/** @type {Uint8Array} */ (file.bytes))]).stream();
      const body = source.pipeThrough(new TransformStream({ transform(chunk, controller) { idle.touch(); moved += chunk.byteLength; sent(chunk.byteLength); controller.enqueue(chunk); } }));
      const res = await get(to.url, /** @type {RequestInit} */ ({ method: 'PUT', headers: to.headers, body, signal: idle.signal, duplex: 'half' }));
      await res.body?.cancel();
      if (!res.ok) throw new Error(`The upload answered ${res.status}.`);
      return;
    } catch (e) {
      /* what this try counted as sent was not: the next try counts it again */
      sent(-moved);
      if (attempt >= 2) throw new HttpError(502, 'A file could not be uploaded. Check your connection and share it again.', { code: 'network' });
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    } finally { idle.clear(); }
  }
}

/**
 * Shares files of the library, in the background: answers at once with a job's id, and `shareJob(id)` says how far it
 * is. Refused before anything is read when no one is signed in or the request is not well formed.
 * @param {string} library the library's folder @param {unknown} raw what the editor asked (readRequest)
 * @param {Options} [o] @returns {Promise<{ job: string }>}
 */
export async function startShare(library, raw, { fetch: get = fetch } = {}) {
  const key = await accountKey();
  if (!key) throw signInFirst();
  const asked = readRequest(raw);
  const now = Date.now();
  for (const [id, job] of jobs) if (now - job.at > JOB_KEPT_MS) jobs.delete(id);
  const id = randomUUID();
  /** @type {ShareJob & { at: number }} */
  const job = { state: 'preparing', sent: 0, total: 0, at: now };
  jobs.set(id, job);
  void (async () => {
    /* each file as it is on disk now: what it is, its SHA-256, a video's poster */
    const local = new Map();
    const items = [];
    for (const it of asked.items) {
      const facts = await shareable(library, it.path);
      if (facts.problem || !facts.media) throw new HttpError(422, `${it.title} cannot be shared as it is.`, { code: facts.problem ?? 'not-media', item: it.path });
      const abs = readable(library, libraryRel(it.path));
      const sha256 = await sha256OfFile(abs);
      local.set(sha256, { abs, bytes: facts.bytes });
      let poster;
      if (facts.media === 'video') {
        const jpeg = await pictureOf(abs, 'video', facts.durationMs);
        poster = { bytes: jpeg.length, sha256: sha256Of(jpeg) };
        local.set(poster.sha256, { bytes: jpeg.length, data: jpeg });
      }
      const { path: _path, keywords, ...words } = it;
      items.push({ ...words, ...(keywords.length ? { keywords } : {}), media: facts.media, ext: facts.ext, durationMs: facts.durationMs, file: { bytes: facts.bytes, sha256 }, ...(poster ? { poster } : {}), abs });
    }
    /* a pack's cover: its first video's poster, else its first picture, small; none for sound alone */
    let cover;
    if (asked.pack) {
      const first = items.find((it) => it.poster) ?? items.find((it) => it.media === 'image');
      if (first?.poster) cover = first.poster;
      else if (first) {
        const jpeg = await pictureOf(first.abs, 'image', 0);
        cover = { bytes: jpeg.length, sha256: sha256Of(jpeg) };
        local.set(cover.sha256, { bytes: jpeg.length, data: jpeg });
      }
    }
    const body = {
      language: asked.language, agreed: true,
      items: items.map(({ abs: _abs, ...it }) => it),
      ...(asked.pack ? { pack: { ...asked.pack, ...(cover ? { cover } : {}) } } : {}),
    };
    const made = await ask('POST', '/v1/community/submissions', { key, body, fetch: get, timeoutMs: 60_000 });
    job.submission = made.submission;
    /** @type {{ sha256: string, url: string, headers: Record<string, string> }[]} */
    const uploads = Array.isArray(made.uploads) ? made.uploads : [];
    job.state = 'uploading';
    job.total = uploads.reduce((n, u) => n + (local.get(u.sha256)?.bytes ?? 0), 0);
    const pending = [...uploads];
    await Promise.all(Array.from({ length: Math.min(2, pending.length) }, async () => {
      for (let to = pending.shift(); to; to = pending.shift()) {
        const file = local.get(to.sha256);
        if (!file) throw new HttpError(502, 'OpenFilm\'s service asked for a file that is not part of this share.', { code: 'failed' });
        await put(to, file.data ? { bytes: file.data } : { abs: file.abs }, get, (n) => { job.sent += n; });
      }
    }));
    job.state = 'handing';
    job.submission = (await ask('POST', `/v1/community/submissions/${made.submission.id}/commit`, { key, fetch: get, timeoutMs: 120_000 })).submission;
    job.state = 'done';
  })().catch((e) => {
    job.state = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
    const extra = e instanceof HttpError ? /** @type {Record<string, unknown> | undefined} */ (e.extra) : undefined;
    if (typeof extra?.code === 'string') job.code = extra.code;
    if (typeof extra?.item === 'string') job.item = extra.item;
    if (extra?.submission && typeof extra.submission === 'object') job.submission = /** @type {Submission} */ (extra.submission);
  });
  return { job: id };
}

/** What the person shared, newest first, each with how its review went; none when no one is signed in. @param {Options} [o] */
export async function mySubmissions({ fetch: get } = {}) {
  const key = await accountKey();
  if (!key) return { signedIn: false, submissions: /** @type {Submission[]} */ ([]) };
  const { submissions } = await ask('GET', '/v1/community/submissions', { key, fetch: get });
  return { signedIn: true, submissions: /** @type {Submission[]} */ (Array.isArray(submissions) ? submissions : []) };
}

/* ── a film ──────────────────────────────────────────────────────────────── */

/** What of a project a shared film can hold. */
export const FILM_PARTS = /** @type {const} */ (['edit', 'canvas', 'media']);
/** What the Community takes as a film (its scripts/check.mjs): how many files, how much in all and each. */
export const FILM_LIMITS = { files: 1500, bytes: 500 * MIB, fileBytes: 200 * MIB };
/* Studio's own files that go with a film's edit; its boards go with its canvas */
const EDIT_STATE = new Set(['.film/subtitles.json', '.film/settings.json']);
const BOARD = /^\.film\/(?:canvas\.json|canvases\/[\w-]{1,64}\.json)$/;
/* text a person may have left a key in: read before it is sent anywhere */
const TEXT = /\.(?:html?|m?js|cjs|css|json|svg|md|txt|vtt|srt|csv)$/i;
const SECRETS = [/\bofk_[A-Za-z0-9_-]{16,}/, /\bsk-[A-Za-z0-9_-]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{36,}/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/, /\bAIza[0-9A-Za-z_-]{35}\b/];

/** Whether a path is one a shared film may hold: a name any system keeps (the Community's check has the same rule). */
function filmPath(/** @type {string} */ path) {
  if (!path || path.length > 400) return false;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\\:*?"<>|\u0000-\u001f]/.test(part) || /[. ]$/.test(part))) return false;
  if (parts[0] === '.git' || parts.includes('node_modules')) return false;
  return parts[0] === '.film' ? EDIT_STATE.has(path) || BOARD.test(path) : true;
}

/** @typedef {{ name: string, file: string, size: number }} FilmFile a file by its path in the film, where it is on disk, and its size */

/**
 * A project's files by the part of a shared film each belongs to. A file the film plays is its edit's, even when a
 * board shows it too; a file only a board shows is the canvas's; the rest is other media. `left`: what cannot go and
 * why (`empty`: nothing in it; `name`: a name the Community does not take; `too-big`: larger than one file may be).
 * @param {string} root
 * @returns {Promise<{ edit: FilmFile[], canvas: FilmFile[], media: FilmFile[], left: { path: string, why: 'empty' | 'name' | 'too-big' }[] }>}
 */
export async function filmParts(root) {
  /* everything an exported project takes (links followed to the media itself), without its history or conversations */
  const all = new Map((await projectFiles(root, [])).map((file) => [file.name, file]));
  for (const name of await readdir(join(root, '.film', 'canvases')).catch(() => [])) {
    const path = `.film/canvases/${name}`;
    const info = BOARD.test(path) ? await stat(join(root, '.film', 'canvases', name)).catch(() => null) : null;
    if (info?.isFile()) all.set(path, { name: path, file: join(root, '.film', 'canvases', name), size: info.size });
  }
  const played = await filmClosure(folderView(root));
  /* what the boards show: a node's file, and the files a node made */
  const shown = new Set();
  for (const [name, board] of all) {
    if (!BOARD.test(name)) continue;
    let nodes = [];
    try { nodes = JSON.parse(await readFile(board.file, 'utf8'))?.nodes ?? []; } catch { /* a board that cannot be read shows nothing */ }
    for (const node of Array.isArray(nodes) ? nodes : []) {
      for (const path of [node?.path, ...(Array.isArray(node?.versions) ? node.versions : [])]) if (typeof path === 'string' && all.has(path)) shown.add(path);
    }
  }
  /** @type {Awaited<ReturnType<typeof filmParts>>} */
  const out = { edit: [], canvas: [], media: [], left: [] };
  for (const file of [...all.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const part = file.name === 'film.html' || played.has(file.name) || EDIT_STATE.has(file.name) ? 'edit'
      : BOARD.test(file.name) || shown.has(file.name) ? 'canvas'
        : file.name.startsWith('.film/') ? null : 'media';
    if (!part) continue;
    if (!filmPath(file.name)) out.left.push({ path: file.name, why: 'name' });
    else if (!file.size) out.left.push({ path: file.name, why: 'empty' });
    else if (file.size > FILM_LIMITS.fileBytes) out.left.push({ path: file.name, why: 'too-big' });
    else out[part].push(file);
  }
  return out;
}

/** The first file among these that holds what looks like a key, or null: text files only, each read once. */
async function secretIn(/** @type {FilmFile[]} */ files) {
  for (const file of files) {
    if (!TEXT.test(file.name) || file.size > 4 * MIB) continue;
    const text = await readFile(file.file, 'utf8').catch(() => '');
    if (SECRETS.some((re) => re.test(text))) return file.name;
  }
  return null;
}

const sum = (/** @type {FilmFile[]} */ files) => ({ files: files.length, bytes: files.reduce((n, file) => n + file.size, 0) });

/**
 * A project as a film to share: what each part holds, and what stands in the way of sharing its edit (`problem`:
 * `no-film`, there is no film.html or it plays nothing; `too-big` or `too-many`, the edit alone is more than a shared
 * film may be; `secret`, a file of the edit holds what looks like a key, named in `file`). A part with nothing in it
 * is null. `left`: files that cannot go.
 * @param {string} root
 */
export async function filmShareable(root) {
  const parts = await filmParts(root);
  const edit = sum(parts.edit), canvas = sum(parts.canvas), media = sum(parts.media);
  /** @type {{ parts: { edit: { files: number, bytes: number }, canvas: { files: number, bytes: number } | null, media: { files: number, bytes: number } | null }, limits: typeof FILM_LIMITS, left: { path: string, why: string }[], problem?: string, file?: string }} */
  const out = { parts: { edit, canvas: canvas.files ? canvas : null, media: media.files ? media : null }, limits: FILM_LIMITS, left: parts.left };
  /* a film.html alone plays nothing: what it plays is what is shared */
  if (!parts.edit.some((file) => file.name === 'film.html') || parts.edit.filter((file) => !file.name.startsWith('.film/')).length < 2) return { ...out, problem: 'no-film' };
  if (edit.bytes > FILM_LIMITS.bytes) return { ...out, problem: 'too-big' };
  if (edit.files > FILM_LIMITS.files) return { ...out, problem: 'too-many' };
  const secret = await secretIn(parts.edit);
  return secret ? { ...out, problem: 'secret', file: secret } : out;
}

/** What the editor asked to share of a film, read strictly. */
function readFilmRequest(/** @type {unknown} */ raw) {
  const r = /** @type {Record<string, any>} */ (raw && typeof raw === 'object' ? raw : {});
  if (r.agreed !== true) throw wrong('Say first that this film is yours to share.');
  if (!LANGUAGES.includes(r.language)) throw wrong('language: the language the words are written in');
  if (typeof r.name !== 'string' || !SLUG.test(r.name) || r.name.length > 40) throw wrong('The film needs a short name of lowercase letters, digits and dashes.');
  const title = text(r.title, 1, 80), about = text(r.about, 10, 300);
  if (!title) throw wrong('The film needs a title of at most 80 characters.');
  if (!about) throw wrong('The film needs a description of 10 to 300 characters.');
  if (r.category !== undefined && r.category !== null && (typeof r.category !== 'string' || !/^[\w-]{1,30}$/.test(r.category))) throw wrong('category: a short word, as music-video or launch');
  const parts = Array.isArray(r.parts) ? [...new Set(r.parts)] : [];
  if (!parts.includes('edit') || parts.some((part) => !(/** @type {readonly unknown[]} */ (FILM_PARTS)).includes(part))) throw wrong('parts: edit, and canvas or media when chosen');
  return { language: /** @type {string} */ (r.language), name: /** @type {string} */ (r.name), title, about, ...(r.category ? { category: /** @type {string} */ (r.category) } : {}), parts: FILM_PARTS.filter((part) => parts.includes(part)) };
}

/**
 * Shares a project as a film, in the background, as startShare does: `shareJob(id)` says how far it is. `how.poster`
 * gives the film's poster (a picture's file, or its bytes); `how.duration` its length in milliseconds, asked once the
 * poster is had (drawing the film is how Studio learns how long it is).
 * @param {string} root the project's folder @param {unknown} raw what the editor asked (readFilmRequest)
 * @param {Options & { poster: () => Promise<{ file: string } | { bytes: Uint8Array } | null>, duration: () => Promise<number | null> | number | null }} how
 * @returns {Promise<{ job: string }>}
 */
export async function startFilmShare(root, raw, { fetch: get = fetch, poster, duration }) {
  const key = await accountKey();
  if (!key) throw signInFirst();
  const asked = readFilmRequest(raw);
  const now = Date.now();
  for (const [id, job] of jobs) if (now - job.at > JOB_KEPT_MS) jobs.delete(id);
  const id = randomUUID();
  /** @type {ShareJob & { at: number }} */
  const job = { state: 'preparing', sent: 0, total: 0, at: now };
  jobs.set(id, job);
  void (async () => {
    const parts = await filmParts(root);
    const chosen = asked.parts.flatMap((part) => parts[part]);
    if (!chosen.some((file) => file.name === 'film.html')) throw new HttpError(422, 'There is no film here to share.', { code: 'no-film' });
    const bytes = chosen.reduce((n, file) => n + file.size, 0);
    if (bytes > FILM_LIMITS.bytes) throw new HttpError(422, 'It is more than a shared film may be. Share less of it.', { code: 'too-big' });
    if (chosen.length > FILM_LIMITS.files) throw new HttpError(422, 'It has more files than a shared film may have. Share less of it.', { code: 'too-many' });
    const secret = await secretIn(chosen);
    if (secret) throw new HttpError(422, `${secret} holds what looks like a key. Take it out, then share the film.`, { code: 'secret', item: secret });
    /* each file as it is on disk now, by its SHA-256; two files of one content are sent once */
    const local = new Map();
    const files = [];
    for (const file of chosen) {
      const sha256 = await sha256OfFile(file.file);
      local.set(sha256, { abs: file.file, bytes: file.size });
      files.push({ path: file.name, bytes: file.size, sha256 });
    }
    const picture = await poster();
    if (!picture) throw new HttpError(422, 'The film\'s poster could not be drawn. Open the film, then share it again.', { code: 'poster' });
    /* a cover the person chose may be any picture: sent as a JPEG small enough to be a poster */
    const jpeg = 'file' in picture ? await pictureOf(picture.file, 'image', 0) : Buffer.from(picture.bytes);
    if (jpeg.length > PICTURE_MAX_BYTES) throw new HttpError(422, 'The film\'s poster is too large.', { code: 'poster' });
    const posterFile = { bytes: jpeg.length, sha256: sha256Of(jpeg) };
    local.set(posterFile.sha256, { bytes: jpeg.length, data: jpeg });
    const durationMs = Math.round((await duration()) ?? 0);
    if (!(durationMs >= 1)) throw new HttpError(422, 'The film has no length yet: play it once, then share it.', { code: 'no-film' });
    /* a part with nothing chosen from it is not said: a film that holds no board says no canvas */
    const held = asked.parts.filter((part) => part === 'edit' || parts[part].length);
    const body = { ...asked, parts: held, agreed: true, durationMs, poster: posterFile, files };
    const made = await ask('POST', '/v1/community/films', { key, body, fetch: get, timeoutMs: 120_000 });
    job.submission = made.submission;
    /** @type {{ sha256: string, url: string, headers: Record<string, string> }[]} */
    const uploads = Array.isArray(made.uploads) ? made.uploads : [];
    job.state = 'uploading';
    job.total = uploads.reduce((n, u) => n + (local.get(u.sha256)?.bytes ?? 0), 0);
    const pending = [...uploads];
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
      for (let to = pending.shift(); to; to = pending.shift()) {
        const file = local.get(to.sha256);
        if (!file) throw new HttpError(502, 'OpenFilm\'s service asked for a file that is not part of this film.', { code: 'failed' });
        await put(to, file.data ? { bytes: file.data } : { abs: file.abs }, get, (n) => { job.sent += n; });
      }
    }));
    job.state = 'handing';
    job.submission = (await ask('POST', `/v1/community/submissions/${made.submission.id}/commit`, { key, fetch: get, timeoutMs: 180_000 })).submission;
    job.state = 'done';
  })().catch((e) => {
    job.state = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
    const extra = e instanceof HttpError ? /** @type {Record<string, unknown> | undefined} */ (e.extra) : undefined;
    if (typeof extra?.code === 'string') job.code = extra.code;
    if (typeof extra?.item === 'string') job.item = extra.item;
    if (extra?.submission && typeof extra.submission === 'object') job.submission = /** @type {Submission} */ (extra.submission);
  });
  return { job: id };
}

/** Takes back what the person shared: one in review is no longer reviewed, one listed is no longer listed. @param {string} id @param {Options} [o] */
export async function withdrawSubmission(id, { fetch: get } = {}) {
  const key = await accountKey();
  if (!key) throw signInFirst();
  if (!/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, 'which submission?');
  const { submission } = await ask('POST', `/v1/community/submissions/${id}/withdraw`, { key, fetch: get, timeoutMs: 60_000 });
  return { submission: /** @type {Submission} */ (submission) };
}
