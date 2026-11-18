// @ts-check
/**
 * A dialogue of two voices from Doubao Speech's podcast model, which speaks a script given line by line
 * (https://docs.volcengine.com/docs/doubao-voice/podcast-mustread, action 3: one HTTP request, its rounds streamed back
 * as server-sent events). It is voice-over with two voices: `--voice` names both (`a+b`, or given twice), and each line
 * of `--text` is one turn, the voices taking turns from the first, or a line starting `1:` or `2:` says whose it is.
 * The audio comes as 24 kHz PCM, so each turn's start and end are exact; they are the transcript's cues.
 */
import { randomUUID } from 'node:crypto';
import { call, landing, needed, list, serviceUrl, text, wav } from './common.mjs';

/** The model, as OpenFilm names it; Doubao's resource for it. */
export const DIALOGUE_MODEL = 'seed-podcast';
const RESOURCE = 'volc.service_type.10050';
/** Doubao's limits: a turn, and the whole script. */
const TURN = 300;
const SCRIPT = 10_000;

/**
 * The pairs made to speak together (Doubao's own podcast voices); any two Doubao voices also can. Doubao publishes no
 * sample of these voices, so each pair's `sample` is a short dialogue of ours, made with them (library/pairs/).
 */
export const DOUBAO_PAIRS = [
  { id: 'zh_male_liufei_v2_saturn_bigtts+zh_male_xiaolei_v2_saturn_bigtts', name: '刘飞 & 潇磊', language: 'zh',
    members: [{ id: 'zh_male_liufei_v2_saturn_bigtts', name: '刘飞', gender: 'm' }, { id: 'zh_male_xiaolei_v2_saturn_bigtts', name: '潇磊', gender: 'm' }],
    description: 'Podcast voices · two men talking', sample: 'pairs/liufei-xiaolei.mp3' },
  { id: 'zh_female_mizaitongxue_v2_saturn_bigtts+zh_male_dayixiansheng_v2_saturn_bigtts', name: '咪仔 & 大意先生', language: 'zh',
    members: [{ id: 'zh_female_mizaitongxue_v2_saturn_bigtts', name: '咪仔', gender: 'f' }, { id: 'zh_male_dayixiansheng_v2_saturn_bigtts', name: '大意先生', gender: 'm' }],
    description: 'Podcast voices · a woman and a man', sample: 'pairs/mizai-dayi.mp3' },
];

/** The two voices of a run's `--voice` (`a+b`, or two given), or null for one voice. */
export function pairOf(/** @type {unknown} */ voice) {
  const ids = list(voice).flatMap((v) => v.split('+')).map((v) => v.trim()).filter(Boolean);
  return ids.length === 2 ? /** @type {[string, string]} */ (ids) : null;
}

/**
 * The script's turns: each line one, `1:`/`2:` (or `1：`) saying whose, else the other voice from the one before.
 * @param {string} script @returns {{ who: 0 | 1, text: string }[]}
 */
export function turnsOf(script) {
  /** @type {{ who: 0 | 1, text: string }[]} */
  const turns = [];
  for (const line of script.split(/\r?\n/)) {
    const named = /^\s*([12])\s*[:：]\s*/.exec(line);
    const said = (named ? line.slice(named[0].length) : line).trim();
    if (!said) continue;
    const who = /** @type {0 | 1} */ (named ? Number(named[1]) - 1 : turns.length ? 1 - turns[turns.length - 1].who : 0);
    turns.push({ who, text: said });
  }
  if (!turns.length) throw new Error('--text: write the dialogue, one turn a line.');
  const long = turns.findIndex((t) => [...t.text].length > TURN);
  if (long >= 0) throw new Error(`--text: line ${long + 1} has more than ${TURN} characters, the most one turn takes. Split it into two lines starting with the same "${turns[long].who + 1}:".`);
  if (turns.reduce((n, t) => n + [...t.text].length, 0) > SCRIPT) throw new Error(`--text: the dialogue has more than ${SCRIPT} characters. Make it in parts.`);
  return turns;
}

/** The token counts Doubao reported, as { text, audio }: summed over its usage events. @param {any[]} usages */
export function usageOf(usages) {
  let textTokens = 0, audio = 0, any = false;
  for (const usage of usages) {
    for (const [key, value] of Object.entries(usage && typeof usage === 'object' ? usage : {})) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const k = key.toLowerCase();
      if (/audio/.test(k) && /out/.test(k)) { audio += value; any = true; }
      else if (/text/.test(k) && /in/.test(k)) { textTokens += value; any = true; }
    }
  }
  return any ? { text: textTokens, audio } : null;
}

/** @param {Record<string, unknown>} args @param {import('./contract.mjs').RunContext} ctx */
export async function doubaoDialogue(args, ctx) {
  const pair = pairOf(args.voice);
  if (!pair) throw new Error('--voice: a dialogue takes two voices, as "a+b" or --voice given twice.');
  const turns = turnsOf(needed(args, 'text'));
  const requestId = randomUUID();
  const res = await call('Doubao', serviceUrl('DOUBAO_PODCAST', 'https://openspeech.bytedance.com/api/v3/podcast/sse'), {
    method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json', 'X-Api-Key': ctx.key, 'X-Api-Resource-Id': RESOURCE, 'X-Api-Request-Id': requestId },
    /* no intro or outro music: a dialogue in a film is its lines (Doubao adds 7 s of intro music unless told not to) */
    body: JSON.stringify({ action: 3, use_head_music: false, use_tail_music: false, nlp_texts: turns.map((t) => ({ speaker: pair[t.who], text: t.text })),
      audio_config: { format: 'pcm', sample_rate: 24000 } }),
  }, ctx);
  if (!res.body) throw new Error('Doubao returned no dialogue stream.');

  /** @type {Buffer[]} */
  const pcm = [];
  let bytes = 0;
  /** @type {{ voice: string, text: string, start: number, end: number }[]} */
  const lines = [];
  /** @type {{ voice: string, text: string, at: number } | null} */
  let round = null;
  /** @type {unknown[]} */
  const usages = [];
  let finished = false;
  /** @param {string} event @param {string} data */
  const take = (event, data) => {
    /** @type {any} */
    let body = {};
    try { body = data ? JSON.parse(data) : {}; } catch { throw new Error(`Doubao sent an unreadable dialogue event (${event}). Request: ${requestId}.`); }
    const payload = body.payload ?? body;
    if (event === '153') throw new Error(`Doubao could not make it: ${text(body.message) || text(payload.message) || body.code || 'the dialogue failed'}. Request: ${requestId}.`);
    if (event === '151') throw new Error(`Doubao canceled the dialogue. Request: ${requestId}.`);
    /* a music round (intro, outro) has no speaker: its audio is kept, it is no line */
    if (event === '360') round = text(payload.speaker) ? { voice: text(payload.speaker), text: text(payload.text), at: bytes } : null;
    else if (event === '361' && typeof body.data === 'string') {
      const chunk = Buffer.from(body.data, 'base64');
      pcm.push(chunk); bytes += chunk.length;
      if (bytes > 400 << 20) throw new Error('Doubao audio exceeded 400 MB.');
    } else if (event === '362' && round) {
      if (payload.is_error) throw new Error(`Doubao could not speak line ${lines.length + 1}. Request: ${requestId}.`);
      lines.push({ voice: round.voice, text: round.text, start: round.at / 48000, end: bytes / 48000 });
      round = null;
    } else if (event === '154' && payload.usage) usages.push(payload.usage);
    else if (event === '152') {
      const code = body.code ?? payload.code;
      if (code !== undefined && code !== 20000000 && code !== '20000000') throw new Error(`Doubao could not make it (${code}). Request: ${requestId}.`);
      finished = true;
    }
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  /* a message is the lines up to a blank one: its `event:` and its `data:` lines; a comment (`:keep-alive`) is skipped */
  const message = (/** @type {string} */ block) => {
    let event = '';
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (event) take(event, data.join('\n'));
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const blocks = pending.split(/\r?\n\r?\n/); pending = blocks.pop() ?? '';
      for (const block of blocks) message(block);
    }
    pending += decoder.decode();
    if (pending.trim()) message(pending);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!finished) throw Object.assign(new Error(`Doubao's dialogue ended before it said it was done. Request: ${requestId}.`), { mediaUncertain: true });
  if (!pcm.length) throw new Error(`Doubao returned no audio. Request: ${requestId}.`);
  const audio = wav(new Uint8Array(Buffer.concat(pcm)), 24000);
  const dur = Math.round(bytes / 48000 * 1000) / 1000;
  const path = landing('audio/vo', args.out, 'wav');
  const said = turns.map((t) => t.text).join('\n');
  const voice = pair.join('+');
  const round3 = (/** @type {number} */ s) => Math.round(s * 1000) / 1000;
  /* each turn is a cue of the transcript: its words as one, from where its audio starts to where it ends */
  const words = lines.map((l) => ({ token: l.text, start: round3(l.start), end: round3(l.end) }));
  const usage = usageOf(usages);
  return {
    files: [{ path, bytes: audio }],
    index: [{ src: path, kind: 'audio', dur, text: said, voice, ...(words.length ? { words } : {}),
      lines: lines.map((l) => ({ voice: l.voice, text: l.text, start: round3(l.start), end: round3(l.end) })),
      from: { mode: 'synth', provider: 'doubao', model: DIALOGUE_MODEL, voice, text: said } }],
    receipt: { provider: 'doubao', model: DIALOGUE_MODEL, src: path, dur, voice, lines: lines.length, requestId,
      ...(usage ? { tokens: usage } : {}) },
    cost: { note: 'billed by Doubao to your key' },
  };
}
