'use client';

/**
 * Runs the user's own Codex / Claude Code in the chat panel (see apps/desktop/src/local-agents-ipc.mjs).
 *
 * These turns never touch the server: no progress stream, nothing stored there. The shell starts the
 * agent's ACP adapter on this machine; what it says and does arrives event by event on
 * `desktop:local-agents:event`. Here those events are projected onto the three the chat panel knows
 * (agent-text / agent-act / agent-act-done) and fed to the same `reduceTranscript`, so the panel has one
 * rendering path whoever is thinking.
 *
 * One conversation of the chat + one agent = one session of the agent's own, reused across turns: it
 * remembers the conversation, as when chatting on in its own interface. Its id is kept with the
 * conversation, so after a restart, a reload or an idle session closed, the next turn takes it up where
 * it stopped (the agent's own resume), and a new conversation is a new session.
 */
import React from 'react';
import {
  askOutcome,
  publicActivity,
  publicActivityResult,
  publicAsk,
  AGENT_ASK_ANSWER_MAX,
  type AgentAct,
  type PublicGenerationEvent,
} from '@openfilm/shared';
import type { Turn } from '@openfilm/shared';
import type { Balance } from '@/lib/balance';
import { chatTurns, putChatTurn, type SavedTurn } from '@/lib/chat-store';
import { app } from '../app-bridge';
import { isEmptyBackgroundTurn, opensUnprompted } from '@/lib/unprompted';
import { reduceTranscript, type TranscriptItem, type TranscriptPlanEntry } from '@/lib/agent-transcript';
import {
  desktopBridge,
  type LocalAgentAnswer,
  type LocalAgentEvent,
  type LocalAgentId,
  type LocalAgentRunningTurn,
  type LocalAgentTurnMeta,
  type LocalAgentQuestion,
  type LocalAgentSessionInfo,
  type PromptImage,
} from '@/lib/desktop-bridge';

/** These turns exist only on this machine: anything that would ask the server about an id must recognize them and skip it. */
const LOCAL_TURN_PREFIX = 'local:';

export function makeLocalAgentTurnId(): string {
  return `${LOCAL_TURN_PREFIX}${Math.random().toString(36).slice(2, 12)}`;
}

export function isLocalAgentTurnId(id: string): boolean {
  return id.startsWith(LOCAL_TURN_PREFIX);
}

export interface LocalActivity {
  act: AgentAct;
  query?: string;
  /** File name / command, see TranscriptItem.detail. */
  detail?: string;
}

/** The fields of a tool_call besides title and kind that tell which file it touches (as ACP sends them). */
export interface LocalToolExtra {
  locations?: unknown;
  content?: unknown;
}

const DETAIL_MAX = 60;

function clipDetail(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > DETAIL_MAX ? `${one.slice(0, DETAIL_MAX - 1)}…` : one;
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
}

/** The files this call touches: ACP's locations, and the path in diff content such as an edit's. */
function touchedFiles(extra: LocalToolExtra | undefined, rawInput: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value && !out.includes(value)) out.push(value);
  };
  if (Array.isArray(extra?.locations)) for (const loc of extra.locations) add((loc as { path?: unknown })?.path);
  if (Array.isArray(extra?.content)) for (const c of extra.content) add((c as { path?: unknown })?.path);
  add(rawInput.path);
  add(rawInput.file_path);
  add(rawInput.filePath);
  return out;
}

function filesDetail(files: string[]): string | undefined {
  if (!files.length) return undefined;
  const first = baseName(files[0]!);
  return clipDetail(files.length > 1 ? `${first} +${files.length - 1}` : first);
}

/** The command it runs, without the `bash -lc '…'` wrapper. */
function commandDetail(title: string, rawInput: Record<string, unknown>): string | undefined {
  const raw = rawInput.command;
  /* Codex sends argv: ["/bin/zsh", "-lc", "ls mg"]; the real command is the last entry */
  const argv = Array.isArray(raw) ? raw.map(String) : null;
  let command = argv
    ? (argv.length === 3 && /^-l?c$/.test(argv[1]!) ? argv[2]! : argv.join(' '))
    : typeof raw === 'string' ? raw : title;
  const shell = /^(?:\/\S+\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(command.trim());
  if (shell) command = shell[2]!;
  command = command.replace(/^`+|`+$/g, '').trim();
  /* `cd "/Users/…/Projects/a film" && node x.mjs`: the first part only enters the project folder and is the
     same for every command, so a column of them is the same truncated path. Show what actually runs. */
  command = command.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, '').trim();
  /* Before the command is known, Claude Code's title is just "Terminal": it says nothing, so show nothing */
  if (!command || (!argv && typeof raw !== 'string' && /^terminal$/i.test(command))) return undefined;
  return clipDetail(command);
}

/** The words actually searched for in titles like "Search for 'x' in path" or "Web search: x". */
function searchedFor(title: string, rawInput: Record<string, unknown>): string | undefined {
  for (const key of ['query', 'pattern', 'q']) {
    const value = rawInput[key];
    if (typeof value === 'string' && value.trim()) return clipDetail(value);
  }
  const quoted = /'([^']+)'|"([^"]+)"|`([^`]+)`/.exec(title);
  const hit = quoted?.[1] ?? quoted?.[2] ?? quoted?.[3] ?? /:\s*(.+)$/.exec(title)?.[1];
  return hit ? clipDetail(hit) : undefined;
}

/**
 * The name of our own MCP tool in this call (`mcp__openfilm__look`); undefined for anyone else's tools.
 * Codex reports the title `mcp.openfilm.check` with kind execute and the input wrapped in
 * rawInput.arguments (next to server / tool); Claude Code reports the title `mcp__openfilm__look`.
 */
export function ourToolName(title: string | undefined, rawInput: unknown): string | undefined {
  const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as { server?: unknown; tool?: unknown };
  if (input.server === 'openfilm' && typeof input.tool === 'string') return `mcp__openfilm__${input.tool}`;
  const ours = /^(?:mcp__|mcp\.)?openfilm(?:__|\.|:|\/)(.+)$/i.exec((title ?? '').trim());
  return ours ? `mcp__openfilm__${ours[1]!.trim()}` : undefined;
}

/**
 * One tool call → its act row in the chat panel, or null (not drawn).
 *
 * Our own MCP tools go through the same projection as on the server (publicActivity): titles such as
 * `mcp__openfilm__look` or `openfilm.look` give the tool name once the prefix is stripped.
 *
 * The agent's own tools (read, search, edit files, run commands) are drawn by ACP kind as files.* /
 * command.run, with the file name or the command. This is the user's own agent working in the user's own
 * folder; hiding these would leave two minutes of reading files with no rows, which looks stuck.
 */
export function localToolActivity(
  title: string | undefined,
  kind: string | undefined,
  rawInput: unknown,
  extra?: LocalToolExtra,
): LocalActivity | null {
  const name = (title ?? '').trim();
  /* Internal steps such as MCP startup (`…__startup`) are not drawn */
  if (/__startup$/.test(name)) return null;
  /* How Codex reports an MCP call: title `mcp.openfilm.check`, kind execute, the real input wrapped in
     rawInput.arguments (next to server / tool). Recognize that first. */
  const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown> & { server?: unknown; tool?: unknown; arguments?: unknown };
  const tool = ourToolName(name, rawInput);
  if (tool) return publicActivity(tool, input.arguments ?? (input.server === 'openfilm' ? {} : rawInput)) ?? null;
  /* Other MCP tools (Codex's own browser, computer use…): not film work, not drawn */
  if (typeof input.server === 'string' || /^mcp[._]/.test(name)) return null;
  const files = touchedFiles(extra, input);
  const detail = (value: string | undefined) => (value ? { detail: value } : {});
  switch (kind) {
    case 'read':
      /* Codex viewing an image (View Image …) is a read too */
      return { act: 'files.read', ...detail(filesDetail(files) ?? (name ? clipDetail(name.replace(/^(?:Read|View Image)\s+/i, '')) : undefined)) };
    case 'search':
      if (/^web search/i.test(name)) return { act: 'research.search', ...(searchedFor(name, input) ? { query: searchedFor(name, input)! } : {}) };
      return { act: 'files.search', ...detail(searchedFor(name, input)) };
    case 'edit':
    case 'delete':
    case 'move':
      return { act: 'files.edit', ...detail(filesDetail(files)) };
    case 'execute':
      return { act: 'command.run', ...detail(commandDetail(name, input)) };
    case 'fetch':
      return /search/i.test(name)
        ? { act: 'research.search', ...(searchedFor(name, input) ? { query: searchedFor(name, input)! } : {}) }
        : { act: 'research.read' };
    /* Compacting context, reviewing approvals and the like: its own housekeeping, not work */
    case 'think':
      return null;
    default:
      if (/^image generation$/i.test(name)) return { act: 'asset.genImage' };
      return { act: 'working' };
  }
}

/** The text of a tool result: ACP content blocks, else rawOutput (MCP's `{ content: [{ type: 'text' }] }` or a string). */
function toolResultText(content: unknown, rawOutput: unknown): string | undefined {
  const texts = (blocks: unknown): string[] => (Array.isArray(blocks) ? blocks : []).flatMap((block) => {
    const b = block as { type?: unknown; text?: unknown; content?: { type?: unknown; text?: unknown } };
    if (b?.type === 'text' && typeof b.text === 'string') return [b.text];
    if (b?.type === 'content' && b.content?.type === 'text' && typeof b.content.text === 'string') return [b.content.text];
    return [];
  });
  const fromContent = texts(content);
  if (fromContent.length) return fromContent.join('\n');
  if (typeof rawOutput === 'string') return rawOutput;
  const fromRaw = texts((rawOutput as { content?: unknown } | null)?.content);
  return fromRaw.length ? fromRaw.join('\n') : undefined;
}

/** These only look and never change the film, so the picture need not be re-evaluated after them. */
const LOOK_ONLY = new Set<AgentAct>(['files.read', 'files.search', 'research.search', 'research.read', 'film.review', 'film.frames', 'film.hear', 'film.check']);

type AcpUpdate = Extract<LocalAgentEvent, { kind: 'update' }>['update'];

/**
 * One ACP session/update → one public event for the chat panel (or null). Pure.
 *
 * `partId` numbers the paragraphs of the turn: chunks of one paragraph merge into one row, and a tool
 * call in between starts a new one, as in the server's stream.
 */
export function acpUpdateToEvent(
  update: AcpUpdate,
  ctx: { turnNo: number; part: number; tool?: string },
): PublicGenerationEvent | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = update.content as { type?: string; text?: string } | undefined;
      if (content?.type !== 'text' || !content.text) return null;
      return { type: 'agent-text', turnNo: ctx.turnNo, partId: `${ctx.turnNo}:${ctx.part}`, text: content.text };
    }
    case 'agent_thought_chunk':
      return { type: 'agent-thinking' };
    case 'tool_call': {
      const activity = localToolActivity(
        update.title as string | undefined,
        update.kind as string | undefined,
        update.rawInput,
        { locations: (update as { locations?: unknown }).locations, content: (update as { content?: unknown }).content },
      );
      if (!activity) return null;
      return {
        type: 'agent-act',
        callId: String(update.toolCallId),
        turnNo: ctx.turnNo,
        act: activity.act,
        ...(activity.query ? { query: activity.query } : {}),
      };
    }
    case 'tool_call_update': {
      const status = update.status as string | undefined;
      if (status !== 'completed' && status !== 'failed') return null;
      /* Our own MCP tools: what the result made (audio, an image, look's screenshot) goes through the same
         projection as on the server. The tool name is only on the first tool_call; the caller keeps it and passes it in. */
      const asset = ctx.tool && status === 'completed'
        ? publicActivityResult(ctx.tool, toolResultText(update.content, (update as { rawOutput?: unknown }).rawOutput))
        : null;
      return { type: 'agent-act-done', callId: String(update.toolCallId), ...(asset ? { asset } : {}) };
    }
    default:
      return null;
  }
}

/** This turn's transcript as an external store. */
export interface LocalTranscriptStore {
  get(): TranscriptItem[];
  subscribe(fn: () => void): () => void;
}

export interface LocalRunState {
  thinking: boolean;
  /** Goes up by one after each tool call: the film may have changed, so the picture should be re-evaluated. */
  revision: number;
  /** A permission request waiting for the user's answer, or null. */
  permission: { requestId: string; title: string; options: Array<{ optionId: string; name: string; kind: string }> } | null;
  /** The question it asked the user (Claude Code's AskUserQuestion, Codex's request_user_input), waiting for an answer, or null. */
  question: { requestId: string; callId: string; questions: LocalAgentQuestion[] } | null;
  error: string | null;
  /** the service the app's own agent runs on had no balance left for this turn (lib/balance); then `error` is null */
  balance: Balance | null;
}

type Listener = () => void;

/** One local agent turn: the transcript and some state, both external stores, so only subscribers re-render. */
export class LocalAgentTurn {
  items: TranscriptItem[] = [];
  state: LocalRunState = { thinking: false, revision: 0, permission: null, question: null, error: null, balance: null };
  private listeners = new Set<Listener>();
  private part = 0;
  private lastWasText = false;
  /* Each paragraph accumulates its full text here. The panel's merge (mergeStreamText) is made for whole
     snapshots and drops a chunk already present in the text as a repeat, so a lone space in ACP's small
     deltas could vanish ("the5-second"). Handing over the whole paragraph, it is taken as is. */
  private partText = new Map<number, string>();

  constructor(readonly turnId: string, readonly agent: LocalAgentId, readonly turnNo: number) {}

  readonly store: LocalTranscriptStore = {
    get: () => this.items,
    subscribe: (fn) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; },
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  patch(next: Partial<LocalRunState>): void {
    this.state = { ...this.state, ...next };
    this.emit();
  }

  /** When its last update arrived (see drain). */
  lastEventAt = Date.now();

  apply(update: AcpUpdate): void {
    this.lastEventAt = Date.now();
    const kind = update.sessionUpdate;
    const closed = kind !== 'agent_thought_chunk' && this.closeThought();
    if (kind === 'tool_call' || kind === 'agent_thought_chunk' || kind === 'plan' || kind === 'notice') {
      if (this.lastWasText) this.part += 1;
      this.lastWasText = false;
    }
    if (kind === 'agent_thought_chunk') { this.think(update); return; }
    if (kind === 'plan') { this.plan(update); return; }
    if (kind === 'notice') { this.agentNotice(update); return; }
    const callId = (update as { toolCallId?: unknown }).toolCallId;
    const tool = kind === 'tool_call_update' && callId != null
      ? this.calls.get(String(callId))?.tool
        ?? ourToolName((update as { title?: unknown }).title as string | undefined, (update as { rawInput?: unknown }).rawInput)
      : undefined;
    let event = acpUpdateToEvent(update, { turnNo: this.turnNo, part: this.part, ...(tool ? { tool } : {}) });
    if (kind === 'agent_message_chunk') this.lastWasText = true;
    if (kind === 'tool_call' && event?.type === 'agent-act') {
      const u = update as { toolCallId?: unknown; title?: unknown; kind?: unknown; rawInput?: unknown; locations?: unknown; content?: unknown };
      const tool = ourToolName(typeof u.title === 'string' ? u.title : undefined, u.rawInput);
      this.calls.set(String(u.toolCallId), {
        ...(typeof u.title === 'string' ? { title: u.title } : {}),
        ...(typeof u.kind === 'string' ? { kind: u.kind } : {}),
        ...(tool ? { tool } : {}),
      });
      /* It asked the user through our MCP (ask_user): the question and options go on this row, and the panel shows the card */
      const input = (u.rawInput && typeof u.rawInput === 'object' ? u.rawInput : {}) as { tool?: unknown; arguments?: unknown };
      this.pendingAsk = publicAsk(
        typeof input.tool === 'string' ? `mcp__openfilm__${input.tool}` : String(u.title ?? '').replace(/^mcp[._]openfilm[._]/, 'mcp__openfilm__'),
        input.arguments ?? u.rawInput,
      ) ?? undefined;
      this.pendingDetail = localToolActivity(
        typeof u.title === 'string' ? u.title : undefined,
        typeof u.kind === 'string' ? u.kind : undefined,
        u.rawInput,
        { locations: u.locations, content: u.content },
      )?.detail;
    }
    if (kind === 'tool_call_update') this.refineAct(update);
    if (!event) { if (closed || kind === 'tool_call_update') this.emit(); return; }
    if (event.type === 'agent-text') {
      const full = (this.partText.get(this.part) ?? '') + event.text;
      this.partText.set(this.part, full);
      event = { ...event, text: full };
    }
    this.items = reduceTranscript(this.items, event);
    if (event.type === 'agent-act') {
      const detail = this.pendingDetail;
      this.pendingDetail = undefined;
      if (detail) this.patchItem(`act:${event.callId}`, { detail });
      const ask = this.pendingAsk;
      this.pendingAsk = undefined;
      if (ask) this.patchItem(`act:${event.callId}`, { ask });
    }
    let revision = this.state.revision;
    if (event.type === 'agent-act-done') {
      const act = this.items.find((item) => item.id === `act:${event.callId}`)?.act;
      if (!act || !LOOK_ONLY.has(act)) revision += 1;
    }
    /* the state is a new object only when it changed: the chat around the turn re-renders on it, the words do not */
    if (this.state.thinking || this.state.revision !== revision) this.state = { ...this.state, thinking: false, revision };
    this.emit();
  }

  /** acpUpdateToEvent only yields the closed-set fields; the file name / command reaches the next agent-act from here. */
  private pendingDetail: string | undefined;
  private pendingAsk: TranscriptItem['ask'];
  /** Each call's first title and kind: later updates often carry only the fields that changed. */
  private calls = new Map<string, { title?: string; kind?: string; tool?: string }>();
  private thoughtNo = 0;
  private openThought: string | null = null;

  private patchItem(id: string, patch: Partial<TranscriptItem>): void {
    const at = this.items.findIndex((item) => item.id === id);
    if (at < 0) return;
    const next = [...this.items];
    next[at] = { ...next[at]!, ...patch };
    this.items = next;
  }

  /** It is thinking: one stretch of thought is one row ("Thought for 6s"); anything in between starts a new one. */
  private think(update: AcpUpdate): void {
    const content = (update as { content?: { type?: string; text?: string } }).content;
    const text = content?.type === 'text' ? content.text ?? '' : '';
    if (!this.openThought) {
      this.thoughtNo += 1;
      this.openThought = `thought:${this.turnNo}:${this.thoughtNo}`;
      this.items = [...this.items, { id: this.openThought, kind: 'thought', text, turnNo: this.turnNo, pending: true, startedAt: Date.now() }];
    } else if (text) {
      const prev = this.items.find((item) => item.id === this.openThought);
      this.patchItem(this.openThought, { text: (prev?.text ?? '') + text });
    }
    if (!this.state.thinking) this.state = { ...this.state, thinking: true };
    this.emit();
  }

  private closeThought(): boolean {
    if (!this.openThought) return false;
    this.patchItem(this.openThought, { pending: false, endedAt: Date.now() });
    this.openThought = null;
    return true;
  }

  /** A plan always arrives whole: one per turn, replaced in place where it first appeared. */
  private plan(update: AcpUpdate): void {
    const raw = (update as { entries?: Array<{ content?: unknown; status?: unknown }> }).entries ?? [];
    const plan: TranscriptPlanEntry[] = raw
      .filter((entry) => typeof entry.content === 'string' && entry.content.trim())
      .map((entry) => ({
        content: String(entry.content).trim(),
        status: entry.status === 'completed' || entry.status === 'in_progress' ? entry.status : 'pending',
      }));
    const id = `plan:${this.turnNo}`;
    if (this.items.some((item) => item.id === id)) this.patchItem(id, { plan });
    else if (plan.length) this.items = [...this.items, { id, kind: 'plan', plan, turnNo: this.turnNo, pending: false, startedAt: Date.now() }];
    this.emit();
  }

  /**
   * A note from the agent itself (ACP `notice`: Codex's warnings, its context compaction), in its own words. It
   * is not part of the reply, so it gets its own row.
   */
  private agentNotice(update: AcpUpdate): void {
    const { title, description } = update as { title?: unknown; description?: unknown };
    const text = [title, description]
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .map((s) => s.trim())
      .join(' — ');
    if (text) {
      this.noticeNo += 1;
      this.items = [...this.items, { id: `notice:${this.turnNo}:agent:${this.noticeNo}`, kind: 'notice', text, turnNo: this.turnNo, pending: false, startedAt: Date.now() }];
    }
    this.emit();
  }

  private noticeNo = 0;

  /** Later fields make the row clearer (Codex sends an edit's diff later, and the title may change). */
  private refineAct(update: AcpUpdate): void {
    const u = update as { toolCallId?: unknown; title?: unknown; kind?: unknown; rawInput?: unknown; locations?: unknown; content?: unknown };
    if (u.title == null && u.locations == null && u.content == null && u.rawInput == null && (update as { rawOutput?: unknown }).rawOutput == null) return;
    const id = `act:${String(u.toolCallId)}`;
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return;
    /* A question asked through our MCP (ask_user): the answer is on the first line of the tool result */
    if (item.ask && !item.ask.status) {
      const outcome = askOutcome(toolResultText(u.content, (update as { rawOutput?: unknown }).rawOutput));
      if (outcome) this.patchItem(id, { ask: { ...item.ask, ...outcome } });
    }
    const first = this.calls.get(String(u.toolCallId));
    const activity = localToolActivity(
      typeof u.title === 'string' ? u.title : first?.title,
      typeof u.kind === 'string' ? u.kind : first?.kind,
      u.rawInput ?? {},
      { locations: u.locations, content: u.content },
    );
    if (!activity || activity.act !== item.act) return;
    if (activity.detail && activity.detail !== item.detail) this.patchItem(id, { detail: activity.detail });
  }

  /**
   * A note the platform leaves in this turn (`noticeKey` is an i18n key), such as an attachment that could
   * not be put in the project folder. One per key.
   */
  notice(noticeKey: string): void {
    const id = `notice:${this.turnNo}:${noticeKey}`;
    if (this.items.some((item) => item.id === id)) return;
    this.items = [...this.items, { id, kind: 'notice', noticeKey, turnNo: this.turnNo, pending: false, startedAt: Date.now() }];
    this.emit();
  }

  /** Ends the turn: finalizes any text and acts still open. */
  seal(): void {
    this.closeThought();
    this.items = this.items.map((item) => (item.pending ? { ...item, pending: false } : item));
    this.state = { ...this.state, thinking: false, permission: null, question: null };
    this.emit();
  }

  /**
   * It asked the user a question: the tool call's row becomes the question row (no new row), and the card
   * shows above the composer. With no matching tool call (the adapter did not report it first), a row is
   * made here and closed here once answered.
   */
  ask(requestId: string, toolCallId: string | null, questions: LocalAgentQuestion[]): void {
    const first = questions[0];
    if (!first) return;
    const ask = { question: first.question, options: first.options };
    const existing = toolCallId != null && this.items.some((item) => item.id === `act:${toolCallId}`);
    const callId = existing ? toolCallId! : `ask:${requestId}`;
    this.closeThought();
    this.items = reduceTranscript(this.items, { type: 'agent-act', callId, turnNo: this.turnNo, act: 'chat.ask', ask });
    this.synthetic = existing ? this.synthetic : new Set(this.synthetic).add(callId);
    this.state = { ...this.state, thinking: false, question: { requestId, callId, questions } };
    this.emit();
  }

  /** Answered (or skipped): the row records the answer. */
  answered(callId: string, answer: string | null): void {
    const id = `act:${callId}`;
    const item = this.items.find((entry) => entry.id === id);
    if (item?.ask) {
      this.patchItem(id, { ask: { ...item.ask, ...(answer ? { answer: answer.slice(0, AGENT_ASK_ANSWER_MAX), status: 'answered' as const } : { status: 'skipped' as const }) } });
    }
    if (this.synthetic.has(callId)) this.items = reduceTranscript(this.items, { type: 'agent-act-done', callId });
    this.state = { ...this.state, question: null };
    this.emit();
  }

  /** Question rows made here (no tool call will close them). */
  private synthetic = new Set<string>();
}

/** The ACP session of one conversation + one agent (`key` is the shell's). Reused across turns. */
interface LiveSession {
  key: string;
  agent: LocalAgentId;
  cwd: string;
  info: LocalAgentSessionInfo;
  /** the project and the conversation it is the session of */
  projectId: string;
  conversation: string;
}

const sessions = new Map<string, LiveSession>();

/**
 * Forget this agent's sessions here (the shell closes its side): the next turn starts a new one, signed
 * in as whatever account it is on now — not the one a session opened earlier was holding.
 */
export function forgetLocalAgentSessions(agent: LocalAgentId): void {
  for (const [k, s] of sessions) if (s.agent === agent) sessions.delete(k);
}
/* ── the agent's own commands (its `/` menu: built-in ones, the person's skills and custom commands), as its sessions
   say them (ACP available_commands_update). Kept by agent: the last list any of its sessions gave, so a new
   conversation has them before its first message. A list that comes before its session is known here waits for it. */

export interface AgentCommand { name: string; description: string; hint: string | null }

/* kept between launches (this page's storage), so the menu has them before the agent's first session */
const COMMANDS_KEY = 'openfilm.agent-commands.v1';
const commandsByAgent = new Map<LocalAgentId, AgentCommand[]>((() => {
  try { return Object.entries(JSON.parse(localStorage.getItem(COMMANDS_KEY) ?? '{}')) as Array<[LocalAgentId, AgentCommand[]]>; } catch { return []; }
})());
const unclaimedCommands = new Map<string, AgentCommand[]>();
const commandListeners = new Set<() => void>();
const NO_COMMANDS: AgentCommand[] = [];

/** The commands as ACP lists them (`availableCommands`: { name, description, input?.hint }). */
export function readCommands(update: Record<string, unknown>): AgentCommand[] {
  const list = Array.isArray(update.availableCommands) ? update.availableCommands as Array<Record<string, unknown>> : [];
  return list.flatMap((c) => (typeof c?.name === 'string' && c.name ? [{
    name: c.name.replace(/^\//, ''),
    description: typeof c.description === 'string' ? c.description : '',
    hint: typeof (c.input as { hint?: unknown } | null)?.hint === 'string' ? (c.input as { hint: string }).hint : null,
  }] : []));
}

/** The agent's commands as one of its sessions said them (the menu's probe too). */
export function keepCommands(agent: LocalAgentId, list: AgentCommand[]): void {
  commandsByAgent.set(agent, list);
  try { localStorage.setItem(COMMANDS_KEY, JSON.stringify(Object.fromEntries(commandsByAgent))); } catch { /* kept for this launch */ }
  for (const listener of commandListeners) listener();
}

/** The agent's commands, for the composer's `/` menu (empty until one of its sessions has said them). */
export function useAgentCommands(agent: LocalAgentId): AgentCommand[] {
  return React.useSyncExternalStore(
    (listener) => { commandListeners.add(listener); return () => { commandListeners.delete(listener); }; },
    () => commandsByAgent.get(agent) ?? NO_COMMANDS,
    () => NO_COMMANDS,
  );
}

/* ── how full the agent's context is (ACP usage_update): tokens in the conversation now, of its context window, as
   the agent's own chat shows it. By session: each conversation has its own. ── */

export interface AgentContext { used: number; size: number }

const contextByKey = new Map<string, AgentContext>();
const contextListeners = new Set<() => void>();
const tellContext = () => { for (const listener of contextListeners) listener(); };

/** How full the agent's context is in this conversation, once its session has said; null before. */
export function useAgentContext(projectId: string, conversation: string, agent: LocalAgentId): AgentContext | null {
  return React.useSyncExternalStore(
    (listener) => { contextListeners.add(listener); return () => { contextListeners.delete(listener); }; },
    () => {
      const session = sessions.get(`${projectId}:${conversation}:${agent}`);
      return session ? contextByKey.get(session.key) ?? null : null;
    },
    () => null,
  );
}

/* ── the agent working with nobody having written: a background task of its own that ended after its turn (a
   command it ran in the background, a subagent), which it takes up by itself, as in its own chat. Its work is shown
   as a turn of its own in its conversation (`onUnpromptedTurn`, from the page showing the project), which ends with
   the agent's own result for it (a usage_update saying where it came from) or after UNPROMPTED_QUIET_MS of quiet,
   as soon as the person writes, and at once when they stop it. ── */

/** What a turn the agent started by itself needs from the page: the turn to fill, the page's way to settle it
    ('cancelled': the person stopped it), and what the turn's log keeps of it (its conversation), so the log can make
    it again (recoverLoggedTurns). */
export interface UnpromptedTurn { turn: LocalAgentTurn; done: (outcome?: 'cancelled') => void; meta?: LocalAgentTurnMeta }
type UnpromptedHandler = (where: { projectId: string; conversation: string; agent: LocalAgentId }) => UnpromptedTurn | null;

const UNPROMPTED_QUIET_MS = 30_000;
/** words of a turn just ended can come a moment after it: not a turn of the agent's own until this long after */
const AFTER_TURN_MS = 2000;
const turnEndedAt = new Map<string, number>();
const unpromptedHandlers = new Set<UnpromptedHandler>();
const unprompted = new Map<string, UnpromptedTurn & { timer: ReturnType<typeof setTimeout> }>();

/** The page showing a project opens the turns the agent starts by itself in it. Returns a way to stop. */
export function onUnpromptedTurn(handler: UnpromptedHandler): () => void {
  unpromptedHandlers.add(handler);
  return () => { unpromptedHandlers.delete(handler); };
}

function openUnprompted(key: string): LocalAgentTurn | null {
  const session = [...sessions.values()].find((s) => s.key === key);
  if (!session || Date.now() - (turnEndedAt.get(key) ?? 0) < AFTER_TURN_MS) return null;
  let opened: UnpromptedTurn | null = null;
  for (const handler of unpromptedHandlers) {
    opened = handler({ projectId: session.projectId, conversation: session.conversation, agent: session.agent });
    if (opened) break;
  }
  if (!opened) return null;
  turns.set(opened.turn.turnId, opened.turn);
  turnByKey.set(key, opened.turn);
  unprompted.set(key, { ...opened, timer: setTimeout(() => endUnprompted(key), UNPROMPTED_QUIET_MS) });
  void desktopBridge()?.localAgents?.adopt?.(key, opened.turn.turnId, opened.meta);
  return opened.turn;
}

function stillUnprompted(key: string): void {
  const open = unprompted.get(key);
  if (!open) return;
  clearTimeout(open.timer);
  open.timer = setTimeout(() => endUnprompted(key), UNPROMPTED_QUIET_MS);
}

function endUnprompted(key: string, outcome?: 'cancelled'): void {
  const open = unprompted.get(key);
  if (!open) return;
  unprompted.delete(key);
  clearTimeout(open.timer);
  open.turn.seal();
  if (turnByKey.get(key) === open.turn) turnByKey.delete(key);
  turnEndedAt.set(key, Date.now());
  if (current === open.turn) current = null;
  void desktopBridge()?.localAgents?.adopt?.(key, null);
  open.done(outcome);
}

/** Whether this turn is one the agent started by itself (it has no run of the page's to wait on). */
export function isUnpromptedTurn(turnId: string): boolean {
  return [...unprompted.values()].some((open) => open.turn.turnId === turnId);
}

const turns = new Map<string, LocalAgentTurn>();
let current: LocalAgentTurn | null = null;
let unlisten: (() => void) | null = null;
const turnByKey = new Map<string, LocalAgentTurn>();

/** One event from the shell into its turn (live, or replayed after a reload). */
function dispatch(turn: LocalAgentTurn, event: Record<string, unknown> & { kind: string }): void {
  if (event.kind === 'update') turn.apply(event.update as Parameters<LocalAgentTurn['apply']>[0]);
  else if (event.kind === 'question') turn.ask(event.requestId as string, event.toolCallId as string | null, event.questions as never);
  else if (event.kind === 'permission') {
    const params = event.params as { toolCall?: { title?: string }; options?: Array<{ optionId: string; name: string; kind: string }> };
    turn.patch({
      permission: {
        requestId: event.requestId as string,
        title: params.toolCall?.title ?? '',
        options: params.options ?? [],
      },
    });
  }
}

/** Recovered turns (see recoverLocalAgentTurns) wait on the shell's `done` for their key. */
const doneWaiters = new Map<string, (result: { ok: true; stopReason: string } | { ok: false; error: string; balance?: Balance }) => void>();

function listen(): void {
  if (unlisten) return;
  const bridge = desktopBridge()?.localAgents;
  if (!bridge) return;
  unlisten = bridge.onEvent((event) => {
    if (event.kind === 'update' && event.update.sessionUpdate === 'usage_update') {
      const { used, size, _meta } = event.update as { used?: unknown; size?: unknown; _meta?: Record<string, unknown> };
      if (typeof used === 'number' && typeof size === 'number' && size > 0) { contextByKey.set(event.key, { used, size }); tellContext(); }
      /* the agent's result for work it took up by itself (Claude Code says where it came from): that turn is done */
      const origin = _meta?.['_claude/origin'] as { kind?: unknown } | undefined;
      if (origin && origin.kind !== 'human' && unprompted.has(event.key)) endUnprompted(event.key);
      return;
    }
    if (event.kind === 'update' && event.update.sessionUpdate === 'available_commands_update') {
      const list = readCommands(event.update);
      const agent = [...sessions.values()].find((s) => s.key === event.key)?.agent;
      if (agent) keepCommands(agent, list);
      else unclaimedCommands.set(event.key, list);
      return;
    }
    const turn = turnByKey.get(event.key);
    if (event.kind === 'done') {
      const waiter = doneWaiters.get(event.key);
      if (waiter) {
        doneWaiters.delete(event.key);
        waiter(event.ok ? { ok: true, stopReason: event.stopReason ?? 'end_turn' }
          : { ok: false, error: event.error ?? 'The agent stopped.', ...(event.balance ? { balance: event.balance } : {}) });
      }
      return;
    }
    if (event.kind === 'exit') {
      endUnprompted(event.key);
      for (const [k, s] of sessions) if (s.key === event.key) sessions.delete(k);
      if (turn && !turn.state.error && turn === current) turn.patch({ error: 'The agent stopped unexpectedly.' });
      const waiter = doneWaiters.get(event.key);
      if (waiter) { doneWaiters.delete(event.key); waiter({ ok: false, error: 'The agent stopped unexpectedly.' }); }
      return;
    }
    if (turn && unprompted.has(event.key)) stillUnprompted(event.key);
    /* working with nobody having written: a background task of its own came back */
    const taken = turn ?? (event.kind === 'update' && opensUnprompted(event.update) ? openUnprompted(event.key) : null);
    if (taken && !turn) { dispatch(taken, event as Record<string, unknown> & { kind: string }); return; }
    if (!turn) {
      /* The turn has ended or belongs to another window: a permission request must not hang, so deny it,
         unless it is a turn still running from before this page reloaded (the shell still holds it): then
         the question goes back into the conversation for the person to answer */
      if (event.kind === 'permission' || event.kind === 'question') void denyUnlessHeld(event);
      return;
    }
    dispatch(turn, event as Record<string, unknown> & { kind: string });
  });
}

async function denyUnlessHeld(event: Extract<LocalAgentEvent, { kind: 'permission' | 'question' }>): Promise<void> {
  const bridge = desktopBridge()?.localAgents;
  if (!bridge) return;
  const held = await bridge.running?.().then((list) => list.some((r) => r.key === event.key && !r.done), () => false);
  if (held) return;
  if (event.kind === 'permission') void bridge.answerPermission(event.key, event.requestId, null);
  else void bridge.answerQuestion?.(event.key, event.requestId, null);
}

export function localAgentTurn(turnId: string): LocalAgentTurn | null {
  return turns.get(turnId) ?? null;
}

/** Opens a turn: registered first, so the project page can subscribe the moment it shows the turn. */
export function createLocalAgentTurn(turnId: string, agent: LocalAgentId, turnNo = 0): LocalAgentTurn {
  const turn = new LocalAgentTurn(turnId, agent, turnNo);
  turns.set(turnId, turn);
  return turn;
}

const IDLE: LocalRunState = { thinking: false, revision: 0, permission: null, question: null, error: null, balance: null };
const NOOP_SUB = () => () => {};

/**
 * The project page subscribes to the turn: the transcript store (same shape as the server's stream) and
 * some state. Null for a turn that is not local; the caller then uses the server's progress stream.
 */
export function useLocalAgentTurn(turnId: string | null): { turn: LocalAgentTurn; state: LocalRunState } | null {
  const turn = turnId && isLocalAgentTurnId(turnId) ? localAgentTurn(turnId) : null;
  const state = React.useSyncExternalStore(
    turn ? turn.store.subscribe : NOOP_SUB,
    () => (turn ? turn.state : IDLE),
    () => IDLE,
  );
  return turn ? { turn, state } : null;
}

/**
 * Runs a turn. The first time in a conversation it opens a session (starts the adapter, handshakes), going
 * on with the agent's own one when `resume` names it; after that the same conversation reuses it.
 */
export async function runLocalAgentTurn({
  projectId,
  conversation,
  resume = null,
  agent,
  cwd,
  text,
  turn,
  options = {},
  onSessionInfo,
  meta,
  images,
}: {
  projectId: string;
  /** the chat's conversation: each has its own session of the agent's */
  conversation: string;
  /** the agent's own id of this conversation, from a turn before (ProjectSessionItem.agentSessions) */
  resume?: string | null;
  agent: LocalAgentId;
  cwd: string;
  text: string;
  turn: LocalAgentTurn;
  /** the pictures of the message's references, for an agent that takes pictures */
  images?: PromptImage[];
  /** Handed to the shell with the prompt: what a reloaded page needs to put this turn back. */
  meta?: LocalAgentTurnMeta;
  /** Options the user picked in the model menu (configId → value), set one by one once the session is open. */
  options?: Record<string, unknown>;
  onSessionInfo?: (info: LocalAgentSessionInfo) => void;
}): Promise<{ stopReason: string; lastTurnId: string }> {
  const bridge = desktopBridge()?.localAgents;
  if (!bridge) throw new Error('This needs the OpenFilm Mac app.');
  listen();
  turns.set(turn.turnId, turn);
  current = turn;

  const sessionKey = `${projectId}:${conversation}:${agent}`;
  let session = sessions.get(sessionKey);
  if (!session || session.cwd !== cwd) {
    const started = await bridge.start(agent, cwd, resume);
    if (!started.ok) {
      throw Object.assign(new Error(started.error), { code: started.code, install: started.install });
    }
    session = { key: started.key, agent, cwd, info: started.info, projectId, conversation };
    sessions.set(sessionKey, session);
    tellContext();
    const said = unclaimedCommands.get(started.key);
    if (said) { unclaimedCommands.delete(started.key); keepCommands(agent, said); }
    onSessionInfo?.(started.info);
  }
  /* a turn the agent was working on by itself ends as the person writes */
  endUnprompted(session.key);
  turnByKey.set(session.key, turn);

  /* Picked options: set only when they differ from the session's current value, saving a round trip. The model
     first (it decides which efforts there are), then the rest at once */
  const live = session;
  const setOption = async ([configId, value]: [string, unknown]) => {
    const option = live.info.configOptions?.find((o) => o.id === configId);
    if (!option || option.currentValue === value) return;
    const r = await bridge.setOption(live.key, configId, value);
    if (r.ok) option.currentValue = value;
  };
  const picked = Object.entries(options);
  const isModel = ([configId]: [string, unknown]) => live.info.configOptions?.find((o) => o.id === configId)?.category === 'model';
  for (const entry of picked.filter(isModel)) await setOption(entry);
  await Promise.all(picked.filter((entry) => !isModel(entry)).map(setOption));

  /* where it is and how to work (the project, the `openfilm` manual, Studio already open) it was told when the
     session started (apps/desktop src/agents.mjs INSTRUCTIONS): the message goes as the person wrote it */
  const key = session.key;
  /* the turn the agent's words go to at the end: this one, or the last message sent into it while it ran (steer) */
  const last = () => turnByKey.get(key) ?? turn;
  try {
    const r = await bridge.prompt(key, text, meta, images?.length ? images : undefined);
    /* The answer to the prompt can overtake its last updates (the closing words of its reply): stop
       listening only once they have stopped coming, or the saved reply ends mid-sentence. */
    await drain(last());
    if (!r.ok) throw Object.assign(new Error(r.error), { lastTurnId: last().turnId }, r.balance ? { balance: r.balance } : {});
    return { stopReason: r.stopReason, lastTurnId: last().turnId };
  } finally {
    const ended = last();
    turn.seal();
    ended.seal();
    turnByKey.delete(key);
    turnEndedAt.set(key, Date.now());
    if (current === turn || current === ended) current = null;
    if (meta) void bridge.ack?.(key, meta.turnId);
  }
}

/** Whether a message sent while this turn runs can join it (the agent takes steering), rather than wait for its end. */
export function canSteer(turnId: string): boolean {
  if (!desktopBridge()?.localAgents?.steer) return false;
  for (const [key, t] of turnByKey) {
    if (t.turnId !== turnId) continue;
    for (const s of sessions.values()) if (s.key === key) return s.info.steering === true;
  }
  return false;
}

/**
 * A message sent while `fromTurnId` runs, into that turn, as in the agent's own chat: once it has joined, what the
 * agent says and does from then on goes to `next` (the message's own turn in the conversation), and `from` is done.
 * False when it did not join (the turn ended meanwhile, the agent refused): the caller sends it as a turn of its own.
 */
export async function steerLocalAgentTurn(fromTurnId: string, next: LocalAgentTurn, text: string, images?: PromptImage[]): Promise<boolean> {
  const bridge = desktopBridge()?.localAgents;
  const key = [...turnByKey].find(([, t]) => t.turnId === fromTurnId)?.[0];
  if (!bridge?.steer || !key) return false;
  turns.set(next.turnId, next);
  const r = await bridge.steer(key, text, images?.length ? images : undefined).catch(() => null);
  const from = turnByKey.get(key);
  if (!r?.ok || !from || from.turnId !== fromTurnId) return false;
  await drain(from, 150, 1000);
  from.seal();
  turnByKey.set(key, next);
  current = next;
  return true;
}

export interface RecoveredLocalTurn {
  key: string;
  meta: LocalAgentTurnMeta;
  turn: LocalAgentTurn;
  /** Settles when the agent finishes (at once when it already had). */
  finished: Promise<{ ok: true; stopReason: string } | { ok: false; error: string; balance?: Balance }>;
  /** The shell may forget it: the page has saved it. */
  ack(): void;
}

const recovered = new Set<string>();

/**
 * The page was reloaded while a turn ran (the window, its session and the agent stayed): put it back.
 *
 * Its events so far are replayed into a fresh LocalAgentTurn, live ones keep coming on the same channel,
 * and `finished` settles on the shell's `done` — the caller finishes it exactly like a turn it started
 * (engine told the turn ended, transcript saved), so nothing it did is left unrecorded. Each turn once.
 */
export async function recoverLocalAgentTurns(projectId: string): Promise<RecoveredLocalTurn[]> {
  const bridge = desktopBridge()?.localAgents;
  if (!bridge?.running) return [];
  listen();
  let held: LocalAgentRunningTurn[];
  try { held = await bridge.running(); } catch { return []; }
  const out: RecoveredLocalTurn[] = [];
  for (const r of held) {
    const meta = r.meta;
    if (!meta?.turnId || meta.projectId !== projectId || recovered.has(meta.turnId) || turns.has(meta.turnId)) continue;
    recovered.add(meta.turnId);
    const turn = new LocalAgentTurn(meta.turnId, r.agent, meta.turnNo ?? 0);
    turns.set(meta.turnId, turn);
    for (const event of r.events) dispatch(turn, event);
    const sessionKey = `${projectId}:${meta.sessionId}:${r.agent}`;
    if (!sessions.has(sessionKey)) sessions.set(sessionKey, { key: r.key, agent: r.agent, cwd: r.cwd, projectId, conversation: meta.sessionId, info: { sessionId: '', agentInfo: null, authMethods: [], mcp: true, models: null, modes: null, configOptions: null } });
    let finished: RecoveredLocalTurn['finished'];
    if (r.done) {
      turn.seal();
      finished = Promise.resolve(r.done);
    } else {
      turnByKey.set(r.key, turn);
      current = turn;
      finished = new Promise<Awaited<RecoveredLocalTurn['finished']>>((resolve) => {
        doneWaiters.set(r.key, resolve);
        /* it may have finished between the listing and this line: its `done` went by unheard */
        void bridge.running?.().then((now) => {
          const done = now.find((x) => x.key === r.key && x.meta?.turnId === meta.turnId)?.done;
          if (done && doneWaiters.get(r.key) === resolve) { doneWaiters.delete(r.key); resolve(done); }
        }, () => {});
      }).then(async (result) => {
        await drain(turn);
        turn.seal();
        turnByKey.delete(r.key);
        if (current === turn) current = null;
        return result as Awaited<RecoveredLocalTurn['finished']>;
      });
    }
    out.push({ key: r.key, meta, turn, finished, ack: () => { void bridge.ack?.(r.key, meta.turnId); } });
  }
  return out;
}

/** Until no update has come for `quietMs` (at most `maxMs`). */
async function drain(turn: LocalAgentTurn, quietMs = 300, maxMs = 3000): Promise<void> {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const idle = Date.now() - turn.lastEventAt;
    if (idle >= quietMs) return;
    await new Promise((resolve) => setTimeout(resolve, quietMs - idle));
  }
}

export async function cancelLocalAgentTurn(turnId: string): Promise<void> {
  const bridge = desktopBridge()?.localAgents;
  const turn = turns.get(turnId);
  if (!bridge || !turn) return;
  for (const [key, t] of turnByKey) {
    if (t !== turn) continue;
    /* a turn the agent started by itself has no prompt of the page's to end it: it ends here, and the agent is told */
    if (unprompted.get(key)?.turn === turn) endUnprompted(key, 'cancelled');
    await bridge.cancel(key);
  }
}

export async function answerLocalAgentPermission(turnId: string, optionId: string | null): Promise<void> {
  const bridge = desktopBridge()?.localAgents;
  const turn = turns.get(turnId);
  const pending = turn?.state.permission;
  if (!bridge || !turn || !pending) return;
  for (const [key, t] of turnByKey) {
    if (t === turn) await bridge.answerPermission(key, pending.requestId, optionId);
  }
  turn.patch({ permission: null });
}

/**
 * Answers its question. `answers` is keyed by question id; null = skip (it goes on with its own judgment).
 * The row records the answer: for one question the answer itself, for several a "question answer" line each.
 */
export async function answerLocalAgentQuestion(turnId: string, answers: Record<string, LocalAgentAnswer> | null): Promise<void> {
  const bridge = desktopBridge()?.localAgents;
  const turn = turns.get(turnId);
  const pending = turn?.state.question;
  if (!bridge || !turn || !pending) return;
  for (const [key, t] of turnByKey) {
    if (t === turn) await bridge.answerQuestion?.(key, pending.requestId, answers);
  }
  const said = pending.questions
    .map((q) => {
      const a = answers?.[q.id];
      const text = a ? ('label' in a ? a.label : a.text.trim()) : '';
      return text ? (pending.questions.length > 1 ? `${q.question} ${text}` : text) : '';
    })
    .filter(Boolean)
    .join('\n');
  turn.answered(pending.callId, said || null);
}

/* ── The record ──
   These turns are not stored on the server, so their text and process are saved with the project
   (lib/chat-store.ts: the project's .film/chat) and put back in the conversation when the project
   reopens. Only finished turns are saved. */

type SavedLocalTurn = SavedTurn;

function readSaved(projectId: string): SavedLocalTurn[] {
  return chatTurns(projectId).filter((x): x is SavedLocalTurn => Boolean(x?.turn?.id && Array.isArray(x.items)));
}

export function saveLocalAgentTurn(projectId: string, turn: Turn, items: TranscriptItem[]): void {
  putChatTurn(projectId, { turn, items });
}

/** A running turn's rows as they are kept while it runs: as read back after the app closed on it, nothing still going. */
export function restingItems(items: TranscriptItem[]): TranscriptItem[] {
  return items.some((item) => item.pending) ? items.map((item) => (item.pending ? { ...item, pending: false } : item)) : items;
}

/** what a turn the app closed on (or crashed in) says, kept while it ran and read back with it not running */
export const INTERRUPTED = 'OpenFilm closed while the agent was working on this.';
const ACTIVE_STATUSES = new Set<Turn['status']>(['generating', 'failing', 'canceling']);

/**
 * The turns run with a local agent in this project (this session). One kept while it ran (the page saves a running
 * turn as it goes) and running no more, the app having closed on it, reads as interrupted: what it did so far stays,
 * and the next message goes on from there. One the agent started by itself and ended with nothing in it is left out.
 */
export function loadLocalAgentTurns(projectId: string, sessionId: string | null): SavedLocalTurn[] {
  if (typeof window === 'undefined') return [];
  return readSaved(projectId)
    .filter((x) => (!sessionId || x.turn.sessionId === sessionId) && !isEmptyBackgroundTurn(x.turn, x.items))
    .map((x) => (ACTIVE_STATUSES.has(x.turn.status) && !runningTurns.has(x.turn.id)
      ? { ...x, turn: { ...x.turn, status: 'error' as const, error: INTERRUPTED } }
      : x));
}

/**
 * The turns of this project that have a log and were never kept (the app closed or crashed before it kept them, or a
 * version from before running turns were kept): each made again from its log, as it went, and kept from now on. One
 * that ended says how; one that did not, interrupted. Not the turns running now (this page's, or the app's after a
 * reload). Resolves with how many it made.
 */
export async function recoverLoggedTurns(projectId: string): Promise<number> {
  const held = await desktopBridge()?.localAgents?.running?.().catch(() => []) ?? [];
  const except = [...turns.keys(), ...runningTurns.keys(), ...held.flatMap((r) => (r.meta?.turnId ? [r.meta.turnId] : []))];
  const found = await app.chat.unsaved?.(projectId, except).catch(() => []) ?? [];
  let made = 0;
  for (const { turnId, events } of found) {
    const prompt = events.find((e) => e.kind === 'prompt') as { meta?: LocalAgentTurnMeta; agent?: LocalAgentId } | undefined;
    const meta = prompt?.meta;
    if (!meta?.turn || !meta.sessionId) continue;
    const turn = new LocalAgentTurn(turnId, meta.agent ?? prompt?.agent ?? 'claude', meta.turnNo ?? 0);
    for (const event of events) if (event.kind === 'update' || event.kind === 'question' || event.kind === 'permission') dispatch(turn, event);
    turn.seal();
    const done = [...events].reverse().find((e) => e.kind === 'done') as { ok?: boolean; stopReason?: string; error?: string; t: number } | undefined;
    const patch: Partial<Turn> = !done ? { status: 'error', error: INTERRUPTED }
      : done.ok === false ? { status: 'error', error: String(done.error ?? INTERRUPTED) }
        : done.stopReason === 'cancelled' ? { status: 'cancelled' } : { status: 'ready' };
    const last = events.at(-1)?.t;
    putChatTurn(projectId, { turn: { ...(meta.turn as Turn), ...patch, ...(last ? { updatedAt: new Date(last).toISOString() } : {}) }, items: turn.items });
    made += 1;
  }
  return made;
}

/* ── Running local turns (across projects) ─────────────────────────────────────────
   A local Codex / Claude Code turn lives only in this window; the server has no record of it. The saved
   record holds only finished turns, so a running one is registered here and put back when the person
   returns to its project. */
export interface RunningLocalTurn {
  id: string;
  projectId: string;
  projectTitle: string;
  sessionId: string;
  agent: LocalAgentId;
  prompt: string;
  startedAt: number;
  /** The record as first sent (the chat panel puts the turn back from it) */
  turn: Turn;
}

const runningTurns = new Map<string, RunningLocalTurn>();
const runningListeners = new Set<() => void>();
let runningSnapshot: RunningLocalTurn[] = [];
function emitRunning(): void {
  runningSnapshot = [...runningTurns.values()];
  for (const fn of runningListeners) fn();
}

export function registerRunningLocalTurn(entry: RunningLocalTurn): void {
  runningTurns.set(entry.id, entry);
  emitRunning();
}

export function finishRunningLocalTurn(id: string): RunningLocalTurn | null {
  const entry = runningTurns.get(id) ?? null;
  if (entry) { runningTurns.delete(id); emitRunning(); }
  return entry;
}

export function runningLocalTurns(projectId?: string): RunningLocalTurn[] {
  return projectId ? runningSnapshot.filter((r) => r.projectId === projectId) : runningSnapshot;
}

export function useRunningLocalTurns(): RunningLocalTurn[] {
  return React.useSyncExternalStore(
    (fn) => { runningListeners.add(fn); return () => { runningListeners.delete(fn); }; },
    () => runningSnapshot,
    () => runningSnapshot,
  );
}

/* A turn ended: subscribers can notify the person */
export interface LocalTurnSettled {
  projectId: string; projectTitle: string; agent: LocalAgentId; prompt: string;
  outcome: 'done' | 'failed' | 'stopped';
  /** Confirmed by the end-of-turn project checkpoint, not inferred from tool calls. */
  changed: boolean;
}
const settledListeners = new Set<(e: LocalTurnSettled) => void>();
export function onLocalTurnSettled(fn: (e: LocalTurnSettled) => void): () => void {
  settledListeners.add(fn);
  return () => { settledListeners.delete(fn); };
}
export function emitLocalTurnSettled(e: LocalTurnSettled): void {
  // Ordinary replies and user-requested stops stay in the conversation.
  if (e.outcome === 'stopped' || (e.outcome === 'done' && !e.changed)) return;
  for (const fn of settledListeners) fn(e);
}
