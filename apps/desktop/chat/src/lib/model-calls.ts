/**
 * The requests the app's own agent (Pi) made to its model in a turn and the answers (the turn's model log,
 * src/chat-store.mjs), whole again: a line keeps only what is new since the request before (`prefix` of that one's
 * messages, then its own; `systemPrompt` and `tools` when they changed).
 *
 * Messages are Pi's: system (its text in `sections`), user (text or parts), assistant (`thinking`, `text` and
 * `toolCall` parts, its usage and why it stopped) and toolResult (`toolCallId`, `toolName`, parts, `isError`).
 */
type Item = Record<string, any>;

export interface RawCall {
  startedAt: number;
  ms: number;
  prefix: number;
  messages: Item[];
  systemPrompt?: string | null;
  tools?: Item[] | null;
  answer: Item | null;
}

export interface ModelCall {
  no: number;
  startedAt: number;
  ms: number;
  systemPrompt: string | null;
  /** every message the model got, in order; from `fresh` on, the ones new in this request */
  messages: Item[];
  fresh: number;
  tools: Item[] | null;
  answer: Item | null;
}

export function modelCalls(raw: RawCall[]): ModelCall[] {
  let messages: Item[] = [];
  let systemPrompt: string | null = null;
  let tools: Item[] | null = null;
  return raw.map((call, i) => {
    messages = [...messages.slice(0, call.prefix), ...(call.messages ?? [])];
    if ('systemPrompt' in call) systemPrompt = call.systemPrompt ?? null;
    if ('tools' in call) tools = call.tools ?? null;
    return { no: i + 1, startedAt: call.startedAt, ms: call.ms, systemPrompt, messages, fresh: call.prefix, tools, answer: call.answer };
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
