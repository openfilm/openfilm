// @ts-check
/**
 * The person's own keys for media services, which service makes each kind of media and with which model
 * (Settings → Services).
 *
 * Kept in ~/.openfilm/providers.json, readable by this user only (0600, in a 0700 folder), written whole and atomically:
 *   { "keys": { "<provider id>": "<key>" }, "use": { "<verb>": "<provider id>" }, "model": { "<verb>": "<model id>" },
 *     "custom": [ the person's own services (custom-services.mjs), each with its key ],
 *     "accounts": { "<provider id>": "<email>" } (who a provider signed in to, sign-in.mjs, is connected as) }
 * A keyless provider connected without a key keeps '' as its key. A kind of media with no model (or one its provider no
 * longer has) is made with the provider's first. Listing voices goes with voice-over: same provider, same model.
 *
 * The file is shared with every OpenFilm on this computer (`npx openfilm`, the app), which may be older or newer than
 * this one: what this one does not know of it (a newer one's field) is written back as it was, never dropped.
 *
 * A key in the environment (the provider's variable, e.g. ELEVENLABS_API_KEY) wins over the file: it is how people
 * already keep keys, and Studio cannot remove it. Keys leave this process only towards their own service; the editor
 * page sees where a key comes from and its last four characters, never the key.
 *
 * Sealed keys. In the app, Studio is handed a sealer (sealKeysWith): every key it writes is kept sealed instead,
 *   "sealed": { "keys": { "<provider id>": "<sealed>" }, "custom": { "<service id>": "<sealed>" } }
 * with '' left in `keys` for a keyless provider (nothing to hide) and no `key` on a custom service. The app's sealer is
 * AES-256-GCM with a key of its own that only the system's keychain opens for the app (macOS Keychain, Windows DPAPI):
 * each sealed key is bound to where it goes (its provider, or the service's id and address), so one moved to another
 * entry, or a service's address changed in the file, opens to nothing. Plain keys found in the file (an older OpenFilm
 * or `npx openfilm` wrote them, or this one before) are sealed when the app's Studio starts and on every write; a
 * plain key wins over a sealed one of the same entry, being the newer. Without a sealer (`npx openfilm`, an older app)
 * the sealed keys are not seen and stay in the file as they are: its own keys are kept plain, as before.
 *
 * What this protects, honestly: the OS user is the boundary. Any program running as this user (an agent, a skill, a
 * plugin's command) can read this file; sealed, it gets nothing usable from it on macOS, where the keychain asks the
 * person before it opens the app's item to another program. On Windows DPAPI opens to any program of the same user, so
 * there sealing keeps keys out of copies of the file (backups, a synced folder) but not from such a program. Nothing
 * here stops a program of this user that reads Studio's memory, or a key the person exported in their own shell.
 * `npx openfilm` on its own keeps keys plain (0600): a keychain item it made would have to trust `node` or
 * `security`, which any agent of this user can run too, so it would only add prompts.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { studioHome } from './projects.mjs';
import { replaceFile } from './atomic.mjs';
import { keptServices } from './custom-services.mjs';

/** @typedef {import('./providers/contract.mjs').Provider} Provider */
/**
 * `off`: the providers disconnected while the environment has a key for them (that key is not used). `custom`: the
 * person's own services. `libraryOff`: the library is searched by its words alone, not by meaning at OpenFilm's
 * service (src/library-semantic.mjs).
 * @typedef {{ keys: Record<string, string>, use: Record<string, string>, model: Record<string, string>, off: string[],
 *   custom: import('./custom-services.mjs').CustomService[], accounts: Record<string, string>, libraryOff: boolean }} ProviderSettings
 */

/** Where the keys and choices are kept: ~/.openfilm/providers.json. */
export const providersFile = () => join(studioHome(), 'providers.json');

/** Other names a provider's key goes by in the wild (Google's own tools read either). */
const ALSO = /** @type {Record<string, string[]>} */ ({ GEMINI_API_KEY: ['GOOGLE_API_KEY'], DOUBAO_SPEECH_API_KEY: ['DOUBAO_ASR_API_KEY'] });

const plain = (/** @type {unknown} */ v) => v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {};
const strings = (/** @type {unknown} */ v) => /** @type {Record<string, string>} */ (Object.fromEntries(Object.entries(plain(v)).filter(([, s]) => typeof s === 'string')));

/**
 * Seals and opens keys (see the top): `unseal` gives null for what it cannot open. `bound` is where the key goes
 * (sealedFor), so a sealed key opens only there.
 * @typedef {{ seal: (key: string, bound: string) => string, unseal: (sealed: string, bound: string) => string | null }} Sealer
 */

/** @type {Sealer | null} */
let sealer = null;

/** Keep keys sealed with `next` from now on (the app's Studio, at its start); null: plain, as `npx openfilm` keeps them. */
export const sealKeysWith = (/** @type {Sealer | null} */ next) => { sealer = next; };

/**
 * The app's sealer: AES-256-GCM with `vault` (32 bytes the system's keychain keeps for the app), each key bound to
 * where it goes. A sealed key reads `v1:` and base64 of its nonce, tag and text.
 * @param {Buffer} vault @returns {Sealer}
 */
export function vaultSealer(vault) {
  if (vault.length !== 32) throw new Error('a vault is 32 bytes');
  return {
    seal(key, bound) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', vault, nonce).setAAD(Buffer.from(bound));
      const text = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
      return `v1:${Buffer.concat([nonce, cipher.getAuthTag(), text]).toString('base64')}`;
    },
    unseal(sealed, bound) {
      if (!sealed.startsWith('v1:')) return null;
      try {
        const data = Buffer.from(sealed.slice(3), 'base64');
        const decipher = createDecipheriv('aes-256-gcm', vault, data.subarray(0, 12)).setAAD(Buffer.from(bound));
        decipher.setAuthTag(data.subarray(12, 28));
        return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
      } catch { return null; }
    },
  };
}

/** Where a key goes, which its seal is bound to: a provider, or a person's service at its address. */
const sealedFor = {
  provider: (/** @type {string} */ id) => `keys\n${id}`,
  custom: (/** @type {import('./custom-services.mjs').CustomService} */ s) => `custom\n${s.id}\n${s.url}`,
};

/**
 * The saved keys and choices (empty when there are none yet), sealed keys opened when Studio has the sealer.
 * `strict`: a file there that cannot be read now (on Windows, held for a moment by an antivirus or indexer) throws
 * instead of reading as none.
 */
export async function readSettings(file = providersFile(), { strict = false } = {}) {
  try {
    const info = await stat(file);
    /* someone loosened it: keys are this user's alone (Windows has no such bits: it always looks loosened) */
    if (process.platform !== 'win32' && info.mode & 0o077) await chmod(file, 0o600).catch(() => {});
    const raw = plain(JSON.parse(await readFile(file, 'utf8')));
    /* 'auto' was a choice once: it means none now */
    const use = Object.fromEntries(Object.entries(strings(raw.use)).filter(([, id]) => id !== 'auto'));
    const off = Array.isArray(raw.off) ? raw.off.filter((id) => typeof id === 'string') : [];
    const keys = strings(raw.keys);
    const custom = keptServices(raw.custom);
    if (sealer) {
      const sealed = plain(raw.sealed);
      for (const [id, value] of Object.entries(strings(sealed.keys))) {
        if (Object.hasOwn(keys, id)) continue;
        const key = sealer.unseal(value, sealedFor.provider(id));
        if (key) keys[id] = key;
      }
      const sealedCustom = strings(sealed.custom);
      for (const s of custom) {
        const key = !s.key && Object.hasOwn(sealedCustom, s.id) ? sealer.unseal(sealedCustom[s.id], sealedFor.custom(s)) : null;
        if (key) s.key = key;
      }
    }
    return /** @type {ProviderSettings} */ ({ keys, use, model: strings(raw.model), off, custom, accounts: strings(raw.accounts), libraryOff: raw.libraryOff === true });
  } catch (e) {
    /* none yet, or not JSON, reads as none; a file that is there but cannot be read is not "none" */
    const code = /** @type {NodeJS.ErrnoException} */ (e).code;
    if (strict && code && code !== 'ENOENT') throw e;
    return /** @type {ProviderSettings} */ ({ keys: {}, use: {}, model: {}, off: [], custom: [], accounts: {}, libraryOff: false });
  }
}

/**
 * The settings as the file keeps them: with a sealer, every key sealed (what was sealed before and is gone from
 * `settings` is gone: disconnected, or one this sealer cannot open), else as they are.
 * @param {ProviderSettings} settings
 */
function asKept(settings) {
  if (!sealer) return settings;
  const keys = /** @type {Record<string, string>} */ ({}), sealedKeys = /** @type {Record<string, string>} */ ({}), sealedCustom = /** @type {Record<string, string>} */ ({});
  for (const [id, key] of Object.entries(settings.keys)) {
    if (key) sealedKeys[id] = sealer.seal(key, sealedFor.provider(id));
    else keys[id] = key;
  }
  const custom = settings.custom.map(({ key, ...s }) => {
    if (key) sealedCustom[s.id] = /** @type {Sealer} */ (sealer).seal(key, sealedFor.custom(s));
    return s;
  });
  return { ...settings, keys, custom, sealed: { keys: sealedKeys, custom: sealedCustom } };
}

/** Seal the keys the file keeps plain, when Studio has the sealer (the app's Studio, as it starts). */
export async function sealPlainKeys(file = providersFile()) {
  if (!sealer) return;
  const raw = plain(await readFile(file, 'utf8').then(JSON.parse, () => null));
  if (Object.values(strings(raw.keys)).some(Boolean) || keptServices(raw.custom).some((s) => s.key)) await changeSettings(() => {}, file);
}

/**
 * The kind of media a verb is chosen with: voices are found by what speaks them, web pages read by what searches.
 * @param {string} verb
 */
export const kindOf = (verb) => (verb === 'voice' ? 'tts' : verb === 'web-fetch' ? 'web-search' : verb);

/**
 * The model `provider` makes `verb` with: the person's choice while the provider has it, else its first. Voices are
 * found with voice-over's. undefined: the provider names no models for it.
 * @param {ProviderSettings} settings @param {Provider} provider @param {string} verb
 */
export function modelFor(settings, provider, verb) {
  const kind = kindOf(verb);
  const models = provider.models?.[/** @type {import('./providers/contract.mjs').Verb} */ (kind)] ?? [];
  return (models.find((m) => m.id === settings.model[kind]) ?? models[0])?.id;
}

/** @type {Promise<unknown>} one change at a time, each on the file as the last one left it */
let changing = Promise.resolve();

/** Change the settings with `edit` and write them back. Resolves with what was written. */
export function changeSettings(/** @type {(s: ProviderSettings) => void} */ edit, file = providersFile()) {
  const next = changing.catch(() => {}).then(async () => {
    const settings = await readSettings(file);
    edit(settings);
    /* what another OpenFilm keeps here, unknown to this one, stays */
    const kept = plain(await readFile(file, 'utf8').then(JSON.parse, () => null));
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ ...kept, ...asKept(settings) }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await replaceFile(tmp, file);
    return settings;
  });
  changing = next;
  return next;
}

/**
 * A provider's key and where it comes from: the one pasted in Studio (the person's choice), else the environment's
 * unless the person disconnected it there. A `keyless` provider connected without a key (kept as '') has the key ''.
 * null: not connected.
 * @param {Provider} provider @param {ProviderSettings} settings
 * @returns {{ key: string, source: 'env' | 'file', env: string } | null}
 */
export function providerKey(provider, settings, env = process.env) {
  /* one that takes no key (Local services): connected while it can run, unless the person disconnected it */
  if (provider.ready) return !settings.off?.includes(provider.id) && provider.ready() ? { key: '', source: 'file', env: '' } : null;
  const kept = settings.keys[provider.id];
  if (kept) return { key: kept, source: 'file', env: provider.env };
  if (settings.off?.includes(provider.id)) return null;
  return envKey(provider, env) ?? (provider.keyless && kept === '' ? { key: '', source: 'file', env: provider.env } : null);
}

/** The environment's key for a provider, connected or not, or null. @param {Provider} provider */
export function envKey(provider, env = process.env) {
  for (const name of [provider.env, ...(ALSO[provider.env] ?? [])]) {
    const key = env[name]?.trim();
    if (key) return { key, source: /** @type {const} */ ('env'), env: name };
  }
  return null;
}

/** A pasted key as it is kept: trimmed, one line, of a plausible length. Throws a sentence the page can show. */
export function cleanKey(/** @type {unknown} */ value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (key.length < 8 || key.length > 512 || /[\s\u0000-\u001f\u007f]/.test(key)) throw new Error('That does not look like an API key: paste the whole key, on its own.');
  return key;
}
