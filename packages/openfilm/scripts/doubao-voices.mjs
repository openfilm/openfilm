// @ts-check
/** Doubao's public TTS 2.0 catalog. The official documentation includes both the main and multilingual tables.
 * Preview files are public provider recordings, never paid synthesis with somebody's API key.
 * https://docs.volcengine.com/docs/doubao-voice/tone-list-3?lang=zh
 * CDN layout: the official voice-tech/tts site's @speechfe/portal-components voice list.
 */
export const DOUBAO_TONES = 'https://docs.volcengine.com/docs/zh/doubao-voice/tone-list-3.md';
export const DOUBAO_SAMPLES = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/lm_hz_ihsph/ljhwZthlaukjlkulzlp/portal/bigtts/';

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

/** Refreshable without credentials. HEAD verifies actual samples; missing recordings remain explicitly absent.
 * @param {typeof fetch} [request] */
export async function doubaoVoices(request = fetch) {
  const res = await request(DOUBAO_TONES, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Doubao voice documentation answered ${res.status}.`);
  const voices = parseDoubaoVoices(await res.text());
  let next = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (next < voices.length) {
      const voice = voices[next++];
      for (const ext of ['mp3', 'wav']) {
        const url = `${DOUBAO_SAMPLES}${encodeURIComponent(voice.id)}.${ext}`;
        const sample = await request(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch(() => null);
        if (!sample?.ok || !/^audio\//i.test(sample.headers.get('content-type') ?? '')) continue;
        voice.sample = `voices/doubao/${voice.id}.${ext}`;
        voice.sampleSource = url;
        break;
      }
    }
  }));
  return voices;
}
