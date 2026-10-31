#!/usr/bin/env node
// @ts-check
/**
 * The library's voices (library/voices.json): the ready-made voices of the voice-over services OpenFilm offers
 * (ElevenLabs Eleven v4, Inworld TTS-2, Cartesia Sonic 3.6), as each service's own API lists them, each with its
 * service's own sample, made small (library/voices/<service>/<voice>.m4a).
 *
 *   ELEVENLABS_API_KEY=… INWORLD_API_KEY=… CARTESIA_API_KEY=… node scripts/library-voices.mjs
 *
 * Listing voices and their samples costs nothing with any of them. A sample already here is kept; a service without
 * a key keeps what voices.json had for it. Cartesia lists a thousand voices: those it gives a sample of are the ones
 * it shows, and the ones kept.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIBRARY = fileURLToPath(new URL('../library/', import.meta.url));
const OUT = join(LIBRARY, 'voices.json');
/* a sample: one channel, small, its first seconds */
const SAMPLE_SECONDS = 15;

/**
 * @typedef {{ provider: string, id: string, name: string, description: string | null, gender: 'm' | 'f' | 'n' | null,
 *   age: 'young' | 'middle' | 'old' | null, language: string | null, accent: string | null, tags: string[], sample: string | null }} Voice
 * @typedef {{ voice: Voice, fetch: () => Promise<Uint8Array | null> }} Found
 */

/** The services, in the order the library shows them, each with the models a voice of it speaks with. */
const PROVIDERS = [
  { id: 'elevenlabs', name: 'ElevenLabs', models: [{ id: 'eleven_v4', name: 'Eleven v4' }, { id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo' }] },
  { id: 'inworld', name: 'Inworld', models: [{ id: 'inworld-tts-2', name: 'TTS-2' }, { id: 'inworld-tts-2-flash', name: 'TTS-2 Flash' }] },
  { id: 'cartesia', name: 'Cartesia', models: [{ id: 'sonic-3.6', name: 'Sonic 3.6' }] },
];

const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.trim() : '');
const sex = (/** @type {unknown} */ v) => {
  const s = str(v).toLowerCase();
  return s === 'male' || s === 'masculine' ? 'm' : s === 'female' || s === 'feminine' ? 'f' : s === 'neutral' || s === 'gender_neutral' ? 'n' : null;
};
const ageOf = (/** @type {unknown} */ v) => {
  const s = str(v).toLowerCase();
  return s === 'young' ? 'young' : s === 'middle_aged' || s === 'middle aged' ? 'middle' : s === 'old' || s === 'elderly' ? 'old' : null;
};
/** "informative_educational" → "informative educational" */
const words = (/** @type {unknown} */ v) => str(v).replace(/[_-]+/g, ' ');
const fileName = (/** @type {string} */ id) => id.replace(/[^\w.-]+/g, '_');

/** GET as JSON, asked again a few times when the service says to wait. @param {string} url @param {Record<string, string>} headers */
async function json(url, headers) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && i < 5) { await sleep(1000 * 2 ** i); continue; }
    throw new Error(`${url.split('?')[0]} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** GET as bytes (null when it is not there). @param {string} url @param {Record<string, string>} [headers] */
async function bytes(url, headers = {}) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    if ((res.status === 429 || res.status >= 500) && i < 5) { await sleep(1000 * 2 ** i); continue; }
    return null;
  }
}

/** ElevenLabs' premade voices; "Bella - Professional, Bright, Warm" is Bella, those three words her tags. @param {string} key @returns {Promise<Found[]>} */
async function elevenlabs(key) {
  const body = await json('https://api.elevenlabs.io/v2/voices?category=premade&page_size=100', { 'xi-api-key': key });
  return (body.voices ?? []).map((/** @type {any} */ v) => {
    const [name, ...rest] = str(v.name).split(/\s+-\s+/);
    const labels = v.labels ?? {};
    const tags = [...rest.join(' - ').split(',').map(str), words(labels.use_case)].filter(Boolean);
    return {
      voice: {
        provider: 'elevenlabs', id: str(v.voice_id), name: name || str(v.voice_id), description: str(v.description) || null,
        gender: sex(labels.gender), age: ageOf(labels.age), language: str(labels.language) || null, accent: words(labels.accent) || null,
        tags: [...new Set(tags)], sample: null,
      },
      fetch: () => (v.preview_url ? bytes(v.preview_url) : Promise.resolve(null)),
    };
  });
}

/** Inworld's own voices (its system voices); a sample is asked for each, a few a second (its limit is lower). @param {string} key @returns {Promise<Found[]>} */
async function inworld(key) {
  const auth = { authorization: `Basic ${key}` };
  const body = await json(`https://api.inworld.ai/voices/v1/voices?pageSize=2000&filter=${encodeURIComponent('source="SYSTEM"')}`, auth);
  return (body.voices ?? []).map((/** @type {any} */ v) => ({
    voice: {
      provider: 'inworld', id: str(v.voiceId), name: str(v.displayName) || str(v.voiceId), description: str(v.description) || null,
      gender: sex(v.gender), age: ageOf(v.ageGroup), language: str(v.languageCode) || null, accent: null,
      tags: (Array.isArray(v.tags) ? v.tags : []).map(words).filter(Boolean), sample: null,
    },
    fetch: async () => {
      await sleep(350);
      const said = await json(`https://api.inworld.ai/tts/v1/voice:preview?voice_id=${encodeURIComponent(str(v.voiceId))}&model_id=inworld-tts-2`, auth).catch(() => null);
      return typeof said?.audioContent === 'string' ? new Uint8Array(Buffer.from(said.audioContent, 'base64')) : null;
    },
  }));
}

/** Cartesia's public voices that it gives a sample of. @param {string} key @returns {Promise<Found[]>} */
async function cartesia(key) {
  const auth = { authorization: `Bearer ${key}`, 'cartesia-version': '2026-08-14' };
  /** @type {any[]} */
  const all = [];
  for (let after = ''; ;) {
    const body = await json(`https://api.cartesia.ai/voices?limit=100&is_owner=false&expand[]=preview_file_url${after ? `&starting_after=${after}` : ''}`, auth);
    all.push(...(body.data ?? []));
    if (!body.has_more || !body.next_page) break;
    after = body.next_page;
  }
  return all.filter((v) => v.preview_file_url && v.access === 'public').map((v) => {
    const native = (Array.isArray(v.accents) ? v.accents : []).find((/** @type {any} */ a) => a?.is_native);
    return {
      voice: {
        provider: 'cartesia', id: str(v.id), name: str(v.name) || str(v.id), description: str(v.description) || null,
        gender: sex(v.gender), age: null, language: str(native?.locale) || str(v.language) || null, accent: words(native?.accent) || null,
        tags: str(v.tagline) ? [str(v.tagline)] : [], sample: null,
      },
      fetch: () => bytes(v.preview_file_url, auth),
    };
  });
}

const LISTS = { elevenlabs: [elevenlabs, 'ELEVENLABS_API_KEY'], inworld: [inworld, 'INWORLD_API_KEY'], cartesia: [cartesia, 'CARTESIA_API_KEY'] };

/** The sample made small: one channel, 64 kbps AAC, its first seconds. @param {Uint8Array} raw @param {string} out */
function small(raw, out) {
  const tmp = `${out}.in`;
  writeFileSync(tmp, raw);
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-t', String(SAMPLE_SECONDS), '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out]);
  } finally { rmSync(tmp, { force: true }); }
}

const before = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { voices: [] };
/** @type {Voice[]} */
const voices = [];
for (const provider of PROVIDERS) {
  const [list, env] = /** @type {[(key: string) => Promise<Found[]>, string]} */ (LISTS[/** @type {keyof typeof LISTS} */ (provider.id)]);
  const key = process.env[env];
  if (!key) {
    const kept = before.voices.filter((/** @type {Voice} */ v) => v.provider === provider.id);
    console.log(`${provider.name}: no ${env}, ${kept.length} voices kept as they were`);
    voices.push(...kept);
    continue;
  }
  const found = (await list(key)).filter((f) => f.voice.id).sort((a, b) => a.voice.name.localeCompare(b.voice.name));
  mkdirSync(join(LIBRARY, 'voices', provider.id), { recursive: true });
  let made = 0;
  for (const { voice, fetch: sample } of found) {
    const rel = `voices/${provider.id}/${fileName(voice.id)}.m4a`;
    const file = join(LIBRARY, rel);
    if (!existsSync(file)) {
      const raw = await sample().catch(() => null);
      if (raw?.length) { small(raw, file); made++; }
    }
    if (existsSync(file)) voice.sample = rel;
    voices.push(voice);
  }
  console.log(`${provider.name}: ${found.length} voices, ${made} samples made, ${found.filter((f) => f.voice.sample).length} with a sample`);
}

writeFileSync(OUT, `${JSON.stringify({ version: 1, providers: PROVIDERS, voices }, null, 1)}\n`);
console.log(`${voices.length} voices → ${OUT}`);
