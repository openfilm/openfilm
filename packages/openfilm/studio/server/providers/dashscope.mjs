// @ts-check
/** Alibaba Cloud Model Studio's native Qwen Audio ASR API, with word timings for Studio's transcripts. */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { billedBy, mediaSeconds, modelOf, needed, serviceUrl } from './common.mjs';
import { fileTranscription } from './dashscope-filetrans.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider */
/** @typedef {{ token: string, start: number, end: number }} Word */
/** @typedef {{ start: number, end: number, from: number, to: number }} Window */
/** @typedef {{ text: string, begin_time: number, end_time: number, punctuation?: string, fixed?: boolean }} QwenWord */
/** @typedef {{ sentence_id: number, sentence_end: boolean, words?: QwenWord[] }} Sentence */
/** @typedef {{ code?: string, output?: { text?: string, sentence?: Sentence, sentences?: Sentence[] } }} Event */

const NAME = 'Alibaba Cloud Model Studio';
const MODELS = { asr: [
  { id: 'qwen-audio-3.1-asr-flash', name: 'Qwen Audio 3.1 ASR Flash' },
  { id: 'qwen-audio-3.0-asr-flash', name: 'Qwen Audio 3.0 ASR Flash' },
  { id: 'qwen-audio-3.1-asr-flash-filetrans', name: 'Qwen Audio 3.1 ASR Flash Filetrans' },
  { id: 'qwen-audio-3.0-asr-flash-filetrans', name: 'Qwen Audio 3.0 ASR Flash Filetrans' },
  { id: 'qwen3-asr-flash-filetrans', name: 'Qwen3 ASR Flash Filetrans' },
] };
const API_LIMIT_SECONDS = 300;
const CORE_SECONDS = 285;
const OVERLAP_SECONDS = 2;
const ffmpeg = promisify(execFile);

/** Workspace keys can be paired with their native API host as `<host>:<key>`, like Azure's region and key. */
function credentials(/** @type {string} */ raw) {
  const colon = raw.indexOf(':');
  const key = colon < 0 ? raw : raw.slice(colon + 1);
  const base = colon < 0 ? serviceUrl('DASHSCOPE', 'https://dashscope.aliyuncs.com/api/v1')
    : `https://${raw.slice(0, colon)}/api/v1`;
  const url = new URL(base);
  const publicHost = /^dashscope(?:-intl|-us)?\.aliyuncs\.com$/.test(url.hostname);
  const workspace = /^[a-z0-9-]+\.(?:cn|ap|us)-[a-z0-9-]+\.maas\.aliyuncs\.com$/.test(url.hostname);
  if (url.protocol !== 'https:' || (!publicHost && !workspace) || url.port || url.username || url.password
      || url.search || url.hash || url.pathname.replace(/\/+$/, '') !== '/api/v1') {
    throw new Error('Use a DashScope HTTPS API host or its native /api/v1 address.');
  }
  if (!/^[a-z0-9._-]{8,}$/i.test(key)) throw new Error('Enter a valid DashScope API key.');
  return { key, url: new URL('/api/v1/services/aigc/multimodal-generation/generation', url) };
}

/** The nonoverlapping cores own the words; overlapping audio gives the recognizer context across each cut. */
export function speechWindows(/** @type {number} */ duration) {
  if (duration <= API_LIMIT_SECONDS) return [{ start: 0, end: duration, from: 0, to: duration }];
  return Array.from({ length: Math.ceil(duration / CORE_SECONDS) }, (_, i) => {
    const start = i * CORE_SECONDS;
    const end = Math.min(duration, start + CORE_SECONDS);
    return { start, end, from: Math.max(0, start - OVERLAP_SECONDS), to: Math.min(duration, end + OVERLAP_SECONDS) };
  });
}

/** Parse both DashScope's native SSE response and its JSON form. The latter is used by some deployments. */
async function eventsOf(/** @type {Response} */ response) {
  try {
    if (!response.headers.get('content-type')?.includes('text/event-stream')) return /** @type {Event[]} */ ([await response.json()]);
    const data = (await response.text()).split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/)
      .filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'));
    return /** @type {Event[]} */ (data.filter(line => line && line !== '[DONE]').map(line => JSON.parse(line)));
  } catch {
    throw new Error('DashScope returned an unreadable transcription response.');
  }
}

/** A sentence can arrive repeatedly. Keep its final word timings and ignore interim revisions. */
async function transcribe(/** @type {Uint8Array} */ audio, /** @type {string} */ model, /** @type {ReturnType<typeof credentials>} */ auth,
  /** @type {AbortSignal} */ signal, /** @type {Window} */ span) {
  const response = await fetch(auth.url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    headers: { Authorization: `Bearer ${auth.key}`, 'Content-Type': 'application/json', 'X-DashScope-SSE': 'enable' },
    body: JSON.stringify({
      model,
      input: { messages: [{ role: 'user', content: [{ type: 'input_audio',
        input_audio: { data: 'data:audio/mpeg;base64,' + Buffer.from(audio).toString('base64') } }] }] },
      parameters: { format: 'mp3', sample_rate: '16000' },
    }),
  });
  if (!response.ok) throw new Error(`DashScope transcription failed (HTTP ${response.status}).`);

  const events = await eventsOf(response);
  const sentences = /** @type {Map<number, Sentence>} */ (new Map());
  let text = '';
  for (const event of events) {
    if (event.code) throw new Error('DashScope returned a transcription error.');
    const out = event.output;
    if (!out) continue;
    if (typeof out.text === 'string') text = out.text;
    for (const sentence of out.sentences ?? (out.sentence ? [out.sentence] : [])) {
      if (sentence.sentence_end) sentences.set(sentence.sentence_id, sentence);
    }
  }
  const raw = [...sentences.values()].flatMap(sentence => sentence.words ?? []).filter(word =>
    word.fixed !== false && typeof word.text === 'string' && word.text.trim()
    && Number.isFinite(word.begin_time) && Number.isFinite(word.end_time) && word.end_time > word.begin_time);
  if (text.trim() && !raw.length) throw new Error('DashScope returned speech without final word timestamps.');
  const words = raw.map(word => ({
    token: word.text.trim() + (word.punctuation ?? ''),
    start: Math.max(span.from, span.from + word.begin_time / 1000),
    end: Math.min(span.to, span.from + word.end_time / 1000),
  })).filter(word => {
    const middle = (word.start + word.end) / 2;
    return word.end > word.start && middle >= span.start && middle < span.end;
  });
  return { words, text };
}

/** Punctuation and adjacent CJK tokens join without an intervening space. */
function joinWords(/** @type {Word[]} */ words) {
  return words.map(word => word.token).join(' ')
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？、：；]) (?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/gu, '$1')
    .replace(/ (?=[.!?,;:，。！？、：；])/g, '');
}

/** @param {string} src @param {string} model @param {number|null} dur @param {string} text @param {Word[]} words */
function transcript(src, model, dur, text, words) {
  return {
    files: [],
    index: [{ src, dur, text, words, transcribed: true }],
    receipt: { provider: 'dashscope', model, src, dur, text, words: words.length },
    cost: billedBy(NAME),
  };
}

/** @type {Provider} */
export default {
  id: 'dashscope',
  name: NAME,
  env: 'DASHSCOPE_API_KEY',
  keysUrl: 'https://help.aliyun.com/en/model-studio/get-api-key',
  billingUrl: 'https://bailian.console.aliyun.com/',
  pricingUrl: 'https://help.aliyun.com/en/model-studio/model-pricing',
  verbs: ['asr'],
  models: MODELS,
  speechFormat: 'mp3',
  checkKey(key) { credentials(key); },
  async run(verb, args, ctx) {
    if (verb !== 'asr') throw new Error(`${NAME} does not do ${verb}.`);
    const src = needed(args, 'src');
    const model = modelOf(MODELS, 'asr', ctx);
    const auth = credentials(ctx.key);
    if (model.endsWith('-filetrans')) {
      const { dur, text, words } = await fileTranscription(auth, model, src, ctx);
      return transcript(src, model, dur, text, words);
    }
    const audio = await ctx.read(src);
    const dir = await mkdtemp(join(tmpdir(), 'openfilm-dashscope-'));
    try {
      const input = join(dir, 'speech.mp3');
      await writeFile(input, audio, { mode: 0o600 });
      const encoded = await mediaSeconds(dir, 'speech.mp3');
      if (encoded === null) throw new Error('Could not measure the prepared speech for DashScope.');
      const source = ctx.root ? await mediaSeconds(ctx.root, src) : null;
      const dur = Math.min(encoded, source ?? encoded);
      const windows = speechWindows(encoded).filter(span => span.start < dur)
        .map(span => ({ ...span, end: Math.min(span.end, dur), to: Math.min(span.to, dur) }));
      const words = /** @type {Word[]} */ ([]);
      let text = '';
      for (const [i, span] of windows.entries()) {
        if (windows.length > 1) ctx.say(`Transcribing with ${NAME} (${i + 1}/${windows.length}).`);
        const part = encoded <= API_LIMIT_SECONDS ? audio : (await ffmpeg('ffmpeg', ['-nostdin', '-v', 'error',
          '-ss', span.from.toFixed(3), '-i', input, '-t', (span.to - span.from).toFixed(3), '-vn',
          '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', '-f', 'mp3', 'pipe:1'],
        { signal: ctx.signal, windowsHide: true, encoding: 'buffer', maxBuffer: 4 << 20 })).stdout;
        const result = await transcribe(part, model, auth, ctx.signal, span);
        text = result.text;
        words.push(...result.words);
      }
      words.sort((a, b) => a.start - b.start);
      if (windows.length > 1 || !text) text = joinWords(words);
      return transcript(src, model, dur, text, words);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};
