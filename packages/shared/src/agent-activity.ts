/**
 * What an agent did → one line a person can read.
 *
 * Most people who use the product do not write code, and an agent's raw tool calls (names, arguments, paths) read as
 * an IDE's log, not as their film being made. So the chat gets a **closed set** of actions, defined here, never the
 * tool's name and arguments:
 *
 *   ① `act` is closed: anything not recognized is `working`. A new tool shows as "working" until someone maps it.
 *   ② `query` is **picked out**, never the arguments passed through: only a picture's description, the line a
 *      voice-over says, a search's words. Output names, paths and other values are not shown.
 *
 * It is a projection, computed when it is shown, so changing a line here changes every past conversation too.
 */

/** The actions a person sees. A closed set: each one needs its line in the UI (i18n `act.*`). */
export const AGENT_ACTS = [
  /* Looking at the film as it is now. */
  'film.review',
  'film.check',
  'film.frames',
  'film.hear',
  /* Changing the picture; `film.arrange` is film.json, putting pictures and sound on the timeline. */
  'film.arrange',
  'scene.write',
  'scene.edit',
  /* Sound: transcribe, pick a voice, voice-over, sound effects, music, translate. */
  'audio.transcribe',
  'audio.voice',
  'audio.narrate',
  'audio.sfx',
  'audio.music',
  'audio.translate',
  /* Media. These may cost money, so they are always shown. */
  'asset.searchImage',
  'asset.genImage',
  'asset.genVideo',
  /* Research. */
  'research.search',
  'research.read',
  /* A local agent (Codex, Claude Code) working in the person's own project folder. publicActivity never yields these. */
  'files.read',
  'files.search',
  'files.edit',
  'command.run',
  /* Asking the person a question (see publicAsk): only the question and its options are shown. */
  'chat.ask',
  /* Anything not recognized (rule ① above). */
  'working',
] as const;

export type AgentAct = (typeof AGENT_ACTS)[number];

/** The most an action's visible text (search words, a picture's description) may say. */
export const AGENT_ACT_QUERY_MAX = 60;

export interface AgentActivity {
  act: AgentAct;
  /** Only media and research actions have one. */
  query?: string;
}

/** An action the chat does not show: null means no row. */
const HIDDEN = null;

/**
 * A tool call → a visible action, or null (no row). Pure: the live stream and the saved history both use it, so a
 * reload shows exactly what the live view showed.
 */
export function publicActivity(name: string, args: unknown): AgentActivity | null {
  const input = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const activity = toolActivity(hostedToolName(name), input);
  return activity === undefined ? { act: 'working' } : activity;
}

/**
 * An MCP client names a tool with its server (`mcp__openfilm__audio_sfx`): stripped to the tool's own name before it
 * is recognized; one not recognized is `working`.
 */
function hostedToolName(name: string): string {
  return name.replace(/^mcp__[a-z0-9-]+?(?:__|\.)/i, '');
}

/**
 * A tool (one thing per tool, structured arguments) → its action.
 *
 * The visible text is only "what this one is": a picture's or sound's description, the line a voice-over says, the
 * search's words. Output names, paths, seconds and voice ids are never shown. undefined: not one of these tools.
 */
function toolActivity(tool: string, input: Record<string, unknown>): AgentActivity | null | undefined {
  const text = (key: string): { query?: string } => {
    const value = str(input[key]);
    const query = value && !looksLikePath(value) ? clipQuery(value) : undefined;
    return query ? { query } : {};
  };
  switch (tool) {
    case 'look':
      if (input.sound === true) return { act: 'film.hear' };
      return typeof input.at === 'number' || typeof input.src === 'string'
        ? { act: 'film.frames' }
        : { act: 'film.review' };
    case 'check':
    case 'compile': return { act: 'film.check' };
    case 'audio_voice': return { act: 'audio.voice' };
    case 'audio_tts': return { act: 'audio.narrate', ...text('text') };
    case 'audio_sfx': return { act: 'audio.sfx', ...text('prompt') };
    case 'audio_music': return { act: 'audio.music', ...text('prompt') };
    case 'audio_asr': return { act: 'audio.transcribe' };
    case 'audio_translate': return { act: 'audio.translate' };
    case 'image_search': return { act: 'asset.searchImage', ...(input.query !== undefined ? text('query') : text('prompt')) };
    case 'image_gen': return { act: 'asset.genImage', ...text('prompt') };
    case 'video_gen': return { act: 'asset.genVideo', ...text('prompt') };
    case 'web_search': return { act: 'research.search', ...text('query') };
    case 'web_fetch': return { act: 'research.read' };
    case 'ask_user': return { act: 'chat.ask', ...text('question') };
    /* reading its own transcripts: not shown */
    case 'transcript_read':
    case 'transcript_words':
      return HIDDEN;
    default:
      return undefined;
  }
}

/**
 * The question an agent stops to ask, shown as a card of options. Picked out like `query`: the question, each option's
 * label and description, each clipped; nothing else of the arguments.
 */
export interface AgentAsk {
  question: string;
  options: Array<{ label: string; description?: string }>;
  /** The person's answer, when one came in this turn. */
  answer?: string;
  /** How it ended; absent while it waits. */
  status?: 'answered' | 'skipped' | 'timeout';
}

/** The longest answer (the tool clips at the same length). */
export const AGENT_ASK_ANSWER_MAX = 2000;

/**
 * ask_user's result → the answer. Its first line is `{"answer": …, "via": "option" | "text" | "skipped" | "timeout"}`;
 * the rest is a note for the agent and is not shown.
 */
export function askOutcome(resultText: string | undefined): Pick<AgentAsk, 'answer' | 'status'> | null {
  const first = (resultText ?? '').trim().split('\n')[0] ?? '';
  if (!first.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(first) as { answer?: unknown; via?: unknown };
    if (typeof parsed.answer === 'string' && parsed.answer.trim()) {
      return { answer: parsed.answer.trim().slice(0, AGENT_ASK_ANSWER_MAX), status: 'answered' };
    }
    if (parsed.via === 'timeout') return { status: 'timeout' };
    if (parsed.via === 'skipped') return { status: 'skipped' };
    return null;
  } catch {
    return null;
  }
}

export const AGENT_ASK_QUESTION_MAX = 240;
export const AGENT_ASK_LABEL_MAX = 60;
export const AGENT_ASK_DESCRIPTION_MAX = 140;
export const AGENT_ASK_OPTIONS_MAX = 4;

function clipText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const one = value.replace(/\s+/g, ' ').trim();
  if (!one) return undefined;
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * `ask_user`'s arguments → the card; null for another tool or an empty question. With the result, the answer too (a
 * past conversation shows what was asked and what was answered).
 */
export function publicAsk(name: string, args: unknown, resultText?: string): AgentAsk | null {
  if (hostedToolName(name) !== 'ask_user') return null;
  const input = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const question = clipText(input.question, AGENT_ASK_QUESTION_MAX);
  if (!question) return null;
  const options = (Array.isArray(input.options) ? input.options : [])
    .map((raw) => {
      const option = (raw && typeof raw === 'object' ? raw : { label: raw }) as Record<string, unknown>;
      const label = clipText(option.label, AGENT_ASK_LABEL_MAX);
      const description = clipText(option.description, AGENT_ASK_DESCRIPTION_MAX);
      return label ? { label, ...(description ? { description } : {}) } : null;
    })
    .filter((option): option is AgentAsk['options'][number] => option != null)
    .slice(0, AGENT_ASK_OPTIONS_MAX);
  const outcome = resultText ? askOutcome(resultText) : null;
  return { question, options, ...(outcome ?? {}) };
}

export interface AgentActAsset {
  kind: 'image' | 'audio' | 'video';
  /** The media's path in the project (`assets/…`); no other shape is shown. */
  src: string;
  /** Seconds; audio and video only. */
  dur?: number;
}

const ASSET_SRC = /^assets\/(?!.*\.\.)[\w\-./ ]{1,200}\.(png|jpe?g|webp|gif|avif|mp3|m4a|wav|ogg|aac|flac|mp4|webm|mov)$/i;
/** The tools whose receipts carry made media (names without a client's prefix). */
export const ASSET_PRODUCING_TOOLS = ['image_gen', 'audio_tts', 'audio_sfx', 'audio_music', 'video_gen'] as const;
const PRODUCING_TOOLS = new Set<string>(ASSET_PRODUCING_TOOLS);

/** Only these tools' receipts are read for made media. */
export function producesAsset(name: string): boolean {
  return PRODUCING_TOOLS.has(hostedToolName(name));
}

/**
 * A tool call's receipt → the media it made, or null. Picked out like `publicActivity`: only for the tools that make
 * media, only the receipt's `src` (a media file under `assets/`) and its duration; nothing else of the receipt.
 */
export function publicActivityResult(name: string, resultText: string | undefined, isError = false): AgentActAsset | null {
  if (isError || !resultText || !producesAsset(name)) return null;
  let receipt: unknown;
  try {
    // Archived tool output appends image references after the JSON receipt.
    // They identify the same image; they must not hide its public preview.
    receipt = JSON.parse(resultText.trim().replace(/(?:\s*\[image:[a-f0-9]{64}\])+\s*$/i, '').trim());
  } catch {
    return null;
  }
  let row = (Array.isArray(receipt) ? receipt[0] : receipt) as Record<string, unknown> | undefined;
  /* image tools answer `{ images: [{ src, width, height }] }`: the first one */
  if (row && typeof row.src !== 'string' && Array.isArray(row.images)) row = row.images[0] as Record<string, unknown> | undefined;
  const src = row && typeof row.src === 'string' ? row.src.replace(/^\.\//, '') : '';
  if (!ASSET_SRC.test(src)) return null;
  const ext = src.split('.').pop()!.toLowerCase();
  const kind: AgentActAsset['kind'] = /^(mp3|m4a|wav|ogg|aac|flac)$/.test(ext) ? 'audio'
    : /^(mp4|webm|mov)$/.test(ext) ? 'video' : 'image';
  const dur = typeof row!.dur === 'number' && Number.isFinite(row!.dur) && row!.dur > 0
    ? Math.round(row!.dur * 100) / 100 : undefined;
  return { kind, src, ...(dur !== undefined && kind !== 'image' ? { dur } : {}) };
}

function looksLikePath(text: string): boolean {
  if (/^[.~/]/.test(text)) return true;
  return text.includes('/') && /\.[a-z0-9]{2,4}$/i.test(text);
}

function clipQuery(raw: string): string | undefined {
  const flat = raw
    // A leading `some_identifier:` is a prompt's protocol prefix, not the picture (ASCII identifiers only).
    .replace(/^[a-z][a-z0-9_]*:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return undefined;
  if (flat.length <= AGENT_ACT_QUERY_MAX) return flat;
  return `${flat.slice(0, AGENT_ACT_QUERY_MAX - 1)}…`;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
