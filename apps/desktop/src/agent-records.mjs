/**
 * What the person's own Claude Code, Codex and Kimi sent their models in a turn, read from the record each keeps of its
 * sessions, as the turn log shows the app's own agent's requests (chat-store.mjs `<turn>.model.jsonl`): each request
 * with its system prompt, every message it carried (the person's, the agent's own, each tool's result, and what the
 * agent put in by itself: project instructions, its environment, reminders), its tools, and the answer.
 *
 *   Claude Code   <CLAUDE_CONFIG_DIR or ~/.claude>/projects/<the folder, as a name>/<session>.jsonl, and its subagents'
 *                 in <session>/subagents/agent-*.jsonl. Each line is one entry of a chain (`parentUuid`): the person's
 *                 messages, each block of an answer (one request's blocks share `message.id`), each tool's result, and
 *                 each piece of context it attached, with the words it put in (`rendered`). A `prompt_snapshot`
 *                 attachment holds the system prompt (`cliPrefix`, `systemPrompt`) and the tools, when they change.
 *   Codex         <CODEX_HOME or ~/.codex>/sessions/YYYY/MM/DD/rollout-…-<session>.jsonl. `session_meta` holds the
 *                 base instructions; `response_item`s are the conversation as the model takes it (developer and user
 *                 messages, reasoning, tool calls and their output); a `token_usage_record` (or, older, an
 *                 `event_msg` token_count) closes each request. Codex does not keep its tools' definitions.
 *   Kimi          ~/.kimi-code/sessions/<folder>/session_<id>/agents/<main or a subagent>/wire.jsonl, found by
 *                 ~/.kimi-code/session_index.jsonl. Each request is an `llm.request` (model, effort, how many
 *                 messages) closed by a `step.end` (usage); the system prompt and the tools are kept as they change.
 *   Copilot       <COPILOT_HOME or ~/.copilot>/session-state/<session>/events.jsonl: the system prompt
 *                 (`system.message`), each message as the model got it (`user.message` transformedContent), each answer
 *                 (`assistant.message`, its tool requests) and each tool's result; a `session.usage_record` for each
 *                 request. No tools' definitions: Copilot does not keep them, and its OpenTelemetry makes no spans
 *                 over ACP.
 *
 * Gemini CLI, Qwen Code, CodeBuddy and OpenCode keep the conversation without the system prompt or the tools:
 * theirs are read from the logs they are started with (agent-logs.mjs). Cursor's prompt is made on its servers.
 *
 * Neither record is a public format: read for what it has, and whatever is not understood is left out, never a
 * failure. A request's messages are rebuilt from the record, as the agent keeps them: not the bytes on the wire.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LOGGED_AGENTS, agentLogCalls } from './agent-logs.mjs';

/** The agents whose records (or logs) are read. */
export const RECORDED_AGENTS = Object.freeze(['claude', 'codex', 'kimi', 'copilot', ...LOGGED_AGENTS]);

/** a record longer than this is not read: one turn's requests are not worth reading hundreds of megabytes */
const RECORD_MAX = 256 * 1024 * 1024;

const lines = (file) => {
  try {
    if (statSync(file).size > RECORD_MAX) return [];
    return readFileSync(file, 'utf8').split('\n').flatMap((line) => { try { return line ? [JSON.parse(line)] : []; } catch { return []; } });
  } catch { return []; }
};
const ms = (iso) => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? t : null; };
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
/** a picture as the turn log shows it: its type and its data (base64) */
const picture = (mimeType, data) => ({ type: 'image', mimeType: String(mimeType || 'image/png'), data: String(data ?? '') });

/* ── Claude Code ─────────────────────────────────────────────────────────── */

/** Claude Code's name for a folder's sessions: every character but a letter or a digit a dash. */
export const claudeProjectName = (cwd) => String(cwd).replace(/[^a-zA-Z0-9]/g, '-');

/**
 * The record of a Claude Code session, or null: in the folder named for `cwd`, else wherever it is (a long or unusual
 * path is named differently).
 */
export function findClaudeRecord({ sessionId, cwd, env = {} }) {
  if (!/^[\w-]{8,80}$/.test(String(sessionId ?? ''))) return null;
  const projects = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  const named = join(projects, claudeProjectName(cwd ?? ''), `${sessionId}.jsonl`);
  if (existsSync(named)) return named;
  let dirs = [];
  try { dirs = readdirSync(projects); } catch { return null; }
  for (const dir of dirs) {
    const file = join(projects, dir, `${sessionId}.jsonl`);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Claude's usage as the turn log counts it (input is what was not read from the cache). */
const claudeUsage = (u = {}) => ({
  input: Number(u.input_tokens) || 0,
  cacheRead: Number(u.cache_read_input_tokens) || 0,
  cacheWrite: Number(u.cache_creation_input_tokens) || 0,
  output: Number(u.output_tokens) || 0,
  reasoning: Number(u.output_tokens_details?.thinking_tokens) || 0,
});

/** A block of a message's content, as the turn log has it. */
function claudePart(block, entry) {
  if (typeof block === 'string') return { type: 'text', text: block };
  switch (block?.type) {
    case 'text': return { type: 'text', text: String(block.text ?? '') };
    case 'thinking': return { type: 'thinking', thinking: String(block.thinking ?? '') };
    case 'redacted_thinking': return { type: 'thinking', thinking: '[redacted]' };
    case 'tool_use': case 'server_tool_use':
      /* the input as the model wrote it, when Claude Code keeps that apart from the one it ran */
      return { type: 'toolCall', id: String(block.id ?? ''), name: String(block.name ?? ''), arguments: entry?.wireToolInputs?.[block.id] ?? block.input ?? {} };
    case 'image': return picture(block.source?.media_type, block.source?.data);
    default: return { type: 'other', value: block };
  }
}

/** A tool's result's content: its text and its pictures. */
const resultContent = (content) => (typeof content === 'string' ? [{ type: 'text', text: content }]
  : Array.isArray(content) ? content.map((b) => claudePart(b)) : [{ type: 'text', text: str(content) }]);

/**
 * The messages of one entry of the chain, as the model took them: a person's message (its tool results each a
 * message of their own), a piece of context Claude Code attached (role `context`, as the role it went in as, with the
 * words it put in), or a block of an answer (joined with its others by `message.id` afterwards). `tools` names each
 * tool call by its id, for its result.
 */
function claudeMessages(entry, tools) {
  if (entry.type === 'attachment') {
    const rendered = Array.isArray(entry.rendered) ? entry.rendered.map((r) => str(r?.content ?? r)).join('\n') : null;
    if (!rendered) return [];
    return [{ role: 'context', as: String(entry.renderedRole ?? 'user'), label: String(entry.attachment?.type ?? 'attachment'), content: [{ type: 'text', text: rendered }] }];
  }
  const message = entry.message ?? {};
  if (entry.type === 'assistant') {
    const content = (Array.isArray(message.content) ? message.content : [message.content]).filter(Boolean).map((b) => claudePart(b, entry));
    for (const part of content) if (part.type === 'toolCall') tools.set(part.id, part.name);
    return [{ role: 'assistant', id: String(message.id ?? entry.requestId ?? entry.uuid), content, responseModel: message.model,
      stopReason: message.stop_reason ?? null, usage: claudeUsage(message.usage), ...(entry.effort ? { thinkingLevel: entry.effort } : {}) }];
  }
  if (entry.type === 'user') {
    const content = typeof message.content === 'string' ? [message.content] : Array.isArray(message.content) ? message.content : [];
    const out = [];
    let own = [];
    const flush = () => { if (own.length) out.push({ role: 'user', content: own, ...(entry.isMeta ? { meta: true } : {}), ...(entry.isCompactSummary ? { label: 'compact summary' } : {}) }); own = []; };
    for (const block of content) {
      if (block?.type === 'tool_result') {
        flush();
        out.push({ role: 'toolResult', toolCallId: String(block.tool_use_id ?? ''), toolName: tools.get(block.tool_use_id) ?? 'tool', content: resultContent(block.content), isError: block.is_error === true });
      } else own.push(claudePart(block));
    }
    flush();
    return out;
  }
  return [];
}

/** The system prompt and tools in effect, from the snapshots along a chain (each may hold only what changed). */
function claudeSnapshot(chain) {
  let system = null;
  let prefix = '';
  let tools = null;
  for (const entry of chain) {
    const a = entry.type === 'attachment' ? entry.attachment : null;
    if (a?.type !== 'prompt_snapshot') continue;
    if (Array.isArray(a.systemPrompt)) system = a.systemPrompt.map(str);
    if (typeof a.cliPrefix === 'string' && a.cliPrefix) prefix = a.cliPrefix;
    if (Array.isArray(a.tools)) tools = a.tools.map((t) => ({ name: t?.name, description: t?.description, parameters: t?.schema ?? t?.input_schema ?? t?.parameters }));
  }
  return { systemPrompt: system ? [prefix, ...system].filter(Boolean).join('\n\n') : null, tools };
}

/**
 * The requests in one Claude Code record whose answers began between `from` and `to` (ms), each whole: its system
 * prompt, its messages, its tools, its answer. `thread`: a subagent's, named.
 */
export function claudeCallsOf(entries, { from = 0, to = Infinity, thread = null } = {}) {
  const byUuid = new Map();
  const answerNext = new Map();
  for (const e of entries) {
    if (typeof e?.uuid === 'string') byUuid.set(e.uuid, e);
    if (e?.type === 'assistant' && typeof e.parentUuid === 'string') answerNext.set(e.parentUuid, e);
  }
  /* each request: the first of its answer's blocks (they share message.id) */
  const firsts = [];
  const seen = new Set();
  for (const e of entries) {
    if (e?.type !== 'assistant' || e.isApiErrorMessage) continue;
    const id = e.message?.id ?? e.requestId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const at = ms(e.timestamp);
    if (at !== null && at >= from && at <= to) firsts.push(e);
  }
  return firsts.map((first) => {
    /* what the model had: the chain up to the request, as it is in the record */
    const chain = [];
    for (let e = byUuid.get(first.parentUuid); e && chain.length < 100_000; e = byUuid.get(e.parentUuid)) chain.push(e);
    chain.reverse();
    const id = first.message?.id ?? first.requestId;
    /* the answer's blocks: the first, and each after it of the same request */
    const answerBlocks = [first];
    for (let e = answerNext.get(first.uuid); e && (e.message?.id ?? e.requestId) === id; e = answerNext.get(e.uuid)) answerBlocks.push(e);
    const tools = new Map();
    const messages = [];
    const join = (list, m) => {
      const last = list[list.length - 1];
      if (m.role === 'assistant' && last?.role === 'assistant' && last.id === m.id) {
        last.content.push(...m.content);
        Object.assign(last, { stopReason: m.stopReason, usage: m.usage });
      } else list.push(m);
    };
    for (const entry of chain) for (const m of claudeMessages(entry, tools)) join(messages, m);
    const answered = [];
    for (const block of answerBlocks) for (const m of claudeMessages(block, tools)) join(answered, m);
    const { id: _id, ...answer } = answered[0] ?? { role: 'assistant', content: [] };
    for (const m of messages) delete m.id;
    const { systemPrompt, tools: toolList } = claudeSnapshot(chain);
    const sent = ms(chain[chain.length - 1]?.timestamp) ?? ms(first.timestamp) ?? 0;
    const done = ms(answerBlocks[answerBlocks.length - 1].timestamp) ?? sent;
    return {
      startedAt: sent, ms: Math.max(0, done - sent), messages, systemPrompt, tools: toolList, answer,
      ...(thread ? { thread } : {}),
    };
  });
}

/** Every request of a Claude Code session, and of the subagents it ran, between `from` and `to`, in time order. */
export function claudeCalls(file, { from = 0, to = Infinity } = {}) {
  const calls = claudeCallsOf(lines(file), { from, to });
  const subagents = join(file.replace(/\.jsonl$/, ''), 'subagents');
  let names = [];
  try { names = readdirSync(subagents).filter((n) => /^agent-[\w-]+\.jsonl$/.test(n)); } catch { /* none */ }
  for (const name of names) {
    let meta = {};
    try { meta = JSON.parse(readFileSync(join(subagents, name.replace(/\.jsonl$/, '.meta.json')), 'utf8')); } catch { /* unnamed */ }
    const thread = { id: name.slice('agent-'.length, -'.jsonl'.length), label: [meta.agentType, meta.description].filter(Boolean).join(' · ') || 'subagent' };
    calls.push(...claudeCallsOf(lines(join(subagents, name)), { from, to, thread }));
  }
  return calls.sort((a, b) => a.startedAt - b.startedAt);
}

/* ── Codex ───────────────────────────────────────────────────────────────── */

/** The rollout of a Codex session, or null: in its sessions (newest days first), or archived. */
export function findCodexRecord({ sessionId, env = {} }) {
  if (!/^[\w-]{8,80}$/.test(String(sessionId ?? ''))) return null;
  const home = env.CODEX_HOME || join(homedir(), '.codex');
  const suffix = `-${sessionId}.jsonl`;
  const sorted = (dir) => { try { return readdirSync(dir).sort().reverse(); } catch { return []; } };
  const sessions = join(home, 'sessions');
  for (const y of sorted(sessions)) {
    for (const m of sorted(join(sessions, y))) {
      for (const d of sorted(join(sessions, y, m))) {
        const hit = sorted(join(sessions, y, m, d)).find((n) => n.endsWith(suffix));
        if (hit) return join(sessions, y, m, d, hit);
      }
    }
  }
  const archived = sorted(join(home, 'archived_sessions')).find((n) => n.endsWith(suffix));
  return archived ? join(home, 'archived_sessions', archived) : null;
}

/** OpenAI's usage as the turn log counts it (its input counts the cached part too). */
const codexUsage = (u = {}) => {
  const cached = Number(u.cached_input_tokens) || 0;
  return {
    input: Math.max(0, (Number(u.input_tokens) || 0) - cached),
    cacheRead: cached,
    cacheWrite: Number(u.cache_write_input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
    reasoning: Number(u.reasoning_output_tokens) || 0,
  };
};

/** A message's content parts (input_text, output_text, input_image), as the turn log has them. */
function codexParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return (Array.isArray(content) ? content : []).map((p) => {
    if (typeof p?.text === 'string') return { type: 'text', text: p.text };
    if (p?.type === 'input_image') {
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(p.image_url ?? ''));
      return m ? picture(m[1], m[2]) : { type: 'text', text: `[image ${str(p.image_url).slice(0, 200)}]` };
    }
    return { type: 'other', value: p };
  });
}

/* what Codex puts in as the person's words by itself: its environment, the project's AGENTS.md and the like */
const CODEX_CONTEXT = [
  [/^\s*<environment_context>/, 'environment_context'],
  [/^\s*# AGENTS\.md instructions/, 'AGENTS.md'],
  [/^\s*<user_instructions>/, 'user_instructions'],
  [/^\s*<turn_aborted>/, 'turn_aborted'],
];

/** An output of a request (what the model said or asked for), as a part of its answer; null for anything else. */
function codexOutput(item) {
  switch (item?.type) {
    case 'message': return item.role === 'assistant' ? codexParts(item.content) : null;
    case 'reasoning': {
      const said = [...(item.summary ?? []), ...(item.content ?? [])].map((s) => s?.text).filter((t) => typeof t === 'string');
      return [{ type: 'thinking', thinking: said.length ? said.join('\n\n') : item.encrypted_content ? '[encrypted]' : '' }];
    }
    case 'function_call': {
      let args = item.arguments;
      try { args = JSON.parse(item.arguments); } catch { /* as written */ }
      return [{ type: 'toolCall', id: String(item.call_id ?? item.id ?? ''), name: String(item.name ?? ''), arguments: args ?? {} }];
    }
    case 'custom_tool_call': return [{ type: 'toolCall', id: String(item.call_id ?? item.id ?? ''), name: String(item.name ?? ''), arguments: item.input ?? '' }];
    case 'local_shell_call': return [{ type: 'toolCall', id: String(item.call_id ?? item.id ?? ''), name: 'local_shell', arguments: item.action ?? {} }];
    case 'web_search_call': return [{ type: 'toolCall', id: String(item.id ?? ''), name: 'web_search', arguments: item.action ?? {} }];
    case 'image_generation_call': return [{ type: 'toolCall', id: String(item.id ?? ''), name: 'image_generation', arguments: { prompt: item.revised_prompt ?? '' } }];
    default: return null;
  }
}

/** An input of a request (a message to the model, a tool's output), as a message; null for anything else. */
function codexInput(item, tools) {
  if (item?.type === 'message' && item.role !== 'assistant') {
    const content = codexParts(item.content);
    if (item.role === 'user') {
      const text = content.map((p) => p.text ?? '').join('');
      const known = CODEX_CONTEXT.find(([re]) => re.test(text));
      if (known) return { role: 'context', as: 'user', label: known[1], content };
      return { role: 'user', content };
    }
    return { role: 'context', as: String(item.role), label: String(item.role), content };
  }
  if (/_call_output$/.test(String(item?.type))) {
    const out = item.output;
    const content = typeof out === 'string' ? [{ type: 'text', text: out }]
      : Array.isArray(out) ? codexParts(out)
        : typeof out?.content === 'string' ? [{ type: 'text', text: out.content }] : [{ type: 'text', text: str(out) }];
    return { role: 'toolResult', toolCallId: String(item.call_id ?? ''), toolName: tools.get(item.call_id) ?? 'tool', content, isError: out?.success === false };
  }
  return null;
}

/**
 * The requests in one Codex rollout that ended between `from` and `to` (ms), each whole: the base instructions as
 * its system prompt, everything before it as its messages, what it said and asked for as its answer, its usage, and
 * the turn's settings (model, effort, permissions). No tools: Codex does not keep them.
 */
export function codexCallsOf(entries, { from = 0, to = Infinity } = {}) {
  let systemPrompt = null;
  let settings = null;
  const history = [];
  const tools = new Map();
  let out = [];
  let sentAt = null;
  const calls = [];
  const usageRecords = entries.some((e) => e?.type === 'token_usage_record');
  const close = (at, usage) => {
    if (!out.length && !usage) return;
    const answer = { role: 'assistant', content: out, usage: codexUsage(usage ?? {}),
      ...(settings?.model ? { responseModel: settings.model } : {}), ...(settings?.effort ? { thinkingLevel: settings.effort } : {}) };
    for (const part of out) if (part.type === 'toolCall') tools.set(part.id, part.name);
    const started = sentAt ?? at ?? 0;
    if ((at ?? started) >= from && (at ?? started) <= to) {
      calls.push({ startedAt: started, ms: Math.max(0, (at ?? started) - started), messages: history.map((m) => ({ ...m })), systemPrompt, tools: null, toolsUnknown: true, answer, ...(settings ? { settings } : {}) });
    }
    if (out.length) history.push({ role: 'assistant', content: out });
    out = [];
    sentAt = null;
  };
  for (const e of entries) {
    const p = e?.payload ?? {};
    const at = ms(e?.timestamp);
    if (e?.type === 'session_meta') {
      const base = p.base_instructions ?? p.instructions;
      systemPrompt = typeof base === 'string' ? base : typeof base?.text === 'string' ? base.text : systemPrompt;
    } else if (e?.type === 'turn_context') {
      settings = p;
    } else if (e?.type === 'compacted') {
      close(at, null);
      history.length = 0;
      const kept = Array.isArray(p.replacement_history) ? p.replacement_history.map((i) => codexInput(i, tools) ?? (codexOutput(i) ? { role: 'assistant', content: codexOutput(i) } : null)).filter(Boolean) : [];
      history.push(...(kept.length ? kept : [{ role: 'context', as: 'user', label: 'compaction summary', content: [{ type: 'text', text: str(p.message) }] }]));
    } else if (e?.type === 'response_item') {
      const said = codexOutput(p);
      if (said) { sentAt ??= at; out.push(...said); continue; }
      const input = codexInput(p, tools);
      if (!input) continue;
      /* an input while an answer is open: that answer ended without its usage being kept */
      if (out.length) close(at, null);
      history.push(input);
      sentAt = at;
    } else if (e?.type === 'token_usage_record' || (!usageRecords && e?.type === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage)) {
      close(at, e.type === 'token_usage_record' ? p.usage : p.info.last_token_usage);
    }
  }
  close(null, null);
  return calls;
}

export const codexCalls = (file, { from = 0, to = Infinity } = {}) => codexCallsOf(lines(file), { from, to });

/* ── Kimi ────────────────────────────────────────────────────────────────── */

/**
 * The folder of a Kimi session, or null: as ~/.kimi-code/session_index.jsonl names it (`session_<uuid>`, its ACP id
 * with or without the prefix).
 */
export function findKimiRecord({ sessionId, home = homedir() }) {
  const id = String(sessionId ?? '');
  if (!/^[\w-]{8,90}$/.test(id)) return null;
  const want = new Set([id, id.startsWith('session_') ? id : `session_${id}`]);
  for (const line of lines(join(home, '.kimi-code', 'session_index.jsonl'))) {
    if (want.has(line?.sessionId) && typeof line.sessionDir === 'string' && existsSync(join(line.sessionDir, 'agents', 'main', 'wire.jsonl'))) return line.sessionDir;
  }
  return null;
}

/** Kimi's usage as the turn log counts it. */
const kimiUsage = (u = {}) => ({
  input: Number(u.inputOther) || 0,
  cacheRead: Number(u.inputCacheRead) || 0,
  cacheWrite: Number(u.inputCacheCreation) || 0,
  output: Number(u.output) || 0,
  reasoning: 0,
});

/**
 * The requests in one agent's `wire.jsonl` of a Kimi session that began between `from` and `to` (ms), each whole:
 * the system prompt in effect (`config.update`), the tools (`llm.tools_snapshot`), the conversation so far, the answer
 * (its thinking, words and tool calls, `content.part` and `tool.call`) and its usage (`step.end`). `settings`: the
 * request's model and effort, and how many messages Kimi says it sent (`messageCount`).
 */
export function kimiCallsOf(entries, { from = 0, to = Infinity, thread = null } = {}) {
  let systemPrompt = null;
  let tools = null;
  const history = [];
  const names = new Map();
  let open = null;
  let results = [];
  const calls = [];
  const close = (at, end) => {
    if (!open) return;
    const answer = { role: 'assistant', content: open.out, usage: kimiUsage(end?.usage), stopReason: end?.finishReason ?? null,
      ...(open.request.model ? { responseModel: open.request.modelAlias || open.request.model } : {}),
      ...(open.request.provider ? { provider: open.request.provider } : {}), ...(open.request.thinkingEffort ? { thinkingLevel: open.request.thinkingEffort } : {}) };
    if (open.at >= from && open.at <= to) {
      const { type: _t, time: _time, ...settings } = open.request;
      /* the model's own time, as Kimi measured it: the step's end comes after the tools it asked for have run */
      const took = Number(end?.llmFirstTokenLatencyMs ?? 0) + Number(end?.llmStreamDurationMs ?? 0) || Math.max(0, (open.last ?? at ?? open.at) - open.at);
      calls.push({ startedAt: open.at, ms: took, messages: open.messages, systemPrompt, tools, answer, settings, ...(thread ? { thread } : {}) });
    }
    if (open.out.length) history.push({ role: 'assistant', content: open.out });
    history.push(...results);
    results = [];
    open = null;
  };
  for (const e of entries) {
    const at = Number(e?.time) || null;
    switch (e?.type) {
      case 'config.update': if (typeof e.systemPrompt === 'string') systemPrompt = e.systemPrompt; break;
      case 'llm.tools_snapshot': if (Array.isArray(e.tools)) tools = e.tools.map((t) => ({ name: t?.name, description: t?.description, parameters: t?.parameters })); break;
      case 'llm.request':
        close(at, null);
        open = { at: at ?? 0, request: e, messages: history.map((m) => ({ ...m })), out: [] };
        break;
      case 'context.append_message': {
        const m = e.message ?? {};
        const content = codexParts(m.content);
        history.push(m.role === 'user' ? { role: 'user', content } : { role: 'context', as: String(m.role ?? 'user'), label: String(m.role ?? 'message'), content });
        break;
      }
      case 'context.append_loop_event': {
        const ev = e.event ?? {};
        if (open && (ev.type === 'content.part' || ev.type === 'tool.call')) open.last = at ?? open.last;
        if (ev.type === 'content.part' && open) {
          const part = ev.part ?? {};
          if (typeof part.think === 'string') open.out.push({ type: 'thinking', thinking: part.think });
          else if (typeof part.text === 'string') open.out.push({ type: 'text', text: part.text });
          else open.out.push({ type: 'other', value: part });
        } else if (ev.type === 'tool.call' && open) {
          names.set(ev.toolCallId, ev.name);
          open.out.push({ type: 'toolCall', id: String(ev.toolCallId ?? ''), name: String(ev.name ?? ''), arguments: ev.args ?? {} });
        } else if (ev.type === 'tool.result') {
          const r = ev.result ?? {};
          const said = typeof r.output === 'string' ? r.output : str(r.output ?? r);
          const result = { role: 'toolResult', toolCallId: String(ev.toolCallId ?? ''), toolName: names.get(ev.toolCallId) ?? 'tool', content: [{ type: 'text', text: said }], isError: r.isError === true || r.error != null };
          if (open) results.push(result); else history.push(result);
        } else if (ev.type === 'step.end') close(at, ev);
        break;
      }
      default: break;
    }
  }
  close(null, null);
  return calls;
}

/** Every request of a Kimi session, and of its subagents, between `from` and `to`, in time order. */
export function kimiCalls(sessionDir, { from = 0, to = Infinity } = {}) {
  let agents = [];
  try { agents = readdirSync(join(sessionDir, 'agents')); } catch { return []; }
  return agents.flatMap((name) => kimiCallsOf(lines(join(sessionDir, 'agents', name, 'wire.jsonl')), { from, to, thread: name === 'main' ? null : { id: name, label: `subagent ${name}` } }))
    .sort((a, b) => a.startedAt - b.startedAt);
}

/* ── Copilot ─────────────────────────────────────────────────────────────── */

/** The events of a Copilot session, or null: in its session state, by its ACP id. */
export function findCopilotRecord({ sessionId, env = {}, home = homedir() }) {
  if (!/^[\w-]{8,80}$/.test(String(sessionId ?? ''))) return null;
  const file = join(env.COPILOT_HOME || join(home, '.copilot'), 'session-state', sessionId, 'events.jsonl');
  return existsSync(file) ? file : null;
}

/**
 * The requests in a Copilot session's events whose answers came between `from` and `to` (ms), rebuilt from them:
 * each `session.usage_record` is one request, its answer the `assistant.message` of the same API call, and what
 * came before it its messages. `settings`: the request's model, and how big Copilot says its body was.
 */
export function copilotCallsOf(entries, { from = 0, to = Infinity } = {}) {
  let systemPrompt = null;
  const history = [];
  const names = new Map();
  const calls = [];
  /** answers by their API call: an answer's message may come just before its usage record, or just after */
  const answers = new Map();
  for (const e of entries) {
    if (e?.type === 'assistant.message' && e.data?.apiCallId) answers.set(e.data.apiCallId, e.data);
  }
  const said = (d) => [
    ...(typeof d?.reasoningText === 'string' && d.reasoningText ? [{ type: 'thinking', thinking: d.reasoningText }] : []),
    ...(typeof d?.content === 'string' && d.content ? [{ type: 'text', text: d.content }] : []),
    ...(d?.toolRequests ?? []).map((r) => ({ type: 'toolCall', id: String(r?.toolCallId ?? ''), name: String(r?.name ?? ''), arguments: r?.arguments ?? {} })),
  ];
  for (const e of entries) {
    const d = e?.data ?? {};
    switch (e?.type) {
      case 'system.message': if (typeof d.content === 'string') systemPrompt = d.content; break;
      case 'user.message': history.push({ role: 'user', content: [{ type: 'text', text: String(d.transformedContent ?? d.content ?? '') }] }); break;
      case 'assistant.message': {
        const content = said(d);
        for (const part of content) if (part.type === 'toolCall') names.set(part.id, part.name);
        if (content.length) history.push({ role: 'assistant', content });
        break;
      }
      case 'tool.execution_complete': {
        const r = d.result ?? {};
        history.push({ role: 'toolResult', toolCallId: String(d.toolCallId ?? ''), toolName: names.get(d.toolCallId) ?? 'tool',
          content: [{ type: 'text', text: typeof r.content === 'string' ? r.content : str(r.content ?? d.error ?? r) }], isError: d.success === false });
        break;
      }
      case 'session.usage_record': {
        const u = d.usage ?? {};
        const at = ms(e.timestamp) ?? 0;
        if (at < from || at > to) break;
        const took = Number(u.duration) || 0;
        const reply = answers.get(u.apiCallId);
        const cacheRead = Number(u.cacheReadTokens) || 0;
        const cacheWrite = Number(u.cacheWriteTokens) || 0;
        calls.push({
          startedAt: at - took, ms: took, messages: history.map((m) => ({ ...m })), systemPrompt, tools: null,
          answer: { role: 'assistant', content: reply ? said(reply) : [],
            usage: { input: Math.max(0, (Number(u.inputTokens) || 0) - cacheRead - cacheWrite), cacheRead, cacheWrite, output: Number(u.outputTokens) || 0, reasoning: Number(u.reasoningTokens) || 0 },
            ...(u.model ? { responseModel: String(u.model) } : {}) },
          settings: { model: u.model ?? null, initiator: u.initiator ?? null, requestBodyBytes: u.requestBodyBytes ?? null, availableToolCount: u.availableToolCount ?? null },
          lacks: ['copilotRebuilt'],
        });
        break;
      }
      default: break;
    }
  }
  return calls;
}

export const copilotCalls = (file, { from = 0, to = Infinity } = {}) => copilotCallsOf(lines(file), { from, to });

/* ── all ─────────────────────────────────────────────────────────────────── */

/**
 * A turn's requests, read from the agent's own record: `{ file, calls }` (calls whole, in time order), or null when
 * the agent keeps none this can read. `from`/`to`: the turn's start and end (ms); `env`: where the person's agent keeps
 * its records (CLAUDE_CONFIG_DIR, CODEX_HOME), as their shell sets it; `home`, theirs (Kimi's are in it); `log`: the
 * log an agent of agent-logs.mjs was started with (its turn log's `opened.log`).
 */
export function agentRecordCalls({ agent, sessionId, cwd, from, to, env = {}, home = homedir(), log = null }) {
  if (LOGGED_AGENTS.includes(agent)) {
    const read = agentLogCalls({ agent, sessionId, log, from, to });
    return read ? { file: read.file, calls: read.calls.map((c) => ({ ...c, source: { agent, file: read.file } })) } : null;
  }
  const file = agent === 'claude' ? findClaudeRecord({ sessionId, cwd, env })
    : agent === 'codex' ? findCodexRecord({ sessionId, env })
      : agent === 'kimi' ? findKimiRecord({ sessionId, home })
        : agent === 'copilot' ? findCopilotRecord({ sessionId, env, home }) : null;
  if (!file) return null;
  const read = { claude: claudeCalls, codex: codexCalls, kimi: kimiCalls, copilot: copilotCalls }[agent];
  const calls = read(file, { from, to });
  return { file, calls: calls.map((c) => ({ ...c, source: { agent, file } })) };
}

/**
 * Calls as the turn log keeps them: each line only what is new since the one before (`prefix`: how many of that
 * one's messages come first, then its own), its system prompt, tools, settings and source only when they changed.
 * Read back whole by the chat's lib/model-calls.ts.
 */
export function compactCalls(calls) {
  let keys = [];
  const last = { systemPrompt: 'null', tools: 'null', settings: 'null', source: 'null', thread: 'null' };
  return calls.map((call) => {
    const all = call.messages.map((m) => JSON.stringify(m));
    let prefix = 0;
    while (prefix < keys.length && prefix < all.length && keys[prefix] === all[prefix]) prefix += 1;
    keys = all;
    const line = { startedAt: call.startedAt, ms: call.ms, prefix, messages: call.messages.slice(prefix), answer: call.answer ?? null };
    for (const field of /** @type {const} */ (['systemPrompt', 'tools', 'settings', 'source', 'thread'])) {
      const key = JSON.stringify(call[field] ?? null);
      if (key !== last[field]) { line[field] = call[field] ?? null; last[field] = key; }
    }
    if (call.toolsUnknown) line.toolsUnknown = true;
    if (call.lacks?.length) line.lacks = call.lacks;
    return line;
  });
}
