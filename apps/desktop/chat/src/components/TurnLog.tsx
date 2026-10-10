/**
 * A turn's log, as the app wrote it while it ran (src/chat-store.mjs), shown in developer mode (Settings → Developer)
 * from a turn's footer.
 *
 * Model requests (the app's own agent, Pi): each request it made to its model, whole — the system prompt, every
 * message (the person's, its own with its thinking and tool calls, each tool's result), the tools — and the answer,
 * with the model, provider and thinking level that made it, its tokens, or its error. The messages new in that
 * request are open; the ones carried over from before, and the system prompt, are one line each until opened.
 * Events: every event the agent sent, each a line opening to the event exactly as it was.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronRight, ClipboardCopy, FolderOpen, RefreshCw, ScrollText, X } from 'lucide-react';
import { useT } from '@/i18n';
import { chatLayer } from '@/lib/chat-layer';
import { modelCalls, textOf, usageOf, type ModelCall, type RawCall } from '@/lib/model-calls';
import { app, type TurnLog as TurnLogData } from '../app-bridge';
import { AgentIcon, hasAgentIcon } from './AgentIcons';
import { BrandLogo } from './BrandLogo';

type LogEvent = TurnLogData['events'][number];
type T = (key: string) => string;

export function TurnLogButton({ project, turnId }: { project: string; turnId: string }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={t('turnLog.title')}
        className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 transition hover:bg-[var(--bg-hover)] hover:text-[var(--chat-text)]">
        <ScrollText size={12} aria-hidden />
        {t('turnLog.open')}
      </button>
      {open ? <TurnLogViewer project={project} turnId={turnId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const seconds = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}`);
const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''));
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

function TurnLogViewer({ project, turnId, onClose }: { project: string; turnId: string; onClose: () => void }) {
  const t = useT();
  const [log, setLog] = React.useState<TurnLogData | null | undefined>(undefined);
  const [tab, setTab] = React.useState<'calls' | 'events' | null>(null);
  const [copied, setCopied] = React.useState(false);
  const load = React.useCallback(() => { void app.chat.log(project, turnId).then(setLog).catch(() => setLog(null)); }, [project, turnId]);
  React.useEffect(load, [load]);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const events = log?.events ?? [];
  const calls = React.useMemo(() => modelCalls((log?.calls ?? []) as RawCall[]), [log]);
  const shownTab = tab ?? (calls.length ? 'calls' : 'events');
  const prompt = events.find((e) => e.kind === 'prompt') as Record<string, any> | undefined;
  const done = [...events].reverse().find((e) => e.kind === 'done') as Record<string, any> | undefined;
  const agent = typeof prompt?.agent === 'string' ? prompt.agent : null;
  const model = prompt?.meta?.turn?.localAgent?.model ?? null;
  const took = prompt && done ? seconds(done.t - prompt.t) : null;
  const totals = calls.reduce((sum, call) => {
    const u = usageOf(call);
    return { input: sum.input + u.input, cached: sum.cached + u.cached, output: sum.output + u.output };
  }, { input: 0, cached: 0, output: 0 });

  const copy = () => {
    void navigator.clipboard?.writeText(JSON.stringify(shownTab === 'calls' ? calls : events, null, 2)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  const button = 'flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--border)] px-2.5 text-[12.5px] text-[var(--chat-text)] transition hover:bg-[var(--bg-hover)]';
  const tabButton = (id: 'calls' | 'events', label: string) => (
    <button type="button" onClick={() => setTab(id)}
      className={`h-9 border-b-2 px-1 text-[13px] transition ${shownTab === id ? 'border-[var(--chat-text)] text-[var(--chat-text)]' : 'border-transparent text-[var(--chat-hint)] hover:text-[var(--chat-text)]'}`}>
      {label}
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[10045] grid place-items-center bg-black/40 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('turnLog.title')}
        className="flex h-[min(940px,94vh)] w-[min(1320px,96vw)] flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--dock-pane)] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5)]">
        <div className="flex shrink-0 items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-[var(--chat-text)]">
              {t('turnLog.title')}
              {done ? (
                <span className={`rounded-[6px] px-1.5 py-0.5 text-[11.5px] font-medium ${done.ok ? 'bg-[var(--bg-hover)] text-[var(--chat-hint)]' : 'bg-[var(--err)]/15 text-[var(--err)]'}`}>
                  {done.ok ? String(done.stopReason ?? t('turnLog.ended')) : t('turnLog.failed')}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-[var(--chat-hint)]">
              {agent ? (
                <span className="flex w-3.5 shrink-0 justify-center opacity-80">
                  {hasAgentIcon(agent) ? <AgentIcon id={agent} size={12} /> : <BrandLogo size={11} />}
                </span>
              ) : null}
              <span className="truncate">
                {[model, prompt ? new Date(prompt.t).toLocaleString() : null, took,
                  calls.length ? fill(t('turnLog.callCount'), { n: calls.length }) : null,
                  calls.length ? fill(t('turnLog.tokens'), { input: k(totals.input), cached: k(totals.cached), output: k(totals.output) }) : null].filter(Boolean).join(' · ')}
              </span>
            </div>
            {done && !done.ok ? <div className="mt-1.5 whitespace-pre-wrap break-words text-[12.5px] text-[var(--err)]">{String(done.error ?? '')}</div> : null}
            {log?.file ? <div className="mt-1 truncate font-mono text-[11px] text-[var(--text-faint)]" title={log.file}>{log.file}</div> : null}
          </div>
          <button type="button" className={button} onClick={load}><RefreshCw size={13} />{t('turnLog.refresh')}</button>
          <button type="button" className={button} onClick={copy} disabled={!events.length}><ClipboardCopy size={13} />{copied ? t('turnLog.copied') : t('turnLog.copy')}</button>
          <button type="button" className={button} onClick={() => void app.chat.reveal(project, turnId)}><FolderOpen size={13} />{t('turnLog.reveal')}</button>
          <button type="button" aria-label={t('turnLog.close')} onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--chat-hint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--chat-text)]"><X size={16} /></button>
        </div>
        {log === undefined ? <p className="px-5 py-4 text-[13px] text-[var(--chat-hint)]">{t('turnLog.loading')}</p>
          : log === null ? <p className="px-5 py-4 text-[13px] text-[var(--chat-hint)]">{t('turnLog.none')}</p> : (
            <>
              <div className="flex shrink-0 items-center gap-4 border-b border-[var(--border)] px-5">
                {tabButton('calls', fill(t('turnLog.calls'), { n: calls.length }))}
                {tabButton('events', fill(t('turnLog.events'), { n: events.length }))}
                {log.cut ? <span className="text-[12px] text-[var(--warn)]">{t('turnLog.cut')}</span> : null}
              </div>
              {shownTab === 'calls'
                ? (calls.length ? <Calls calls={calls} start={prompt?.t ?? calls[0]!.startedAt} t={t} /> : <p className="px-5 py-4 text-[13px] text-[var(--chat-hint)]">{t('turnLog.noCalls')}</p>)
                : <Events events={events} t={t} />}
            </>
          )}
      </div>
    </div>,
    chatLayer(),
  );
}

/* ── model requests ────────────────────────────────────────────────────────── */

type Item = Record<string, any>;

const ROLE_COLOR: Record<string, string> = {
  system: 'text-[#b07a1f]',
  user: 'text-[#3f8fd0]',
  assistant: 'text-[#4aa36c]',
  toolResult: 'text-[#a26bd6]',
};

const block = 'whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.55] text-[var(--chat-text)]';
const pretty = (raw: unknown) => {
  if (typeof raw !== 'string') return JSON.stringify(raw, null, 2);
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
};

/** Long text: its first part, and the rest on asking. */
function Clamped({ text, max = 6000, t }: { text: string; max?: number; t: T }) {
  const [all, setAll] = React.useState(false);
  if (all || text.length <= max) return <div className={block}>{text}</div>;
  return (
    <div className={block}>
      {text.slice(0, max)}…
      <button type="button" onClick={() => setAll(true)} className="ml-1 font-sans text-[12px] text-[var(--chat-hint)] underline">{fill(t('turnLog.showAll'), { n: text.length.toLocaleString() })}</button>
    </div>
  );
}

/** A message's parts, each as its kind says: text, thinking, a tool call, a picture. */
function Parts({ message, t }: { message: Item; t: T }) {
  if (message.role === 'system') return <Clamped text={textOf(message)} t={t} />;
  if (typeof message.content === 'string') return <Clamped text={message.content} t={t} />;
  return (
    <div className="space-y-2">
      {(message.content ?? []).map((part: Item, i: number) => {
        if (part.type === 'text') return <Clamped key={i} text={String(part.text ?? '')} t={t} />;
        if (part.type === 'thinking') {
          return (
            <details key={i}>
              <summary className="cursor-pointer text-[12px] text-[var(--chat-hint)]">{t('turnLog.thought')} · {fill(t('turnLog.chars'), { n: String(part.thinking ?? '').length.toLocaleString() })}</summary>
              <div className="mt-1 italic"><Clamped text={String(part.thinking ?? '')} t={t} /></div>
            </details>
          );
        }
        if (part.type === 'toolCall') {
          return (
            <div key={i} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2">
              <div className="mb-1 flex gap-2 font-mono text-[12px]"><b className="text-[var(--chat-text)]">{String(part.name ?? '')}</b><span className="text-[var(--text-faint)]">{String(part.id ?? '')}</span></div>
              <Clamped text={pretty(part.arguments ?? {})} t={t} />
            </div>
          );
        }
        if (part.type === 'image') return <img key={i} src={`data:${part.mimeType ?? 'image/png'};base64,${part.data}`} alt="" className="max-h-[220px] max-w-[360px] rounded-[6px] border border-[var(--border)] object-contain" />;
        return <Clamped key={i} text={pretty(part)} t={t} />;
      })}
    </div>
  );
}

function MessageRow({ message, index, fresh, open: initial, t }: { message: Item; index: number | string; fresh?: boolean; open: boolean; t: T }) {
  const [open, setOpen] = React.useState(initial);
  const role = String(message.role ?? '?');
  const text = textOf(message);
  const failed = message.role === 'toolResult' && message.isError;
  return (
    <div className={`rounded-[8px] border ${fresh ? 'border-[var(--text-faint)]' : 'border-[var(--border)]'}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]">
        <ChevronRight size={12} className={`shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="w-6 shrink-0 tabular-nums text-[var(--text-faint)]">{index}</span>
        <b className={`shrink-0 font-semibold ${failed ? 'text-[var(--err)]' : ROLE_COLOR[role] ?? 'text-[var(--chat-hint)]'}`}>{role === 'toolResult' ? String(message.toolName ?? 'tool') : role}</b>
        {fresh ? <span className="shrink-0 rounded-[4px] bg-[var(--bg-hover)] px-1 text-[10.5px] text-[var(--chat-text)]">{t('turnLog.fresh')}</span> : null}
        {message.toolCallId ? <span className="shrink-0 font-mono text-[11px] text-[var(--text-faint)]">{String(message.toolCallId)}</span> : null}
        <span className={`min-w-0 flex-1 truncate ${open ? 'invisible' : 'text-[var(--chat-hint)]'}`}>{text.replace(/\s+/g, ' ').slice(0, 200)}</span>
        <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-faint)]">{fill(t('turnLog.chars'), { n: text.length.toLocaleString() })}</span>
      </button>
      {open ? <div className="border-t border-[var(--border)] px-3 py-2"><Parts message={message} t={t} /></div> : null}
    </div>
  );
}

function Calls({ calls, start, t }: { calls: ModelCall[]; start: number; t: T }) {
  const [picked, setPicked] = React.useState(calls.length);
  const [raw, setRaw] = React.useState(false);
  const [version, setVersion] = React.useState({ all: null as boolean | null, n: 0 });
  const call = calls[Math.min(picked, calls.length) - 1]!;
  const u = usageOf(call);
  const answer = call.answer;
  const failed = answer?.stopReason === 'error';
  const tools = call.tools ?? [];
  const heading = 'mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[var(--chat-text)]';
  const small = 'h-7 rounded-[7px] px-2.5 text-[12px] text-[var(--chat-hint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--chat-text)]';
  const facts = [answer?.responseModel ?? answer?.model, answer?.provider, answer?.providerThinkingLevel ?? answer?.thinkingLevel, answer?.stopReason].filter(Boolean).map(String);
  return (
    <div className="flex min-h-0 flex-1">
      {/* every request, in order */}
      <div className="w-[250px] shrink-0 overflow-y-auto border-r border-[var(--border)] py-1">
        {calls.map((c) => {
          const cu = usageOf(c);
          const asked = (c.answer?.content ?? []).filter((p: Item) => p.type === 'toolCall').map((p: Item) => p.name);
          const error = c.answer?.stopReason === 'error';
          return (
            <button key={c.no} type="button" onClick={() => setPicked(c.no)}
              className={`block w-full px-4 py-2 text-left text-[12px] ${c.no === call.no ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}>
              <div className="flex items-baseline gap-2">
                <b className={`text-[12.5px] ${error ? 'text-[var(--err)]' : 'text-[var(--chat-text)]'}`}>#{c.no}</b>
                <span className="tabular-nums text-[var(--text-faint)]">+{seconds(c.startedAt - start)} · {seconds(c.ms)}</span>
              </div>
              <div className="mt-0.5 truncate text-[var(--chat-hint)]">
                {error ? <span className="text-[var(--err)]">{String(c.answer?.errorMessage ?? '')}</span>
                  : asked.length ? `→ ${asked.join(', ')}` : t('turnLog.answered')}
              </div>
              <div className="mt-0.5 tabular-nums text-[11px] text-[var(--text-faint)]">{fill(t('turnLog.tokens'), { input: k(cu.input), cached: k(cu.cached), output: k(cu.output) })}</div>
            </button>
          );
        })}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--chat-hint)]">
          <b className="text-[13px] text-[var(--chat-text)]">#{call.no}</b>
          {facts.map((f, i) => <span key={i}>{f}</span>)}
          <span className="tabular-nums">{fill(t('turnLog.tokens'), { input: u.input.toLocaleString(), cached: u.cached.toLocaleString(), output: u.output.toLocaleString() })}{u.reasoning ? ` (${fill(t('turnLog.reasoningTokens'), { n: u.reasoning.toLocaleString() })})` : ''}</span>
          <span className="tabular-nums">{seconds(call.ms)}</span>
          <span className="flex-1" />
          <button type="button" className={small} onClick={() => setRaw((r) => !r)}>{raw ? t('turnLog.readable') : 'JSON'}</button>
        </div>
        {raw ? (
          <pre className={`${block} rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3`}>
            {JSON.stringify({ request: { systemPrompt: call.systemPrompt, messages: call.messages, tools: call.tools }, answer: call.answer }, null, 2)}
          </pre>
        ) : (
          <div className="space-y-5">
            {/* what came back */}
            <section>
              <div className={heading}>{t('turnLog.reply')}</div>
              {failed ? (
                <div className="flex gap-2 rounded-[8px] border border-[var(--err)]/40 bg-[var(--err)]/10 px-3 py-2 text-[12.5px] text-[var(--err)]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 whitespace-pre-wrap break-words">{String(answer?.errorMessage ?? '')}</span>
                </div>
              ) : answer ? (
                <div className="rounded-[8px] border border-[var(--border)] px-3 py-2"><Parts message={answer} t={t} /></div>
              ) : <p className="text-[12.5px] text-[var(--chat-hint)]">—</p>}
            </section>
            {/* everything the model got */}
            <section>
              <div className={heading}>
                {fill(t('turnLog.sent'), { n: call.messages.length, fresh: call.messages.length - call.fresh })}
                <span className="flex-1" />
                <button type="button" className={small} onClick={() => setVersion((v) => ({ all: true, n: v.n + 1 }))}>{t('turnLog.expandAll')}</button>
                <button type="button" className={small} onClick={() => setVersion((v) => ({ all: false, n: v.n + 1 }))}>{t('turnLog.collapseAll')}</button>
              </div>
              <div className="space-y-1.5">
                {call.messages.map((message, i) => (
                  <MessageRow key={`${call.no}-${version.n}-${i}`} message={message} index={i + 1} fresh={i >= call.fresh}
                    open={version.all ?? (i >= call.fresh && message.role !== 'system')} t={t} />
                ))}
              </div>
            </section>
            <section>
              <details>
                <summary className="cursor-pointer text-[12.5px] font-semibold text-[var(--chat-text)]">{fill(t('turnLog.rest'), { n: tools.length })}</summary>
                <div className="mt-2 space-y-2">
                  <div className="text-[12px] text-[var(--chat-hint)]">{tools.map((tool) => tool.name).join(', ')}</div>
                  <pre className={`${block} max-h-[480px] overflow-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3`}>{JSON.stringify(call.tools, null, 2)}</pre>
                </div>
              </details>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── events ────────────────────────────────────────────────────────────────── */

/** a line of the log as shown: one event, or a run of text pieces joined */
interface Row { at: number; kind: string; label: string; summary: string; events: LogEvent[]; tone?: 'error' | 'quiet' }

const str = (value: unknown, max = 400) => (typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)).replace(/\s+/g, ' ').slice(0, max);

/** what an agent's update is, in short (ACP session/update); `titles`: each tool call's title, for its updates */
function updateRow(event: LogEvent, titles: Map<string, string>): Omit<Row, 'at' | 'events'> {
  const update = (event.update ?? {}) as Record<string, any>;
  const type = String(update.sessionUpdate ?? 'update');
  switch (type) {
    case 'agent_message_chunk': return { kind: 'message', label: 'message', summary: String(update.content?.text ?? '') };
    case 'agent_thought_chunk': return { kind: 'thought', label: 'thought', summary: String(update.content?.text ?? ''), tone: 'quiet' };
    case 'user_message_chunk': return { kind: 'user', label: 'user', summary: String(update.content?.text ?? '') };
    case 'tool_call':
      if (update.toolCallId && update.title) titles.set(String(update.toolCallId), String(update.title));
      return { kind: 'tool', label: `tool · ${update.kind ?? 'other'}`, summary: `${update.title ?? update.toolCallId ?? ''}${update.status ? `  [${update.status}]` : ''}${update.rawInput ? `  ${str(update.rawInput, 300)}` : ''}` };
    case 'tool_call_update': {
      const out = update.rawOutput ?? (Array.isArray(update.content) ? update.content.map((c: any) => c?.content?.text ?? c?.text ?? '').join(' ') : '');
      return { kind: 'tool', label: 'tool · update', summary: `${update.title ?? titles.get(String(update.toolCallId)) ?? update.toolCallId ?? ''}${update.status ? `  [${update.status}]` : ''}${out ? `  → ${str(out, 300)}` : ''}`, tone: update.status === 'failed' ? 'error' : undefined };
    }
    case 'plan': return { kind: 'plan', label: 'plan', summary: (update.entries ?? []).map((e: any) => `${e.status === 'completed' ? '✓' : e.status === 'in_progress' ? '›' : '·'} ${e.content}`).join('   ') };
    default: return { kind: 'update', label: type, summary: str(update, 300), tone: 'quiet' };
  }
}

function rowOf(event: LogEvent, titles: Map<string, string>): Omit<Row, 'at' | 'events'> {
  switch (event.kind) {
    case 'prompt': {
      const meta = (event.meta ?? {}) as Record<string, any>;
      return { kind: 'prompt', label: 'prompt', summary: `${event.agent ?? ''}${meta.model ? ` · ${meta.model}` : ''}  ${str(event.text, 600)}` };
    }
    case 'update': return updateRow(event, titles);
    case 'permission': return { kind: 'ask', label: 'permission', summary: str((event.params as any)?.toolCall?.title ?? event.params, 300) };
    case 'permission-answer': return { kind: 'ask', label: 'permission · answer', summary: str(event.optionId ?? 'cancelled') };
    case 'question': return { kind: 'ask', label: 'question', summary: str(event.message ?? event.questions, 300) };
    case 'question-answer': return { kind: 'ask', label: 'question · answer', summary: str(event.answers ?? 'skipped', 300) };
    case 'cancel': return { kind: 'end', label: 'cancel', summary: '' };
    case 'set-option': return { kind: 'update', label: 'set option', summary: `${str(event.configId)} = ${str(event.value)}`, tone: 'quiet' };
    case 'exit': return { kind: 'end', label: 'exit', summary: `code ${str(event.code)}${event.stderr ? `  ${str(event.stderr, 300)}` : ''}`, tone: event.code ? 'error' : undefined };
    case 'done': return { kind: 'end', label: 'done', summary: event.ok ? str(event.stopReason) : str(event.error, 500), tone: event.ok ? undefined : 'error' };
    default: return { kind: 'update', label: event.kind, summary: str(event, 300), tone: 'quiet' };
  }
}

/** The log as lines: each event its own, or (joined) a run of the agent's words or thoughts as one. */
function rowsOf(events: LogEvent[], joined: boolean): Row[] {
  const rows: Row[] = [];
  const titles = new Map<string, string>();
  for (const event of events) {
    const row = { ...rowOf(event, titles), at: event.t, events: [event] };
    const last = rows[rows.length - 1];
    if (joined && last && (row.kind === 'message' || row.kind === 'thought') && last.kind === row.kind) {
      last.summary += row.summary;
      last.events.push(event);
    } else rows.push(row);
  }
  return rows;
}

const KIND_COLOR: Record<string, string> = {
  prompt: 'text-[var(--chat-text)]',
  message: 'text-[var(--chat-text)]',
  thought: 'text-[var(--chat-hint)]',
  tool: 'text-[#3f8fd0]',
  ask: 'text-[#b07a1f]',
  end: 'text-[var(--chat-text)]',
};

function Events({ events, t }: { events: LogEvent[]; t: T }) {
  const [joined, setJoined] = React.useState(true);
  const [filter, setFilter] = React.useState('');
  const [openRows, setOpenRows] = React.useState<Set<number>>(() => new Set());
  const start = events[0]?.t ?? 0;
  const rows = React.useMemo(() => rowsOf(events, joined), [events, joined]);
  const needle = filter.trim().toLowerCase();
  const shown = needle ? rows.filter((row) => `${row.label} ${row.summary}`.toLowerCase().includes(needle)) : rows;
  const toggle = (index: number) => setOpenRows((set) => { const next = new Set(set); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-5 py-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('turnLog.filter')}
          className="h-7 w-64 rounded-[7px] border border-[var(--border)] bg-transparent px-2.5 text-[12.5px] text-[var(--chat-text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--text-muted)]" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--chat-hint)]">
          <input type="checkbox" checked={joined} onChange={(e) => setJoined(e.target.checked)} />
          {t('turnLog.joined')}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 font-mono text-[12px] leading-[1.55]">
        {shown.length === 0 ? <p className="px-3 py-2 font-sans text-[13px] text-[var(--chat-hint)]">{t('turnLog.noMatch')}</p> : shown.map((row, index) => {
          const open = openRows.has(index);
          return (
            <div key={`${row.at}-${index}`} className="rounded-[6px] hover:bg-[var(--bg-hover)]">
              <button type="button" onClick={() => toggle(index)} className="flex w-full items-start gap-3 px-3 py-1 text-left">
                <ChevronRight size={12} className={`mt-[3px] shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className="w-[68px] shrink-0 text-right tabular-nums text-[var(--text-faint)]">+{((row.at - start) / 1000).toFixed(2)}s</span>
                <span className={`w-[150px] shrink-0 truncate ${KIND_COLOR[row.kind] ?? 'text-[var(--chat-hint)]'}`}>{row.label}{row.events.length > 1 ? ` ×${row.events.length}` : ''}</span>
                <span className={`min-w-0 flex-1 ${open ? 'whitespace-pre-wrap break-words' : 'truncate'} ${row.tone === 'error' ? 'text-[var(--err)]' : row.tone === 'quiet' ? 'text-[var(--chat-hint)]' : 'text-[var(--chat-text)]'}`}>{row.summary}</span>
              </button>
              {open ? (
                <pre className="mx-3 mb-2 ml-[100px] max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11.5px] text-[var(--chat-text)]">
                  {JSON.stringify(row.events.length === 1 ? row.events[0] : row.events, null, 2)}
                </pre>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
