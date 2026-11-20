// @ts-check
/** Doubao's public TTS 2.0 catalog and the recordings published by Volcengine and BytePlus. */
import { DOUBAO_SAMPLES, doubaoSampleUrl } from '../studio/server/providers/doubao-samples.mjs';

export const DOUBAO_TONES = 'https://docs.volcengine.com/docs/zh/doubao-voice/tone-list-3.md';
export const BYTEPLUS_TONES = 'https://docs.byteplus.com/docs/en/byteplusvoice/tts-voice-list.md';

const plain = (/** @type {string} */ value) => value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(?:<br\s*\/?\s*>\s*)+/gi, '；').replace(/[\u200b\ufeff*`]/g, '').replace(/\\-/g, '-').trim();

/** Only TTS 2.0's two tables; realtime S2S and TTS 1.0 voices require different models.
 * @param {string} markdown */
export function parseDoubaoVoices(markdown) {
  const main = markdown.split(/^## /m).filter((section) => section.split('\n')[0].includes('豆包语音合成模型2.0')).join('\n');
  if (!main) throw new Error('Doubao did not return its TTS 2.0 voice tables. The existing catalog was kept.');
  const found = new Map();
  for (const row of main.split('\n')) {
    if (!row.startsWith('|')) continue;
    const cells = row.split('|').slice(1, -1).map(plain);
    const [scene, name, id, languages] = cells;
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !name || ['voice_type', '---'].includes(id)) continue;
    const native = id.match(/(?:^|_)(zh|en|ja|ko|es|fr|de|id|pt|it|th|vi|ru|fil|tl|mx|ms|ar|pl|tr|sv|nl|no|uk|fi|da|cs|hu|el|ro|hi)_/)?.[1] ?? null;
    const language = native === 'tl' ? 'fil' : native === 'mx' ? 'es-MX' : native;
    const tags = [...new Set([...(scene ?? '').split(/[,，]/), ...cells.slice(4).flatMap((c) => c.split(/[,，、；]/))].map((s) => s.trim()).filter(Boolean))];
    found.set(id, { provider: 'doubao', id, name, language,
      gender: /(?:^|_)female_/.test(id) ? /** @type {const} */ ('f') : /(?:^|_)male_/.test(id) ? /** @type {const} */ ('m') : null,
      age: null, accent: null, description: [languages, ...cells.slice(4)].filter(Boolean).join(' · ') || null,
      tags, sample: /** @type {string | null} */ (null), sampleSource: /** @type {string | null} */ (null), featured: false, uses: null });
  }
  if (!found.size) throw new Error('Doubao returned no TTS 2.0 voices. The existing catalog was kept.');
  return [...found.values()];
}

/** BytePlus embeds audio and its exact voice ID in the same table row. @param {string} markdown */
function bytePlusSamples(markdown) {
  const samples = new Map();
  for (const row of markdown.split('\n')) {
    if (!row.startsWith('|')) continue;
    const [, audio, , , , , speaker] = row.split('|');
    const id = plain((speaker ?? '').replace(/<[^>]*>/g, ' ')).split(/\s+/, 1)[0];
    const source = audio?.match(/<audio\b[^>]*\bsrc="([^"]+)"/i)?.[1];
    const url = source ? doubaoSampleUrl(source) : null;
    if (url && /^[\w-]+$/.test(id) && !samples.has(id)) samples.set(id, url);
  }
  if (!samples.size) throw new Error('BytePlus did not return a voice sample table. The existing catalog was kept.');
  return samples;
}

/** @param {typeof fetch} request @param {string} url */
async function documentation(request, url) {
  const res = await request(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Voice documentation at ${url} answered ${res.status}. The existing catalog was kept.`);
  return res.text();
}

/** Only a confirmed miss can lead to synthesis. Retry transient CDN errors during a refresh.
 * @param {typeof fetch} request @param {string} url */
async function hasSample(request, url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await request(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (res.status === 404 || res.status === 410) return false;
      if (res.ok && /^audio\//i.test(res.headers.get('content-type') ?? '')) return true;
      throw new Error(`Sample returned ${res.status} (${res.headers.get('content-type') ?? 'no content type'}).`);
    } catch (cause) {
      if (attempt === 2) throw new Error(`Could not check ${url}. The existing catalog was kept.`, { cause });
      await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
    }
  }
}

/** Refresh without credentials. Check both providers' public sources before handing missing voices to synthesis.
 * @param {typeof fetch} [request] */
export async function doubaoVoices(request = fetch) {
  const [volcengine, bytePlus] = await Promise.all([documentation(request, DOUBAO_TONES), documentation(request, BYTEPLUS_TONES)]);
  const voices = parseDoubaoVoices(volcengine);
  const samples = bytePlusSamples(bytePlus);
  let next = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (next < voices.length) {
      const voice = voices[next++];
      const base = `${DOUBAO_SAMPLES}${voice.id}`;
      const candidates = [`${base}.mp3`, `${base}.wav`];
      const international = samples.get(voice.id);
      if (international) candidates.push(international);
      for (const url of candidates) {
        if (!await hasSample(request, url)) continue;
        voice.sample = `voices/doubao/${voice.id}${url.slice(-4)}`;
        voice.sampleSource = url;
        break;
      }
    }
  }));
  return voices;
}
