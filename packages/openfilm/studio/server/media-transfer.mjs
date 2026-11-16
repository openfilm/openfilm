// @ts-check
/** Durable request identity and bounded-memory downloads. Bytes reach a private sibling first, then atomically replace the asset. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { replaceFile, writeAtomic } from './atomic.mjs';
const hash = (/** @type {string | Uint8Array} */ value) => createHash('sha256').update(value).digest('hex');
const stable = (/** @type {unknown} */ value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const DAY = 24 * 60 * 60_000;
/** @param {string} path */
async function digest(path) { const value = createHash('sha256'); for await (const chunk of createReadStream(path)) value.update(chunk); return value.digest('hex'); }
async function json(/** @type {string} */ path) { try { if ((await lstat(path)).isSymbolicLink() || (await stat(path)).size > 64 * 1024 * 1024) return null; return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
/** Keep parallel commands from overwriting a paid request's journal or partial files. A dead process leaves a recoverable lock. */
async function lock(/** @type {string} */ path) {
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ token, pid: process.pid, created: Date.now() })); } finally { await handle.close(); }
      return async () => { if ((await json(path))?.token === token) await rm(path, { force: true }); };
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
      const old = await json(path);
      let alive = true;
      if (Number.isInteger(old?.pid) && old.pid > 0) { try { process.kill(old.pid, 0); } catch (error) { alive = /** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH'; } }
      if (old && (!alive || Date.now() - old.created > 60 * 60_000) && (await json(path))?.token === old.token) { await rm(path, { force: true }); continue; }
      throw new Error('This identical media request is already being recovered. Wait for that command to finish; no new generation was submitted.');
    }
  }
  throw new Error('Could not lock the saved media request.');
}
async function assetTarget(/** @type {string} */ root, /** @type {string} */ path) {
  if (!path.startsWith('assets/') || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || /[\\:\0]/.test(path)) throw new Error('The service returned an invalid asset path.');
  let target = root;
  for (const part of path.split('/')) {
    target = join(target, part);
    if ((await lstat(target).catch(() => null))?.isSymbolicLink()) throw new Error('A media destination must not pass through a link.');
  }
  return target;
}
async function privateDirectory(/** @type {string} */ root) {
  let dir = root;
  for (const name of ['.film', 'media-runs']) {
    dir = join(dir, name);
    const before = await lstat(dir).catch(() => null);
    if (before?.isSymbolicLink() || before && !before.isDirectory()) throw new Error('The media recovery folder must be a project directory, not a link.');
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  // Expired partial bytes may be removed; request identities remain so expiry cannot silently create another charge.
  for (const name of await readdir(dir)) if (/^[a-f0-9]{64}\.part(?:\.json)?$/.test(name)) {
    const file = join(dir, name), info = await lstat(file).catch(() => null);
    if (info && info.mtimeMs < Date.now() - DAY) await rm(file, {force:true});
  }
  return dir;
}
/** How long a transfer may move nothing before it is cut and tried again (a slow one that moves goes on). */
export const IDLE_MS = { value: 60_000 };

/**
 * A signal that aborts when `touch` has not been called for IDLE_MS (or `outer` aborts): a transfer touches it as bytes
 * move. @param {AbortSignal} outer
 */
export function idleSignal(outer) {
  const controller = new AbortController();
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const touch = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error('The transfer stopped moving.')), IDLE_MS.value); };
  touch();
  return { signal: AbortSignal.any([outer, controller.signal]), touch, clear: () => clearTimeout(timer) };
}

/** The descriptor's URLs are short-lived capabilities; only this private directory sees them, never logs or the agent's receipt. */
export async function mediaTransfer(/** @type {string} */ root, /** @type {AbortSignal} */ signal) {
  if (!root || !(await stat(root).catch(() => null))?.isDirectory()) return null;
  const dir = await privateDirectory(root);
  return {
    /**
     * The saved request for a run (`identity`: what makes it the same run), made or found. `about`: what was asked
     * (`{ verb, args, via, model }`), kept with it so a request left pending can be named and asked again (pending()).
     */
    async request(/** @type {string} */ scope, /** @type {unknown} */ identity, fresh = false, /** @type {Record<string, unknown> | undefined} */ about = undefined) {
      const file = join(dir, hash(scope + '\0' + stable(identity)) + '.request.json');
      const release = await lock(file + '.lock');
      try {
      const old = fresh ? null : await json(file);
      if (!fresh && !old && await lstat(file).catch(() => null)) throw new Error('The saved media request is damaged. Check its outcome before intentionally starting a new take with --fresh.');
      if (old && (typeof old.key !== 'string' || !/^[\w-]{20,80}$/.test(old.key) || !Number.isFinite(old.created))) throw new Error('Invalid saved media request.');
      const row = old ?? { key: randomUUID(), created: Date.now(), ...(about ? { about } : {}) };
      if (old && Date.now() - old.created > DAY) throw new Error('An earlier identical media request expired. Its outcome must be checked before starting another paid generation; use --fresh only to intentionally create a new take.');
      await writeAtomic(file, JSON.stringify(row), { mode: 0o600 });
      return { key: row.key, resumed: Boolean(old), reply: row.reply, release,
        async remember(/** @type {any} */ reply) { row.reply = reply; await writeAtomic(file, JSON.stringify(row), { mode: 0o600 }); },
        async finish() {
          await rm(file, { force: true });
          for (const name of await readdir(dir)) if (/^[a-f0-9]{64}\.part\.json$/.test(name)) {
            const metadata = await json(join(dir, name));
            if (metadata?.request === row.key) { await rm(join(dir, name), { force: true }); await rm(join(dir, name.replace(/\.json$/, '')), { force: true }); }
          }
        },
      };
      } catch (e) { await release(); throw e; }
    },
    /**
     * The requests left pending here (asked, not yet saved in the project), newest first, each with what was asked:
     * what a person can ask again to recover what may already be paid for.
     * @returns {Promise<{ key: string, created: number, about: Record<string, unknown> }[]>}
     */
    async pending() {
      const rows = [];
      for (const name of await readdir(dir)) {
        if (!name.endsWith('.request.json')) continue;
        const row = await json(join(dir, name));
        if (row && typeof row.key === 'string' && Number.isFinite(row.created) && row.about && typeof row.about === 'object' && Date.now() - row.created <= DAY) rows.push({ key: row.key, created: row.created, about: row.about });
      }
      return rows.sort((a, b) => b.created - a.created);
    },
    async download(/** @type {{path:string,url:string,alternate_urls?:string[],bytes?:number,sha256?:string}} */ file, /** @type {string} */ key, /** @type {(path:string)=>Promise<any>} */ refresh) {
      const name = hash(key + '\0' + file.path), part = join(dir, name + '.part'), metaFile = join(dir, name + '.part.json');
      const target = await assetTarget(root, file.path);
      if ((await lstat(part).catch(() => null))?.isSymbolicLink()) throw new Error('The download staging file must not be a link.');
      let meta = await json(metaFile) ?? {};
      const committed = meta.target === target && (!file.sha256 || file.sha256 === meta.sha256) && (await stat(target).catch(() => null))?.size === meta.size && await digest(target) === meta.sha256;
      if (!committed) {
        let last;
        for (let attempt = 0; attempt < 4; attempt++) {
          signal.throwIfAborted();
          try {
            let size = (await stat(part).catch(() => null))?.size ?? 0;
            if (size > 0 && size === (file.bytes ?? meta.total)) {
              const sha256 = await digest(part);
              if ((!file.sha256 || file.sha256 === sha256) && (!meta.sha256 || meta.sha256 === sha256)) {
                meta = { ...meta, request: key, size, sha256 }; await writeAtomic(metaFile, JSON.stringify(meta), { mode: 0o600 }); break;
              }
              await rm(part, { force: true }); meta = {}; size = 0;
            }
            const validator = meta.etag || meta.modified;
            const offset = size && validator ? size : 0;
            const headers = { 'accept-encoding': 'identity', ...(offset ? { range: `bytes=${offset}-`, 'if-range': validator } : {}) };
            /* cut when it moves nothing for a while, not after a fixed time: a slow download that moves goes on */
            const idle = idleSignal(signal);
            try {
            /* a try after the first goes to the file's other addresses in turn, when the service gives some (its own
               origin beside the storage's): a path to one that fails is not the only way to the file */
            const address = attempt && file.alternate_urls?.length ? file.alternate_urls[(attempt - 1) % file.alternate_urls.length] : file.url;
            const res = await fetch(address, { headers, signal: idle.signal });
            idle.touch();
            if ([401, 403, 404].includes(res.status) && attempt < 3) { await res.body?.cancel(); file = await refresh(file.path); continue; }
            if (!res.ok) throw new Error(`Media download answered ${res.status}.`);
            if (/^(text\/html|application\/(json|xml))\b/.test(res.headers.get('content-type') ?? '')) { await res.body?.cancel(); throw new Error('The media address returned an error document instead of a media file.'); }
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
            if (res.status === 206 && (!range || Number(range[1]) !== offset || meta.etag && meta.etag !== res.headers.get('etag') || !meta.etag && meta.modified && meta.modified !== res.headers.get('last-modified'))) {
              await res.body?.cancel(); await rm(part, { force: true }); meta = {}; throw new Error('The download range changed; fetching the original file again.');
            }
            const append = res.status === 206 && offset > 0;
            const expected = range ? Number(range[3]) : Number(res.headers.get('content-length')) || null;
            if (expected !== null && expected > 2 * 1024 ** 3) { await res.body?.cancel(); throw new Error('The generated file exceeds the 2 GB download limit.'); }
            meta = { request: key, etag: res.headers.get('etag'), modified: res.headers.get('last-modified'), total: expected };
            await writeAtomic(metaFile, JSON.stringify(meta), { mode: 0o600 });
            if (!res.body) throw new Error('Media download returned no file.');
            let received = append ? offset : 0;
            await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (res.body)), new Transform({ transform(chunk, _encoding, done) {
              idle.touch();
              received += chunk.length;
              if (received > 2 * 1024 ** 3) return done(new Error('The generated file exceeds the 2 GB download limit.'));
              done(null, chunk);
            } }), createWriteStream(part, { flags: append ? 'a' : 'w', mode: 0o600 }), { signal: idle.signal });
            if ((expected !== null && received !== expected) || (file.bytes !== undefined && received !== file.bytes) || received === 0) throw new Error('The generated file was not received completely.');
            const sha256 = await digest(part);
            if (file.sha256 && file.sha256 !== sha256) { await rm(part, { force: true }); meta = {}; throw new Error('The generated file checksum did not match.'); }
            meta = { ...meta, size: received, sha256 }; await writeAtomic(metaFile, JSON.stringify(meta), { mode: 0o600 });
            } finally { idle.clear(); }
            break;
          } catch (e) { last = e; if (signal.aborted || attempt === 3) throw e; await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt)); }
        }
        if (!meta.sha256) throw last ?? new Error('Media download did not finish.');
      }
      return { path: file.path, commit: async (/** @type {string} */ target) => {
        if (target !== await assetTarget(root, file.path)) throw new Error('The media destination changed.');
        // The journal's target comes from the caller's validated asset path, not a remote response.
        const existing = (await stat(target).catch(() => null))?.size === meta.size && await digest(target) === meta.sha256;
        if (!existing) {
          await writeAtomic(metaFile, JSON.stringify({ ...meta, target }), { mode: 0o600 });
          await replaceFile(part, target);
        }
        await rm(part, { force: true }); await writeAtomic(metaFile, JSON.stringify({ ...meta, request: key, target }), { mode: 0o600 });
      } };
    },
  };
}
