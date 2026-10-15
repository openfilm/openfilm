/**
 * What the person's own Gemini CLI, Qwen Code, CodeBuddy and OpenCode sent their models in a turn. Their own records
 * keep the conversation without the system prompt or the tools, so each is started with its own logging switch
 * (official, local only), writing into a folder of the app's for that one process, and a turn's requests are read
 * from there once it ends, in the shape agent-records.mjs gives Claude Code's, Codex's, Kimi's and Copilot's.
 *
 *   Gemini CLI    its telemetry to a local file (GEMINI_TELEMETRY_TARGET=local, _OUTFILE): records of pretty JSON one
 *                 after the other. Each `gemini_cli.api_request` has the contents as sent (`request_text`), its
 *                 `llm_call` span (the same span id) the system instructions and the tools, the next
 *                 `gemini_cli.api_response` of its prompt id the answer's chunks and the usage. Prompts are in the
 *                 records by Gemini CLI's own default (logPrompts), which the app leaves as the person has it.
 *   Qwen Code     `--openai-logging --openai-logging-dir`: one JSON per request, the body sent (OpenAI's chat format:
 *                 its system message, messages, tools) and the answer whole, with the session it was for.
 *   CodeBuddy     its raw request and response bodies to files (OTEL_LOG_RAW_API_BODIES=file:<dir>), with an
 *                 index naming each request's session; only when its own telemetry is off (see sendsMore).
 *   OpenCode      its OpenTelemetry (`experimental.openTelemetry`) sent to a receiver of the app's on 127.0.0.1, which
 *                 keeps only the AI SDK's request spans: each has the prompt as OpenCode gave it (system, messages),
 *                 the tools, the answer and the usage, by session.
 *
 * Only for a session started while Developer mode is on, and only when the person has set none of the agent's
 * telemetry themselves: theirs is never changed. Nothing here goes off the computer, and none of it is on the agent's
 * stdout (its ACP channel). A process's folder goes after LOG_KEEP_DAYS; the turn log keeps what was read from it.
 *
 * None of these is a public format either: read for what it has, and whatever is not understood is left out. A
 * request's messages are as the log has them; `lacks` names what a log does not have, for the turn log to say.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** The agents started with a logging switch. */
export const LOGGED_AGENTS = Object.freeze(['gemini', 'qwen', 'codebuddy', 'opencode']);

/** a process's logs are kept this long */
const LOG_KEEP_DAYS = 7;
/** a log longer than this is not read */
const LOG_MAX = 256 * 1024 * 1024;
/** what the receiver takes in one request (a span carries the whole conversation) */
const RECEIVE_MAX = 64 * 1024 * 1024;

/**
 * How long after a turn its requests are all in the log: Gemini CLI writes them in batches (every few seconds),
 * OpenCode sends them so; Qwen Code and CodeBuddy as each answer ends.
 */
export const LOG_SETTLE_MS = Object.freeze({ gemini: 6000, opencode: 6000 });

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
const parse = (v, fallback = null) => { if (typeof v !== 'string') return v ?? fallback; try { return JSON.parse(v); } catch { return fallback; } };
const ms = (iso) => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? t : null; };
const picture = (mimeType, data) => ({ type: 'image', mimeType: String(mimeType || 'image/png'), data: String(data ?? '') });
const text = (t) => ({ type: 'text', text: String(t ?? '') });
const readText = (file) => {
  try { return statSync(file).size > LOG_MAX ? '' : readFileSync(file, 'utf8'); } catch { return ''; }
};
const jsonLines = (file) => readText(file).split('\n').flatMap((line) => { try { return line ? [JSON.parse(line)] : []; } catch { return []; } });
const files = (dir) => { try { return readdirSync(dir).sort(); } catch { return []; } };

/* ── the switches ─────────────────────────────────────────────────────────── */

/** a setting of the person's own: any of these variables in their shell */
const setInShell = (shell, re) => Object.keys(shell ?? {}).some((k) => re.test(k));
const mentions = (file, re) => { try { return re.test(readFileSync(file, 'utf8')); } catch { return false; } };

/** Whether the person has set the agent's telemetry or logging themselves: then the app leaves it as it is. */
export function ownLogging(agent, { shell = {}, home = homedir(), cwd = '' } = {}) {
  switch (agent) {
    case 'gemini':
      return setInShell(shell, /^(GEMINI_TELEMETRY_|OTEL_)/)
        || [join(home, '.gemini', 'settings.json'), cwd && join(cwd, '.gemini', 'settings.json')].some((f) => f && mentions(f, /"telemetry"\s*:/));
    case 'qwen':
      return [join(home, '.qwen', 'settings.json'), cwd && join(cwd, '.qwen', 'settings.json')].some((f) => f && mentions(f, /"enableOpenAILogging"\s*:\s*true/));
    case 'codebuddy': return setInShell(shell, /^OTEL_LOG_RAW_API_BODIES$/);
    case 'opencode': return setInShell(shell, /^(OTEL_|OPENCODE_CONFIG_CONTENT$)/);
    default: return true;
  }
}

/**
 * Whether the switch would have the agent send more off the computer than it does by itself. CodeBuddy sends its
 * traces to its makers unless told not to, and with its bodies kept in files each request's trace names its file and
 * size: so only when the person has turned that off (DISABLE_TELEMETRY, or no trace exporter).
 */
const sendsMore = (agent, shell = {}) => agent === 'codebuddy'
  && !/^(1|true|yes|on)$/i.test(String(shell.DISABLE_TELEMETRY ?? '').trim()) && String(shell.OTEL_TRACES_EXPORTER ?? '').trim().toLowerCase() !== 'none';

/** Remove the process folders under `dir` older than LOG_KEEP_DAYS. */
function prune(dir, now = Date.now()) {
  for (const name of files(dir)) {
    const at = join(dir, name);
    try { if (now - statSync(at).mtimeMs > LOG_KEEP_DAYS * 86_400_000) rmSync(at, { recursive: true, force: true }); } catch { /* in use, or gone */ }
  }
}

/**
 * The agent's logging switch, for one process: `{ args, env, log, close }` (`log`: where it writes, kept in the turn
 * log's `opened` so the turn's requests are found), or null for an agent with none. When the app leaves it off,
 * `log.none` says why: 'own' (the person set its telemetry), 'sendsMore' (it would send more to its makers).
 * `base`: the app's folder for these logs.
 */
export async function logSwitches(agent, { base, shell = {}, home = homedir(), cwd = '' }) {
  if (!base || !LOGGED_AGENTS.includes(agent)) return null;
  const none = { args: [], env: {}, close: () => {} };
  if (ownLogging(agent, { shell, home, cwd })) return { ...none, log: { agent, none: 'own' } };
  if (sendsMore(agent, shell)) return { ...none, log: { agent, none: 'sendsMore' } };
  const parent = join(base, agent);
  prune(parent);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(parent, `${stamp}-${randomBytes(3).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  const on = { ...none, log: { agent, dir } };
  switch (agent) {
    case 'gemini':
      return { ...on, env: { GEMINI_TELEMETRY_ENABLED: 'true', GEMINI_TELEMETRY_TARGET: 'local', GEMINI_TELEMETRY_OUTFILE: join(dir, 'telemetry.log'), GEMINI_TELEMETRY_TRACES_ENABLED: 'true' } };
    case 'qwen':
      return { ...on, args: ['--openai-logging', '--openai-logging-dir', dir] };
    case 'codebuddy':
      return { ...on, env: { OTEL_LOG_RAW_API_BODIES: `file:${dir}` } };
    case 'opencode': {
      const receiver = await spanReceiver(join(dir, 'spans.jsonl'));
      return {
        ...on,
        env: { OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url, OPENCODE_CONFIG_CONTENT: JSON.stringify({ experimental: { openTelemetry: true } }) },
        close: receiver.close,
      };
    }
    default: return null;
  }
}

/** an OpenTelemetry attribute's value (OTLP's JSON), as it was */
function otlpValue(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue' in v) return v.boolValue;
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(otlpValue);
  if ('kvlistValue' in v) return Object.fromEntries((v.kvlistValue?.values ?? []).map((kv) => [kv.key, otlpValue(kv.value)]));
  return null;
}

/** The AI SDK's spans of one request to a model (streamText's or generateText's): the ones kept. */
const isModelSpan = (name) => /^ai\.(streamText|generateText|streamObject|generateObject)\.do(Stream|Generate)$/.test(String(name));

/**
 * A receiver of OpenTelemetry's HTTP export (OTLP, JSON) on 127.0.0.1: of what it is sent it keeps the model
 * requests' spans, a line each in `file` (`{ name, start, end, attributes }`), and answers everything else with
 * nothing to say. `{ url, close }`.
 */
export function spanReceiver(file) {
  const server = createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (d) => { size += d.length; if (size <= RECEIVE_MAX) chunks.push(d); });
    req.on('end', () => {
      try {
        if (req.method === 'POST' && req.url?.startsWith('/v1/traces') && size <= RECEIVE_MAX && /json/.test(String(req.headers['content-type']))) {
          let body = Buffer.concat(chunks);
          if (req.headers['content-encoding'] === 'gzip') body = gunzipSync(body);
          const kept = [];
          for (const rs of JSON.parse(body.toString('utf8')).resourceSpans ?? []) {
            for (const ss of rs.scopeSpans ?? []) {
              for (const span of ss.spans ?? []) {
                if (!isModelSpan(span.name)) continue;
                kept.push(JSON.stringify({
                  name: span.name,
                  start: Number(BigInt(span.startTimeUnixNano ?? 0) / 1_000_000n),
                  end: Number(BigInt(span.endTimeUnixNano ?? 0) / 1_000_000n),
                  attributes: Object.fromEntries((span.attributes ?? []).map((a) => [a.key, otlpValue(a.value)])),
                }));
              }
            }
          }
          if (kept.length) appendFileSync(file, `${kept.join('\n')}\n`);
        }
      } catch { /* not understood: nothing kept */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

/* ── OpenAI's chat format (Qwen Code, and CodeBuddy's OpenAI-like services) ──── */

/** A chat message's content (a string, or parts: text, image_url), as the turn log has it. */
function chatParts(content) {
  if (typeof content === 'string') return content ? [text(content)] : [];
  return (Array.isArray(content) ? content : []).map((p) => {
    if (typeof p?.text === 'string') return text(p.text);
    if (p?.type === 'image_url') {
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(p.image_url?.url ?? p.image_url ?? ''));
      return m ? picture(m[1], m[2]) : text(`[image ${str(p.image_url?.url ?? p.image_url).slice(0, 200)}]`);
    }
    return { type: 'other', value: p };
  });
}

/** An assistant's message (or a whole answer's), as parts: its thinking, its words, its tool calls. */
function chatAssistant(m) {
  const out = [];
  const thought = m?.reasoning_content ?? m?.reasoning;
  if (typeof thought === 'string' && thought) out.push({ type: 'thinking', thinking: thought });
  out.push(...chatParts(m?.content));
  for (const call of m?.tool_calls ?? []) {
    out.push({ type: 'toolCall', id: String(call?.id ?? ''), name: String(call?.function?.name ?? ''), arguments: parse(call?.function?.arguments, call?.function?.arguments ?? {}) });
  }
  return out;
}

/**
 * A chat request's messages: its leading system messages as its system prompt, the rest as the turn log has them
 * (a later system message is context the agent put in).
 */
export function chatMessages(messages) {
  const system = [];
  const out = [];
  const names = new Map();
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.role === 'system' || m?.role === 'developer') {
      const said = chatParts(m.content).map((p) => p.text ?? '').join('\n');
      if (!out.length) system.push(said);
      else out.push({ role: 'context', as: m.role, label: m.role, content: [text(said)] });
    } else if (m?.role === 'assistant') {
      const content = chatAssistant(m);
      for (const p of content) if (p.type === 'toolCall') names.set(p.id, p.name);
      out.push({ role: 'assistant', content });
    } else if (m?.role === 'tool') {
      out.push({ role: 'toolResult', toolCallId: String(m.tool_call_id ?? ''), toolName: names.get(m.tool_call_id) ?? String(m.name ?? 'tool'), content: chatParts(m.content), isError: false });
    } else if (m) {
      /* what the agent puts in the person's message by itself (CodeBuddy's memory, Qwen's reminders): context */
      let own = [];
      for (const part of chatParts(m.content)) {
        const tag = typeof part.text === 'string' ? /^\s*<(system-reminder)\b/.exec(part.text)?.[1] : null;
        if (!tag) { own.push(part); continue; }
        if (own.length) out.push({ role: 'user', content: own });
        own = [];
        out.push({ role: 'context', as: 'user', label: tag, content: [part] });
      }
      if (own.length) out.push({ role: 'user', content: own });
    }
  }
  return { systemPrompt: system.length ? system.join('\n\n') : null, messages: out };
}

/** A chat request's tools (`{ type: 'function', function: { name, description, parameters } }`). */
const chatTools = (tools) => (Array.isArray(tools) ? tools.map((t) => {
  const f = t?.function ?? t;
  return { name: f?.name, description: f?.description, parameters: f?.parameters };
}) : null);

/** OpenAI's chat usage as the turn log counts it (its prompt tokens count the cached ones too). */
const chatUsage = (u = {}) => {
  const cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens) || 0;
  return {
    input: Math.max(0, (Number(u.prompt_tokens) || 0) - cached),
    cacheRead: cached,
    cacheWrite: 0,
    output: Number(u.completion_tokens) || 0,
    reasoning: Number(u.completion_tokens_details?.reasoning_tokens) || 0,
  };
};

/** A chat completion (or the error in its place) as the turn log's answer. */
function chatAnswer(response, error) {
  if (!response && !error) return null;
  if (!response) return { role: 'assistant', content: [], stopReason: 'error', errorMessage: str(error.message ?? error) };
  const choice = response?.choices?.[0] ?? {};
  return {
    role: 'assistant', content: chatAssistant(choice.message ?? {}), usage: chatUsage(response?.usage),
    stopReason: choice.finish_reason ?? null, ...(response?.model ? { responseModel: String(response.model) } : {}),
  };
}

/* ── Qwen Code ───────────────────────────────────────────────────────────── */

/**
 * The requests in a Qwen Code log folder written between `from` and `to` (ms), each whole. Its own requests and its
 * subagents' carry the session's id (`context.sessionId`; a subagent's is named in `promptId`); the few it makes for
 * itself (`forked_query` and the like) carry none, and are the folder's process's all the same.
 */
export function qwenCalls(dir, { sessionId, from = 0, to = Infinity } = {}) {
  const calls = [];
  for (const name of files(dir).filter((n) => /^openai-.*\.json$/.test(n))) {
    const entry = parse(readText(join(dir, name)));
    if (!entry?.request) continue;
    const at = ms(entry.timestamp);
    if (at === null || at < from || at > to) continue;
    const context = entry.context ?? {};
    if (context.sessionId && sessionId && context.sessionId !== sessionId) continue;
    const { systemPrompt, messages } = chatMessages(entry.request.messages);
    const { messages: _m, tools, ...settings } = entry.request;
    const promptId = String(context.promptId ?? '');
    const sub = /^[^#]+#([^#]+)#\d+$/.exec(promptId)?.[1] ?? (context.sessionId ? null : promptId || null);
    calls.push({
      /* the file is written once its answer has come: when it was asked is not kept */
      startedAt: at, ms: null, messages, systemPrompt, tools: chatTools(tools), answer: chatAnswer(entry.response, entry.error), settings,
      ...(sub ? { thread: { id: sub, label: sub } } : {}),
    });
  }
  return calls.sort((a, b) => a.startedAt - b.startedAt);
}

/* ── CodeBuddy ───────────────────────────────────────────────────────────── */

/** A Responses API request's input (messages, function calls and their output) as the turn log has it. */
function responsesMessages(input) {
  const out = [];
  const names = new Map();
  for (const item of typeof input === 'string' ? [{ type: 'message', role: 'user', content: input }] : Array.isArray(input) ? input : []) {
    if (item?.type === 'function_call') {
      names.set(item.call_id ?? item.callId, item.name);
      const call = { type: 'toolCall', id: String(item.call_id ?? item.callId ?? ''), name: String(item.name ?? ''), arguments: parse(item.arguments, item.arguments ?? {}) };
      const last = out[out.length - 1];
      if (last?.role === 'assistant') last.content.push(call); else out.push({ role: 'assistant', content: [call] });
    } else if (item?.type === 'function_call_output') {
      const id = item.call_id ?? item.callId;
      out.push({ role: 'toolResult', toolCallId: String(id ?? ''), toolName: names.get(id) ?? 'tool', content: [text(str(item.output))], isError: false });
    } else if (item?.role) {
      const content = typeof item.content === 'string' ? [text(item.content)] : (item.content ?? []).map((p) => (typeof p?.text === 'string' ? text(p.text) : { type: 'other', value: p }));
      out.push(item.role === 'assistant' ? { role: 'assistant', content } : item.role === 'user' ? { role: 'user', content } : { role: 'context', as: String(item.role), label: String(item.role), content });
    }
  }
  return out;
}

/** CodeBuddy's answer as it keeps it (its own words, `output`: messages and function calls; its usage). */
function codebuddyAnswer(response, model) {
  const content = [];
  for (const item of response?.output ?? []) {
    if (item?.type === 'function_call') content.push({ type: 'toolCall', id: String(item.callId ?? item.call_id ?? ''), name: String(item.name ?? ''), arguments: parse(item.arguments, item.arguments ?? {}) });
    else if (item?.type === 'reasoning') content.push({ type: 'thinking', thinking: (item.content ?? item.summary ?? []).map((s) => s?.text ?? '').join('\n') });
    else for (const p of item?.content ?? []) content.push(typeof p?.text === 'string' ? text(p.text) : { type: 'other', value: p });
  }
  const u = response?.usage ?? {};
  const cached = Number(u.inputTokensDetails?.cached_tokens) || 0;
  return {
    role: 'assistant', content,
    usage: { input: Math.max(0, (Number(u.inputTokens) || 0) - cached), cacheRead: cached, cacheWrite: 0, output: Number(u.outputTokens) || 0, reasoning: Number(u.outputTokensDetails?.reasoning_tokens) || 0 },
    ...(response?.model ?? model ? { responseModel: String(response?.model ?? model) } : {}),
  };
}

/**
 * The requests of one session in a CodeBuddy raw bodies folder that began between `from` and `to` (ms): its
 * `index.jsonl` names each request's files and the session it was for (`root_session_id`, the ACP session's id; a
 * call it makes for itself, a title for one, is a session of its own under it).
 */
export function codebuddyCalls(dir, { sessionId, from = 0, to = Infinity } = {}) {
  const calls = [];
  for (const entry of jsonLines(join(dir, 'index.jsonl'))) {
    if (sessionId && entry?.root_session_id !== sessionId && entry?.session_id !== sessionId) continue;
    const name = (f) => (typeof f === 'string' && /^[\w.-]+$/.test(f) ? join(dir, f) : null);
    const request = parse(readText(name(entry.request_file) ?? ''));
    const response = parse(readText(name(entry.response_file) ?? ''));
    if (!request) continue;
    const at = Number(response?.started_at) || ms(entry.timestamp) || 0;
    if (at < from || at > to) continue;
    const chat = Array.isArray(request.messages) ? chatMessages(request.messages)
      : { systemPrompt: typeof request.instructions === 'string' ? request.instructions : null, messages: responsesMessages(request.input) };
    const { messages: _m, input: _i, instructions: _s, tools, ...settings } = request;
    const own = entry.session_id && entry.session_id !== entry.root_session_id;
    calls.push({
      startedAt: at, ms: Math.max(0, (Number(response?.completed_at) || at) - at), ...chat,
      tools: chatTools(tools) ?? [], answer: response ? codebuddyAnswer(response, entry.model) : null, settings,
      ...(own ? { thread: { id: String(entry.session_id), label: String(entry.query_source ?? 'helper') } } : {}),
    });
  }
  return calls.sort((a, b) => a.startedAt - b.startedAt);
}

/* ── Gemini CLI ──────────────────────────────────────────────────────────── */

/** The records of a Gemini CLI telemetry file: JSON values one after the other, each split where its braces close. */
export function splitRecords(raw) {
  const out = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') { if (depth++ === 0) start = i; }
    else if ((c === '}' || c === ']') && depth > 0 && --depth === 0) {
      try { out.push(JSON.parse(raw.slice(start, i + 1))); } catch { /* a record cut short */ }
    }
  }
  return out;
}

/** a span's time ([seconds, nanoseconds]) in ms */
const hrMs = (t) => (Array.isArray(t) ? Number(t[0]) * 1000 + Math.round(Number(t[1]) / 1e6) : null);

/** Gemini's content parts, as the turn log has them; a function's response is a message of its own. */
function geminiMessages(contents) {
  const out = [];
  for (const c of Array.isArray(contents) ? contents : []) {
    let own = [];
    const results = [];
    for (const p of c?.parts ?? []) {
      /* what Gemini CLI puts first by itself: the date, the system, the folder */
      if (c.role !== 'model' && typeof p?.text === 'string' && /^\s*<session_context>/.test(p.text)) {
        if (own.length) out.push({ role: 'user', content: own });
        own = [];
        out.push({ role: 'context', as: 'user', label: 'session_context', content: [text(p.text)] });
      } else if (typeof p?.text === 'string') own.push(p.thought ? { type: 'thinking', thinking: p.text } : text(p.text));
      else if (p?.functionCall) own.push({ type: 'toolCall', id: String(p.functionCall.id ?? ''), name: String(p.functionCall.name ?? ''), arguments: p.functionCall.args ?? {} });
      else if (p?.functionResponse) {
        const r = p.functionResponse;
        const said = r.response?.output ?? r.response?.error ?? r.response;
        results.push({ role: 'toolResult', toolCallId: String(r.id ?? ''), toolName: String(r.name ?? 'tool'), content: [text(str(said))], isError: r.response?.error != null });
      } else if (p?.inlineData) own.push(picture(p.inlineData.mimeType, p.inlineData.data));
      else if (p) own.push({ type: 'other', value: p });
    }
    if (own.length) out.push({ role: c.role === 'model' ? 'assistant' : 'user', content: own });
    out.push(...results);
  }
  return out;
}

/** An answer's chunks (a stream's, as Gemini CLI keeps them) joined into its parts. */
function geminiAnswer(chunks) {
  const parts = [];
  let finish = null;
  for (const chunk of Array.isArray(chunks) ? chunks : [chunks]) {
    const candidate = chunk?.candidates?.[0];
    if (candidate?.finishReason) finish = candidate.finishReason;
    for (const p of candidate?.content?.parts ?? []) {
      const last = parts[parts.length - 1];
      if (typeof p?.text === 'string') {
        const kind = p.thought ? 'thinking' : 'text';
        if (last?.type === kind) last[kind] += p.text;
        else parts.push(kind === 'thinking' ? { type: 'thinking', thinking: p.text } : text(p.text));
      } else if (p?.functionCall) parts.push({ type: 'toolCall', id: String(p.functionCall.id ?? ''), name: String(p.functionCall.name ?? ''), arguments: p.functionCall.args ?? {} });
      else if (p) parts.push({ type: 'other', value: p });
    }
  }
  return { parts, finish };
}

/** Gemini's tools (`[{ functionDeclarations: [...] }]`), each as the turn log has it. */
const geminiTools = (tools) => (Array.isArray(tools) ? tools.flatMap((t) => (Array.isArray(t?.functionDeclarations)
  ? t.functionDeclarations.map((f) => ({ name: f?.name, description: f?.description, parameters: f?.parametersJsonSchema ?? f?.parameters }))
  : [{ name: Object.keys(t ?? {})[0] ?? 'tool', description: '', parameters: t }])) : null);

/**
 * The requests of one session in Gemini CLI's telemetry records whose asking was between `from` and `to` (ms).
 * Calls Gemini CLI makes for itself (which model to use: role `utility_router`) are named as its own.
 */
export function geminiCallsOf(records, { sessionId, from = 0, to = Infinity } = {}) {
  const spans = new Map();
  for (const r of records) if (r?._spanContext?.spanId && r.name === 'llm_call') spans.set(r._spanContext.spanId, r);
  const logs = records.filter((r) => typeof r?.attributes?.['event.name'] === 'string' && (!sessionId || r.attributes['session.id'] === sessionId));
  const calls = [];
  logs.forEach((r, i) => {
    const a = r.attributes;
    if (a['event.name'] !== 'gemini_cli.api_request') return;
    const at = ms(a['event.timestamp']) ?? hrMs(r.hrTime) ?? 0;
    if (at < from || at > to) return;
    /* its answer (or its error): the next of its prompt id after it */
    const reply = logs.slice(i + 1).find((x) => x.attributes.prompt_id === a.prompt_id && /^gemini_cli\.api_(response|error)$/.test(x.attributes['event.name']));
    const span = spans.get(r.spanContext?.spanId);
    const sa = span?.attributes ?? {};
    const system = parse(sa['gen_ai.system_instructions']);
    const ra = reply?.attributes ?? {};
    const { parts, finish } = geminiAnswer(parse(ra.response_text, []));
    const input = Number(ra.input_token_count) || 0;
    const cached = Number(ra.cached_content_token_count) || 0;
    const thoughts = Number(ra.thoughts_token_count) || 0;
    const answer = ra['event.name'] === 'gemini_cli.api_error'
      ? { role: 'assistant', content: [], stopReason: 'error', errorMessage: str(ra.error ?? ra.error_message ?? 'error') }
      : reply ? {
        role: 'assistant', content: parts,
        usage: { input: Math.max(0, input - cached), cacheRead: cached, cacheWrite: 0, output: (Number(ra.output_token_count) || 0) + thoughts, reasoning: thoughts },
        stopReason: finish ?? (Array.isArray(ra.finish_reasons) ? ra.finish_reasons[0] : null) ?? null, ...(ra.model ? { responseModel: String(ra.model) } : {}),
      } : null;
    const role = String(a.role ?? 'main');
    calls.push({
      startedAt: at, ms: Number(ra.duration_ms) || (ms(ra['event.timestamp']) ?? at) - at,
      messages: geminiMessages(parse(a.request_text, [])),
      systemPrompt: typeof system === 'string' ? system : system ? str(system) : null,
      tools: span ? geminiTools(parse(sa['gen_ai.tool.definitions'], [])) : null,
      answer, settings: { model: a.model ?? null, auth: a.auth_type ?? null },
      ...(role !== 'main' ? { thread: { id: role, label: role } } : {}),
    });
  });
  return calls;
}

export const geminiCalls = (file, opts) => geminiCallsOf(splitRecords(readText(file)), opts);

/* ── OpenCode ────────────────────────────────────────────────────────────── */

/** The AI SDK's prompt (system, user, assistant, tool messages, each its parts), as the turn log has it. */
function aiSdkMessages(prompt) {
  const system = [];
  const out = [];
  const part = (p) => {
    switch (p?.type) {
      case 'text': return text(p.text);
      case 'reasoning': return { type: 'thinking', thinking: String(p.text ?? '') };
      case 'tool-call': return { type: 'toolCall', id: String(p.toolCallId ?? ''), name: String(p.toolName ?? ''), arguments: parse(p.input ?? p.args, p.input ?? p.args ?? {}) };
      case 'file': case 'image':
        return /^image\//.test(String(p.mediaType ?? p.mimeType ?? 'image/')) && typeof (p.data ?? p.image) === 'string' && !/^https?:/.test(p.data ?? p.image)
          ? picture(p.mediaType ?? p.mimeType, p.data ?? p.image) : { type: 'other', value: p };
      default: return { type: 'other', value: p };
    }
  };
  for (const m of Array.isArray(prompt) ? prompt : []) {
    const content = typeof m?.content === 'string' ? [text(m.content)] : (m?.content ?? []);
    if (m?.role === 'system') {
      const said = content.map((p) => p.text ?? '').join('\n');
      if (!out.length) system.push(said);
      else out.push({ role: 'context', as: 'system', label: 'system', content: [text(said)] });
    } else if (m?.role === 'tool') {
      for (const r of content) {
        const o = r?.output ?? {};
        const said = o.type === 'content' && Array.isArray(o.value) ? o.value.map((v) => (v.type === 'text' ? text(v.text) : v.type === 'media' || v.type === 'image-data' ? picture(v.mediaType, v.data) : { type: 'other', value: v }))
          : [text(typeof o.value === 'string' ? o.value : str(o.value ?? r?.result ?? o))];
        out.push({ role: 'toolResult', toolCallId: String(r?.toolCallId ?? ''), toolName: String(r?.toolName ?? 'tool'), content: said, isError: /^error/.test(String(o.type)) });
      }
    } else if (m) {
      out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: content.map(part) });
    }
  }
  return { systemPrompt: system.length ? system.join('\n\n') : null, messages: out };
}

/** The AI SDK's tools (each a JSON string: a function's name, description, input schema; or a provider's own). */
const aiSdkTools = (tools) => (Array.isArray(tools) ? tools.map((t) => {
  const tool = parse(t, t) ?? {};
  return { name: tool.name ?? tool.id, description: tool.description, parameters: tool.inputSchema ?? tool.parameters ?? tool.args };
}) : null);

/**
 * The requests in the spans the receiver kept of an OpenCode process whose asking was between `from` and `to` (ms).
 * One process is one ACP session; a request of another session in it is a subagent's (a session of its own).
 */
export function opencodeCallsOf(spans, { sessionId, from = 0, to = Infinity } = {}) {
  return spans.filter((s) => isModelSpan(s?.name) && s.start >= from && s.start <= to).map((s) => {
    const a = s.attributes ?? {};
    const { systemPrompt, messages } = aiSdkMessages(parse(a['ai.prompt.messages'], []));
    const answer = [];
    const reasoning = a['ai.response.reasoning'];
    if (typeof reasoning === 'string' && reasoning) answer.push({ type: 'thinking', thinking: reasoning });
    if (typeof a['ai.response.text'] === 'string' && a['ai.response.text']) answer.push(text(a['ai.response.text']));
    for (const c of parse(a['ai.response.toolCalls'], []) ?? []) {
      answer.push({ type: 'toolCall', id: String(c?.toolCallId ?? ''), name: String(c?.toolName ?? ''), arguments: parse(c?.input ?? c?.args, c?.input ?? c?.args ?? {}) });
    }
    const inputAll = Number(a['ai.usage.inputTokens']) || 0;
    const cacheRead = Number(a['ai.usage.inputTokenDetails.cacheReadTokens'] ?? a['ai.usage.cachedInputTokens']) || 0;
    const cacheWrite = Number(a['ai.usage.inputTokenDetails.cacheWriteTokens']) || 0;
    const session = a['session.id'] ?? a['ai.telemetry.metadata.sessionId'] ?? null;
    return {
      startedAt: s.start, ms: Math.max(0, (s.end || s.start) - s.start), messages, systemPrompt,
      tools: aiSdkTools(a['ai.prompt.tools']) ?? [],
      answer: {
        role: 'assistant', content: answer,
        usage: { input: Number(a['ai.usage.inputTokenDetails.noCacheTokens'] ?? Math.max(0, inputAll - cacheRead - cacheWrite)) || 0, cacheRead, cacheWrite, output: Number(a['ai.usage.outputTokens']) || 0, reasoning: Number(a['ai.usage.reasoningTokens']) || 0 },
        stopReason: a['ai.response.finishReason'] ?? null,
        ...(a['ai.response.model'] ?? a['ai.model.id'] ? { responseModel: String(a['ai.response.model'] ?? a['ai.model.id']) } : {}),
        ...(a['ai.model.provider'] ? { provider: String(a['ai.model.provider']) } : {}),
      },
      ...(a['ai.prompt.toolChoice'] ? { settings: { toolChoice: parse(a['ai.prompt.toolChoice']) } } : {}),
      ...(session && sessionId && session !== sessionId ? { thread: { id: String(session), label: `subagent ${session}` } } : {}),
      lacks: ['opencodeBeforeProvider'],
    };
  }).sort((a, b) => a.startedAt - b.startedAt);
}

export const opencodeCalls = (file, opts) => opencodeCallsOf(jsonLines(file), opts);

/* ── all ─────────────────────────────────────────────────────────────────── */

/**
 * A turn's requests, read from the log its agent was started with (`log`: the `opened.log` of its turn log):
 * `{ file, calls }` in time order, or null when there is none to read.
 */
export function agentLogCalls({ agent, sessionId, log, from = 0, to = Infinity }) {
  const dir = typeof log?.dir === 'string' && log.agent === agent ? log.dir : null;
  if (!dir || !existsSync(dir)) return null;
  const opts = { sessionId, from, to };
  switch (agent) {
    case 'gemini': return { file: join(dir, 'telemetry.log'), calls: geminiCalls(join(dir, 'telemetry.log'), opts) };
    case 'qwen': return { file: dir, calls: qwenCalls(dir, opts) };
    case 'codebuddy': return { file: join(dir, 'index.jsonl'), calls: codebuddyCalls(dir, opts) };
    case 'opencode': return { file: join(dir, 'spans.jsonl'), calls: opencodeCalls(join(dir, 'spans.jsonl'), opts) };
    default: return null;
  }
}
