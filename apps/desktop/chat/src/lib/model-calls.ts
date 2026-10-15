/**
 * The requests an agent made to its model in a turn and the answers (the turn's model log, src/chat-store.mjs), whole
 * again: a line keeps only what is new since the request before (`prefix` of that one's messages, then its own;
 * `systemPrompt`, `tools`, `settings`, `source` and `thread` when they changed). The app's own agent (Pi) writes its
 * own; the other agents' are read from their own records (src/agent-records.mjs), or from the logs they are started
 * with in Developer mode (src/agent-logs.mjs).
 *
 * Messages are Pi's: system (its text in `sections`), user (text or parts), assistant (`thinking`, `text` and
 * `toolCall` parts, its usage and why it stopped) and toolResult (`toolCallId`, `toolName`, parts, `isError`); from an
 * agent's record also `context`: what the agent put in by itself (`label` says what, `as` the role it went in as).
 */
type Item = Record<string, any>;

export interface RawCall {
  startedAt: number;
  /** null: the log does not say how long it took (Qwen Code's) */
  ms: number | null;
  prefix: number;
  messages: Item[];
  systemPrompt?: string | null;
  tools?: Item[] | null;
  /** Codex keeps no tool definitions: `tools` is not known, not empty */
  toolsUnknown?: boolean;
  /** the turn's settings as the agent kept them (Codex: model, effort, permissions) */
  settings?: Item | null;
  /** read from this agent's own record */
  source?: { agent: string; file: string } | null;
  /** a subagent's request (Claude Code), named */
  thread?: { id: string; label: string } | null;
  /** what the log this was read from does not have, by name (the turn log says each: turnLog.lacks.<name>) */
  lacks?: string[];
  answer: Item | null;
}

export interface ModelCall {
  no: number;
  startedAt: number;
  ms: number | null;
  systemPrompt: string | null;
  /** every message the model got, in order; from `fresh` on, the ones new in this request */
  messages: Item[];
  fresh: number;
  tools: Item[] | null;
  toolsUnknown: boolean;
  settings: Item | null;
  source: { agent: string; file: string } | null;
  thread: { id: string; label: string } | null;
  lacks: string[];
  answer: Item | null;
}

export function modelCalls(raw: RawCall[]): ModelCall[] {
  let messages: Item[] = [];
  let systemPrompt: string | null = null;
  let tools: Item[] | null = null;
  let settings: Item | null = null;
  let source: ModelCall['source'] = null;
  let thread: ModelCall['thread'] = null;
  return raw.map((call, i) => {
    messages = [...messages.slice(0, call.prefix), ...(call.messages ?? [])];
    if ('systemPrompt' in call) systemPrompt = call.systemPrompt ?? null;
    if ('tools' in call) tools = call.tools ?? null;
    if ('settings' in call) settings = call.settings ?? null;
    if ('source' in call) source = call.source ?? null;
    if ('thread' in call) thread = call.thread ?? null;
    return { no: i + 1, startedAt: call.startedAt, ms: call.ms, systemPrompt, messages, fresh: call.prefix, tools, toolsUnknown: call.toolsUnknown === true, settings, source, thread, lacks: call.lacks ?? [], answer: call.answer };
  });
}

/** What an answer used: tokens in (of them read from the cache) and out (of them thinking); never a price. */
export function usageOf(call: ModelCall) {
  const u = call.answer?.usage ?? {};
  const cached = Number(u.cacheRead) || 0;
  return {
    input: (Number(u.input) || 0) + cached + (Number(u.cacheWrite) || 0),
    cached,
    output: Number(u.output) || 0,
    reasoning: Number(u.reasoning) || 0,
  };
}

/** A message's text: a system message's sections, or its text parts. */
export function textOf(message: Item): string {
  if (message.role === 'system') return typeof message.content === 'string' && message.content ? message.content : Object.values(message.sections ?? {}).join('\n\n');
  if (typeof message.content === 'string') return message.content;
  return (message.content ?? []).map((p: Item) => (p.type === 'text' ? p.text : p.type === 'thinking' ? p.thinking : p.type === 'toolCall' ? `${p.name} ${JSON.stringify(p.arguments)}` : p.type === 'image' ? '[image]' : '')).join(' ');
}
