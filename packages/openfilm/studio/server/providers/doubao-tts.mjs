// @ts-check
/** Doubao Speech's HTTP TTS v3 (TTS 2.0) with its stock voices. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { billedBy, call, landing, needed, serviceUrl, wav, wavSeconds } from './common.mjs';

/** `dialogue`: the model that speaks two voices taking turns (doubao-dialogue.mjs); a run with two voices takes it. */
export const DOUBAO_TTS_MODELS = [
  { id: 'seed-tts-2.0', name: 'Doubao TTS 2.0' },
  { id: 'seed-podcast', name: 'Doubao Podcast · two voices', dialogue: true },
];
/**
 * The same complete stock catalog the resource library shows, refreshed by scripts/library-voices.mjs. Where the
 * providers run without the library beside them (OpenFilm's service ships this folder alone), none: the person's
 * Studio has the catalog, and a voice's language is then the text's own.
 */
export const DOUBAO_VOICES = /** @type {{ provider: string, id: string, name: string, language: string | null, gender: string | null, description: string | null }[]} */ ((() => {
  try { return JSON.parse(readFileSync(new URL('../../../library/voices.json', import.meta.url), 'utf8')).voices.filter((/** @type {{ provider: string }} */ v) => v.provider === 'doubao'); }
  catch { return []; }
})());

/** @param {Record<string, unknown>} args @param {import('./contract.mjs').RunContext} ctx */
export async function doubaoTts(args, ctx) {
  const said = needed(args, 'text');
  const voice = needed(args, 'voice');
  const model = ctx.model ?? 'seed-tts-2.0';
  if (!DOUBAO_TTS_MODELS.some((m) => m.id === model && !m.dialogue)) throw new Error('Choose a Doubao Speech TTS model.');
  const requestId = randomUUID();
  const language = String(args.language || DOUBAO_VOICES.find((v) => v.id === voice)?.language || '').toLowerCase();
  const subtitles = (!language || /^(zh|en)(-|$)/.test(language)) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(said);
  const res = await call('Doubao', serviceUrl('DOUBAO_TTS', 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'), {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'X-Api-Key': ctx.key,
      'X-Api-Resource-Id': model, 'X-Api-Request-Id': requestId },
    body: JSON.stringify({ req_params: { text: said, speaker: voice,
      audio_params: { format: 'pcm', sample_rate: 24000, ...(subtitles ? { enable_subtitle: true } : {}) } } }),
  }, ctx);
  /** @type {Buffer[]} */
  const pcm = [];
  /** @type {{ token: string, start: number, end: number }[]} */
  const words = [];
  const seen = new Set();
  let pending = '';
  let bytesSeen = 0;
  const consume = (/** @type {string} */ line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.code !== 0 && event.code !== 20000000) throw new Error(`Doubao synthesis failed (${event.code ?? 'unknown'}). Request: ${requestId}.`);
    if (typeof event.data === 'string' && event.data) pcm.push(Buffer.from(event.data, 'base64'));
    for (const w of event.sentence?.words ?? []) {
      if (typeof w.word !== 'string' || !w.word.trim() || !Number.isFinite(w.startTime) || !Number.isFinite(w.endTime) || w.startTime < 0 || w.endTime < w.startTime) continue;
      const key = `${w.startTime}/${w.endTime}/${w.word}`;
      if (!seen.has(key)) { words.push({ token: w.word, start: w.startTime, end: w.endTime }); seen.add(key); }
    }
  };
  if (!res.body) throw new Error('Doubao returned no audio stream.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesSeen += value.byteLength;
      if (bytesSeen > 100 << 20) throw new Error('Doubao audio exceeded 100 MB.');
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n'); pending = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }
    pending += decoder.decode();
    consume(pending);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!pcm.length) throw new Error('Doubao returned no audio.');
  const bytes = wav(new Uint8Array(Buffer.concat(pcm)), 24000);
  const dur = wavSeconds(bytes);
  const path = landing('audio/vo', args.out, 'wav');
  const timed = words.filter((w) => dur !== null && w.end <= dur + 0.15).sort((a, b) => a.start - b.start);
  return { files: [{ path, bytes }], index: [{ src: path, kind: 'audio', dur, text: said, voice, ...(timed.length ? { words: timed } : {}),
    from: { mode: 'synth', provider: 'doubao', model, voice, text: said } }],
    receipt: { provider: 'doubao', model, src: path, dur, voice, words: timed.length, requestId }, cost: billedBy('Doubao') };
}
