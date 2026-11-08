/**
 * A turn's log, as the app wrote it while it ran (src/chat-store.mjs), shown in developer mode (Settings → Developer)
 * from a turn's footer.
 *
 * Model requests: each request the agent made to its model, whole — the system prompt, every message (the person's,
 * its own with its thinking and tool calls, each tool's result, and what the agent put in by itself), the tools — and
 * the answer, with the model, provider and thinking level that made it, its tokens, or its error. The app's own agent
 * (Pi) logs its own; the others' come from their own records, or from the logs they are started with in Developer
 * mode, and what such a log lacks is said beside it. The messages new in that request are open;
 * the ones carried over from before, and the system prompt, are one line each until opened.
 * Sent to the agent: what the app started and opened the agent with (every word it adds to the agent's own, the
 * variables it set), and each message exactly as the agent got it.
 * Events: every event the agent sent, each a line opening to the event exactly as it was; only the lines in view are
 * drawn, however long the log. A picture is shown as its type, size and file (the log keeps it as a file).
 *
 * Opened while the turn runs, it asks every moment for what was written since, until the turn ends, so it shows the
 * turn so far; a very long log is shown as its first event and its last EVENTS_KEPT.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronRight, ClipboardCopy, FolderOpen, KeyRound, RefreshCw, ScrollText, X } from 'lucide-react';
import { useT } from '@/i18n';
import { chatLayer } from '@/lib/chat-layer';
import { modelCalls, textOf, usageOf, type ModelCall, type RawCall } from '@/lib/model-calls';
import { app, type TurnLog as TurnLogData, type TurnLogAt } from '../app-bridge';
import { AgentIcon, hasAgentIcon } from './AgentIcons';
import { BrandLogo } from './BrandLogo';

type LogEvent = TurnLogData['events'][number];
type T = (key: string) => string;
type Tab = 'calls' | 'sent' | 'events';

export function TurnLogButton({ project, turnId, live = false }: { project: string; turnId: string; live?: boolean }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={t('turnLog.title')}
        className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
        <ScrollText size={12} aria-hidden />
        {t('turnLog.open')}
      </button>
      {open ? <TurnLogViewer project={project} turnId={turnId} live={live} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** the agents started with a logging switch in Developer mode (src/agent-logs.mjs) */
const LOGGED_AGENTS = ['qwen', 'codebuddy', 'opencode'];

/** Why a turn has no model requests, as its agent and what it was started with say. */
function noCallsReason(agent: string | null, log: Item | null | undefined): string {
  if (agent === 'cursor') return 'turnLog.noCallsCursor';
  if (agent && LOGGED_AGENTS.includes(agent)) return log?.none === 'own' ? 'turnLog.logOwn' : log?.none === 'sendsMore' ? 'turnLog.logSendsMore' : log ? 'turnLog.noCalls' : 'turnLog.logOff';
  return 'turnLog.noCalls';
}

const seconds = (ms: number | null) => (ms === null ? '—' : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}`);
const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''));
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

/** how often a running turn's log is asked for what is new */
const LIVE_READ_MS = 1500;
/** the most events held at once: past it the oldest go (the prompt stays), as a long turn's end explains how it ended */
const EVENTS_KEPT = 100_000;

/** A log as shown: what was read so far, and where the reading stopped. */
interface Shown { file: string; cut: boolean; callsCut: boolean; events: LogEvent[]; calls: RawCall[]; at: TurnLogAt }

/** What was shown, with a read's new events and requests after it (or in its place, when the read was whole). */
function merged(prev: Shown | null, next: TurnLogData): Shown {
  const after = !next.whole && prev;
  let events = after ? (next.events.length ? [...prev.events, ...next.events] : prev.events) : next.events;
  let cut = after ? prev.cut || next.cut : next.cut;
  if (events.length > EVENTS_KEPT) {
    const head = events[0]?.kind === 'prompt' ? [events[0]] : [];
    events = [...head, ...events.slice(events.length - EVENTS_KEPT + head.length)];
    cut = true;
  }
  const callsAfter = !next.callsWhole && prev;
  const calls = callsAfter ? (next.calls.length ? [...prev.calls, ...(next.calls as RawCall[])] : prev.calls) : next.calls as RawCall[];
  return { file: next.file, cut, callsCut: next.callsCut || Boolean(callsAfter && prev.callsCut), events, calls, at: next.at };
}

function TurnLogViewer({ project, turnId, live, onClose }: { project: string; turnId: string; live: boolean; onClose: () => void }) {
  const t = useT();
  const [log, setLog] = React.useState<Shown | null | undefined>(undefined);
  const [tab, setTab] = React.useState<Tab | null>(null);
  const [copied, setCopied] = React.useState(false);
  /* what is shown, for a read to add to; `reads`: a read whole again makes any read asked before it stale */
  const shown = React.useRef<Shown | null>(null);
  const reads = React.useRef(0);
  const load = React.useCallback(() => {
    const read = ++reads.current;
    void app.chat.log(project, turnId).then((next) => {
      if (read !== reads.current) return;
      shown.current = next && !('same' in next) ? merged(null, next) : null;
      setLog(shown.current);
    }).catch(() => setLog(null));
  }, [project, turnId]);
  /* read on opening and once more as the turn ends (its last events); while it runs, what is new, one read at a time */
  React.useEffect(load, [load, live]);
  React.useEffect(() => {
    if (!live) return undefined;
    let reading = false;
    const timer = window.setInterval(() => {
      if (reading) return;
      reading = true;
      const read = reads.current;
      void app.chat.log(project, turnId, shown.current?.at)
        .then((next) => {
          if (!next || 'same' in next || read !== reads.current) return;
          shown.current = merged(shown.current, next);
          setLog(shown.current);
        }).catch(() => {}).finally(() => { reading = false; });
    }, LIVE_READ_MS);
    return () => window.clearInterval(timer);
  }, [live, project, turnId]);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const events = React.useMemo(() => log?.events ?? [], [log?.events]);
  const calls = React.useMemo(() => modelCalls(log?.calls ?? []), [log?.calls]);
  const sent = React.useMemo(() => events.filter((e) => e.kind === 'prompt' || e.kind === 'sent' || e.kind === 'steer'), [events]);
  const shownTab = tab ?? (calls.length ? 'calls' : 'sent');
  const prompt = events.find((e) => e.kind === 'prompt') as Record<string, any> | undefined;
  const done = React.useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) if (events[i]!.kind === 'done') return events[i] as Record<string, any>;
    return undefined;
  }, [events]);
  const updatesCut = React.useMemo(() => events.some((e) => e.kind === 'cut'), [events]);
  const agent = typeof prompt?.agent === 'string' ? prompt.agent : null;
  const model = prompt?.meta?.turn?.localAgent?.model ?? null;
  const took = prompt && done ? seconds(done.t - prompt.t) : null;
  const totals = calls.reduce((sum, call) => {
    const u = usageOf(call);
    return { input: sum.input + u.input, cached: sum.cached + u.cached, output: sum.output + u.output };
  }, { input: 0, cached: 0, output: 0 });

  const copy = () => {
    void navigator.clipboard?.writeText(JSON.stringify(shownTab === 'calls' ? calls : shownTab === 'sent' ? sent : events, null, 2)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  const button = 'flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--border)] px-2.5 text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]';
  const tabButton = (id: Tab, label: string) => (
    <button type="button" onClick={() => setTab(id)}
      className={`h-9 border-b-2 px-1 text-[13px] transition ${shownTab === id ? 'border-[var(--text)] text-[var(--text)]' : 'border-transparent text-[var(--text-faint)] hover:text-[var(--text)]'}`}>
      {label}
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[10045] grid place-items-center bg-black/40 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('turnLog.title')}
        className="flex h-[min(940px,94vh)] w-[min(1320px,96vw)] flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg-raised)] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5)]">
        <div className="flex shrink-0 items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text)]">
              {t('turnLog.title')}
              {done ? (
                <span className={`rounded-[6px] px-1.5 py-0.5 text-[11.5px] font-medium ${done.ok ? 'bg-[var(--bg-hover)] text-[var(--text-faint)]' : 'bg-[var(--err)]/15 text-[var(--err)]'}`}>
                  {done.ok ? String(done.stopReason ?? t('turnLog.ended')) : t('turnLog.failed')}
                </span>
              ) : live ? (
                <span className="rounded-[6px] bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11.5px] font-medium"><span className="text-sweep">{t('turnLog.running')}</span></span>
              ) : null}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-[var(--text-faint)]">
              {agent ? (
                <span className="flex w-3.5 shrink-0 justify-center opacity-80">
                  {agent === 'byok' ? <KeyRound size={12} /> : hasAgentIcon(agent) ? <AgentIcon id={agent} size={12} /> : <BrandLogo size={11} />}
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
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><X size={16} /></button>
        </div>
        {log === undefined || (log === null && live) ? <p className="px-5 py-4 text-[13px] text-[var(--text-faint)]">{t('turnLog.loading')}</p>
          : log === null ? <p className="px-5 py-4 text-[13px] text-[var(--text-faint)]">{t('turnLog.none')}</p> : (
            <>
              <div className="flex shrink-0 items-center gap-4 border-b border-[var(--border)] px-5">
                {tabButton('calls', fill(t('turnLog.calls'), { n: calls.length }))}
                {tabButton('sent', t('turnLog.sentTab'))}
                {tabButton('events', fill(t('turnLog.events'), { n: events.length }))}
                {[log.cut ? 'turnLog.cut' : null, updatesCut ? 'turnLog.updatesCut' : null, log.callsCut ? 'turnLog.callsCut' : null].filter(Boolean).map((key) => (
                  <span key={key} className="text-[12px] text-[var(--warn)]">{t(key!)}</span>
                ))}
              </div>
              {shownTab === 'calls'
                ? (calls.length ? <Calls calls={calls} start={prompt?.t ?? calls[0]!.startedAt} t={t} /> : <p className="px-5 py-4 text-[13px] text-[var(--text-faint)]">{t(noCallsReason(agent, prompt?.opened?.log))}</p>)
                : shownTab === 'sent' ? <Sent events={sent} t={t} /> : <Events events={events} t={t} />}
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
  context: 'text-[#c0603a]',
};

const block = 'whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.55] text-[var(--text)]';
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
      <button type="button" onClick={() => setAll(true)} className="ml-1 font-sans text-[12px] text-[var(--text-faint)] underline">{fill(t('turnLog.showAll'), { n: text.length.toLocaleString() })}</button>
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
              <summary className="cursor-pointer text-[12px] text-[var(--text-faint)]">{t('turnLog.thought')} · {part.thinking ? fill(t('turnLog.chars'), { n: String(part.thinking).length.toLocaleString() }) : t('turnLog.thoughtNotKept')}</summary>
              <div className="mt-1 italic"><Clamped text={String(part.thinking ?? '')} t={t} /></div>
            </details>
          );
        }
        if (part.type === 'toolCall') {
          return (
            <div key={i} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-field)] px-2.5 py-2">
              <div className="mb-1 flex gap-2 font-mono text-[12px]"><b className="text-[var(--text)]">{String(part.name ?? '')}</b><span className="text-[var(--text-faint)]">{String(part.id ?? '')}</span></div>
              <Clamped text={pretty(part.arguments ?? {})} t={t} />
            </div>
          );
        }
        if (part.type === 'image') {
          return part.data ? <img key={i} src={`data:${part.mimeType ?? 'image/png'};base64,${part.data}`} alt="" className="max-h-[220px] max-w-[360px] rounded-[6px] border border-[var(--border)] object-contain" />
            : <div key={i} className="font-mono text-[12px] text-[var(--text-faint)]">{fill(t('turnLog.picture'), { type: String(part.mimeType ?? ''), size: k(Number(part.bytes) || 0) })}{part.file ? ` · ${String(part.file)}` : ''}</div>;
        }
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
        <b className={`shrink-0 font-semibold ${failed ? 'text-[var(--err)]' : ROLE_COLOR[role] ?? 'text-[var(--text-faint)]'}`}>{role === 'toolResult' ? String(message.toolName ?? 'tool') : role}</b>
        {role === 'context' || message.label ? <span className="shrink-0 font-mono text-[11px] text-[var(--text-faint)]" title={t('turnLog.contextHint')}>{[message.label, message.as ? `as ${message.as}` : null].filter(Boolean).join(' · ')}</span> : null}
        {message.meta ? <span className="shrink-0 font-mono text-[11px] text-[var(--text-faint)]">meta</span> : null}
        {fresh ? <span className="shrink-0 rounded-[4px] bg-[var(--bg-hover)] px-1 text-[10.5px] text-[var(--text)]">{t('turnLog.fresh')}</span> : null}
        {message.toolCallId ? <span className="shrink-0 font-mono text-[11px] text-[var(--text-faint)]">{String(message.toolCallId)}</span> : null}
        <span className={`min-w-0 flex-1 truncate ${open ? 'invisible' : 'text-[var(--text-faint)]'}`}>{text.replace(/\s+/g, ' ').slice(0, 200)}</span>
        <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-faint)]">{fill(t('turnLog.chars'), { n: text.length.toLocaleString() })}</span>
      </button>
      {open ? <div className="border-t border-[var(--border)] px-3 py-2"><Parts message={message} t={t} /></div> : null}
    </div>
  );
}

function Calls({ calls, start, t }: { calls: ModelCall[]; start: number; t: T }) {
  /* the latest until one is picked: while the turn runs, the newest request as it comes */
  const [picked, setPicked] = React.useState<number | null>(null);
  const [raw, setRaw] = React.useState(false);
  const [version, setVersion] = React.useState({ all: null as boolean | null, n: 0 });
  const call = calls[Math.min(picked ?? calls.length, calls.length) - 1]!;
  const u = usageOf(call);
  const answer = call.answer;
  const failed = answer?.stopReason === 'error';
  const tools = call.tools ?? [];
  const heading = 'mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[var(--text)]';
  const small = 'h-7 rounded-[7px] px-2.5 text-[12px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';
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
            <button key={c.no} type="button" onClick={() => setPicked(c.no === calls.length ? null : c.no)}
              className={`block w-full px-4 py-2 text-left text-[12px] ${c.no === call.no ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}>
              <div className="flex items-baseline gap-2">
                <b className={`text-[12.5px] ${error ? 'text-[var(--err)]' : 'text-[var(--text)]'}`}>#{c.no}</b>
                <span className="tabular-nums text-[var(--text-faint)]">+{seconds(c.startedAt - start)} · {seconds(c.ms)}</span>
              </div>
              {c.thread ? <div className="mt-0.5 truncate text-[11px] text-[#c0603a]">{c.thread.label}</div> : null}
              <div className="mt-0.5 truncate text-[var(--text-faint)]">
                {error ? <span className="text-[var(--err)]">{String(c.answer?.errorMessage ?? '')}</span>
                  : asked.length ? `→ ${asked.join(', ')}` : t('turnLog.answered')}
              </div>
              <div className="mt-0.5 tabular-nums text-[11px] text-[var(--text-faint)]">{fill(t('turnLog.tokens'), { input: k(cu.input), cached: k(cu.cached), output: k(cu.output) })}</div>
            </button>
          );
        })}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--text-faint)]">
          <b className="text-[13px] text-[var(--text)]">#{call.no}</b>
          {call.thread ? <span className="text-[#c0603a]">{call.thread.label}</span> : null}
          {facts.map((f, i) => <span key={i}>{f}</span>)}
          <span className="tabular-nums">{fill(t('turnLog.tokens'), { input: u.input.toLocaleString(), cached: u.cached.toLocaleString(), output: u.output.toLocaleString() })}{u.reasoning ? ` (${fill(t('turnLog.reasoningTokens'), { n: u.reasoning.toLocaleString() })})` : ''}</span>
          <span className="tabular-nums">{seconds(call.ms)}</span>
          <span className="flex-1" />
          <button type="button" className={small} onClick={() => setRaw((r) => !r)}>{raw ? t('turnLog.readable') : 'JSON'}</button>
        </div>
        {call.source ? (
          <div className="-mt-1.5 mb-3 truncate text-[11.5px] text-[var(--text-faint)]" title={call.source.file}>
            {fill(t('turnLog.fromRecord'), { file: call.source.file })}
          </div>
        ) : null}
        {call.lacks.map((name) => <p key={name} className="-mt-1.5 mb-3 text-[12px] text-[var(--text-faint)]">{t(`turnLog.lacks.${name}`)}</p>)}
        {raw ? (
          <pre className={`${block} rounded-[8px] border border-[var(--border)] bg-[var(--bg-field)] p-3`}>
            {JSON.stringify({ request: { systemPrompt: call.systemPrompt, messages: call.messages, tools: call.tools, ...(call.settings ? { settings: call.settings } : {}) }, answer: call.answer }, null, 2)}
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
              ) : <p className="text-[12.5px] text-[var(--text-faint)]">—</p>}
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
              {call.tools ? (
                <details>
                  <summary className="cursor-pointer text-[12.5px] font-semibold text-[var(--text)]">{fill(t('turnLog.rest'), { n: tools.length })}</summary>
                  <div className="mt-2 space-y-2">
                    <div className="text-[12px] text-[var(--text-faint)]">{tools.map((tool) => tool.name).join(', ')}</div>
                    <pre className={`${block} max-h-[480px] overflow-auto rounded-[8px] border border-[var(--border)] bg-[var(--bg-field)] p-3`}>{JSON.stringify(call.tools, null, 2)}</pre>
                  </div>
                </details>
              ) : (
                <p className="text-[12.5px] text-[var(--text-faint)]">{t(call.toolsUnknown ? 'turnLog.toolsUnknown' : 'turnLog.toolsMissing')}</p>
              )}
            </section>
            {call.settings ? (
              <section>
                <details>
                  <summary className="cursor-pointer text-[12.5px] font-semibold text-[var(--text)]">{t('turnLog.settings')}</summary>
                  <pre className={`${block} mt-2 max-h-[480px] overflow-auto rounded-[8px] border border-[var(--border)] bg-[var(--bg-field)] p-3`}>{JSON.stringify(call.settings, null, 2)}</pre>
                </details>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── sent to the agent ──────────────────────────────────────────────────────── */

/** A message's blocks as the agent got them: text, pictures (kept by file), anything else as it was. */
function SentBlocks({ blocks, t }: { blocks: Item[]; t: T }) {
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => (b?.type === 'text' ? <Clamped key={i} text={String(b.text ?? '')} max={20000} t={t} />
        : b?.type === 'image' ? (
          <div key={i} className="font-mono text-[12px] text-[var(--text-faint)]">
            {fill(t('turnLog.picture'), { type: String(b.mimeType ?? ''), size: k(Number(b.bytes) || 0) })}{b.file ? ` · ${String(b.file)}` : ''}
          </div>
        ) : <Clamped key={i} text={pretty(b)} t={t} />))}
    </div>
  );
}

/** How a session's skills and MCP servers were set (agent-skills.mjs `log`): OpenFilm's, and the person's own hidden or let in. */
function skillsLines(skills: Item, t: T): string[] {
  const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join(', ') : '—');
  return [
    `${t('turnLog.skillsOpenfilm')}: ${list(skills.openfilm)}`,
    skills.filtered ? `${t('turnLog.skillsHidden')}: ${list(skills.hidden)}` : t('turnLog.skillsUnfiltered'),
    ...(skills.mcpFiltered ? [`${t('turnLog.mcpHidden')}: ${list(skills.mcpHidden)}`] : []),
    ...([...(skills.allowed ?? []), ...(skills.mcpAllowed ?? [])].length ? [`${t('turnLog.letIn')}: ${list([...(skills.allowed ?? []), ...(skills.mcpAllowed ?? [])])}`] : []),
  ];
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-3 border-t border-[var(--border)] py-2 first:border-t-0">
      <div className="text-[12px] text-[var(--text-faint)]">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Sent({ events, t }: { events: LogEvent[]; t: T }) {
  const prompt = events.find((e) => e.kind === 'prompt') as Item | undefined;
  const opened = prompt?.opened as Item | null | undefined;
  const messages = events.filter((e) => e.kind === 'sent' || e.kind === 'steer') as Item[];
  const start = prompt?.t ?? 0;
  const heading = 'mb-2 text-[12.5px] font-semibold text-[var(--text)]';
  const appended = opened?.session?.params?._meta?.systemPrompt?.append;
  const developer = opened?.codexConfig?.developer_instructions;
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
      <section>
        <div className={heading}>{t('turnLog.opened')}</div>
        {!opened ? <p className="text-[12.5px] text-[var(--text-faint)]">{t('turnLog.noOpened')}</p> : (
          <div className="rounded-[8px] border border-[var(--border)] px-3">
            <Labeled label={t('turnLog.program')}>
              <div className={block}>{(opened.command ?? [opened.program]).join(' ')}{opened.adapter ? `\n${fill(t('turnLog.through'), { adapter: String(opened.adapter) })}` : ''}</div>
            </Labeled>
            {typeof appended === 'string' ? <Labeled label={t('turnLog.appended')}><Clamped text={appended} max={20000} t={t} /></Labeled> : null}
            {typeof developer === 'string' ? <Labeled label={t('turnLog.developer')}><Clamped text={developer} max={20000} t={t} /></Labeled> : null}
            {typeof opened.firstMessage === 'string' ? <Labeled label={t('turnLog.firstMessage')}><Clamped text={opened.firstMessage} max={20000} t={t} /></Labeled> : null}
            {opened.skills ? <Labeled label={t('turnLog.skills')}><div className={block}>{skillsLines(opened.skills, t).join('\n')}</div></Labeled> : null}
            <Labeled label={t('turnLog.session')}><Clamped text={pretty(opened.session ?? null)} t={t} /></Labeled>
            <Labeled label={t('turnLog.env')}><Clamped text={pretty({ ...opened.env, PATH: opened.path, fromShell: opened.fromShell })} t={t} /></Labeled>
            <Labeled label={t('turnLog.handshake')}>
              <details>
                <summary className="cursor-pointer text-[12px] text-[var(--text-faint)]">initialize</summary>
                <div className="mt-1"><Clamped text={pretty(opened.initialize ?? null)} t={t} /></div>
              </details>
            </Labeled>
          </div>
        )}
      </section>
      <section>
        <div className={heading}>{fill(t('turnLog.messages'), { n: messages.length })}</div>
        {messages.length === 0 ? <p className="text-[12.5px] text-[var(--text-faint)]">{t('turnLog.noSent')}</p> : (
          <div className="space-y-2">
            {messages.map((m, i) => (
              <div key={i} className="rounded-[8px] border border-[var(--border)] px-3 py-2">
                <div className="mb-1.5 flex gap-2 text-[12px] text-[var(--text-faint)]">
                  <b className="text-[var(--text)]">{t(m.kind === 'steer' ? 'turnLog.steered' : 'turnLog.message')}</b>
                  <span className="tabular-nums">+{seconds(m.t - start)}</span>
                  {m._meta ? <span className="font-mono">_meta {JSON.stringify(m._meta)}</span> : null}
                </div>
                <SentBlocks blocks={(m.prompt ?? [{ type: 'text', text: m.text }]) as Item[]} t={t} />
              </div>
            ))}
          </div>
        )}
      </section>
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

/** A start or a turn that failed: why, the step it stopped at, and the last the agent wrote to stderr. */
function failed(event: LogEvent): string {
  return `${str(event.error, 500)}${event.step ? `  · ${str(event.step)}` : ''}${event.stderr ? `  · ${str(String(event.stderr).trim().split('\n').slice(-3).join(' | '), 300)}` : ''}`;
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
    case 'sent': return { kind: 'prompt', label: 'sent', summary: str(((event.prompt ?? []) as Item[]).map((b) => (b?.type === 'text' ? b.text : `[${b?.type}]`)).join(' '), 600) };
    case 'steer': return { kind: 'prompt', label: 'steer', summary: str(event.text, 600) };
    case 'steer-answer': return { kind: 'prompt', label: 'steer · answer', summary: str(event.outcome), tone: event.outcome === 'injected' ? undefined : 'error' };
    case 'cancel': return { kind: 'end', label: 'cancel', summary: '' };
    case 'set-option': return { kind: 'update', label: 'set option', summary: `${str(event.configId)} = ${str(event.value)}`, tone: 'quiet' };
    case 'exit': return { kind: 'end', label: 'exit', summary: `code ${str(event.code)}${event.stderr ? `  ${str(event.stderr, 300)}` : ''}`, tone: event.code ? 'error' : undefined };
    case 'start': return { kind: 'end', label: 'start', summary: failed(event), tone: 'error' };
    case 'done': return { kind: 'end', label: 'done', summary: event.ok ? str(event.stopReason) : failed(event), tone: event.ok ? undefined : 'error' };
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
  prompt: 'text-[var(--text)]',
  message: 'text-[var(--text)]',
  thought: 'text-[var(--text-faint)]',
  tool: 'text-[#3f8fd0]',
  ask: 'text-[#b07a1f]',
  end: 'text-[var(--text)]',
};

/** a collapsed line's height (px), and how many lines past the view are drawn each way */
const ROW_HEIGHT = 26;
const OVERSCAN = 30;

/** A stable key for a line: its first event's, given as it is first seen. */
const rowKeys = new WeakMap<LogEvent, number>();
let lastRowKey = 0;
const rowKey = (event: LogEvent) => {
  let key = rowKeys.get(event);
  if (key === undefined) { key = ++lastRowKey; rowKeys.set(event, key); }
  return key;
};

/** The first line whose bottom is below `y`, in `offsets` (each line's top, and the end). */
function lineAt(offsets: Float64Array, y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1]! <= y) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo);
}

/** An opened line, telling its height as it changes. */
function Measured({ onHeight, children }: { onHeight: (px: number) => void; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    onHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => onHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeight]);
  return <div ref={ref}>{children}</div>;
}

function Events({ events, t }: { events: LogEvent[]; t: T }) {
  const [joined, setJoined] = React.useState(true);
  const [filter, setFilter] = React.useState('');
  const needle = React.useDeferredValue(filter).trim().toLowerCase();
  /* the opened lines, by their first event (a line keeps it as the log grows and older events go) */
  const [openRows, setOpenRows] = React.useState<Set<LogEvent>>(() => new Set());
  const heights = React.useRef(new Map<LogEvent, number>());
  const [measured, setMeasured] = React.useState(0);
  const start = events[0]?.t ?? 0;
  const rows = React.useMemo(() => rowsOf(events, joined), [events, joined]);
  const shown = React.useMemo(() => (needle ? rows.filter((row) => `${row.label} ${row.summary}`.toLowerCase().includes(needle)) : rows), [rows, needle]);
  const toggle = (event: LogEvent) => setOpenRows((set) => { const next = new Set(set); if (next.has(event)) next.delete(event); else next.add(event); return next; });

  /* each line's top: a collapsed one ROW_HEIGHT, an opened one as measured */
  const offsets = React.useMemo(() => {
    const out = new Float64Array(shown.length + 1);
    for (let i = 0; i < shown.length; i += 1) {
      const first = shown[i]!.events[0]!;
      out[i + 1] = out[i]! + (openRows.has(first) ? heights.current.get(first) ?? ROW_HEIGHT : ROW_HEIGHT);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `measured` says the heights changed
  }, [shown, openRows, measured]);
  const heightOf = React.useCallback((event: LogEvent) => (px: number) => {
    if (heights.current.get(event) === px) return;
    heights.current.set(event, px);
    setMeasured((n) => n + 1);
  }, []);
  const onHeight = React.useRef(new Map<LogEvent, (px: number) => void>());
  const measure = (event: LogEvent) => {
    let fn = onHeight.current.get(event);
    if (!fn) { fn = heightOf(event); onHeight.current.set(event, fn); }
    return fn;
  };

  /* the view: where it is scrolled and how tall; at the end it stays at the end as lines come */
  const scroller = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ top: 0, height: 800 });
  const atEnd = React.useRef(false);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setView({ top: el.scrollTop, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const total = offsets[shown.length] ?? 0;
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atEnd.current && el.scrollTop + el.clientHeight < el.scrollHeight - 1) el.scrollTop = el.scrollHeight;
  }, [total]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atEnd.current = el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    setView({ top: el.scrollTop, height: el.clientHeight });
  };
  const first = shown.length ? Math.max(0, lineAt(offsets, view.top) - OVERSCAN) : 0;
  const last = shown.length ? Math.min(shown.length, lineAt(offsets, view.top + view.height) + 1 + OVERSCAN) : 0;

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-5 py-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('turnLog.filter')}
          className="h-7 w-64 rounded-[7px] border border-[var(--border)] bg-transparent px-2.5 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--text-muted)]" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-faint)]">
          <input type="checkbox" checked={joined} onChange={(e) => setJoined(e.target.checked)} />
          {t('turnLog.joined')}
        </label>
      </div>
      <div ref={scroller} onScroll={onScroll} data-turn-log-events="" className="min-h-0 flex-1 overflow-y-auto px-2 py-2 font-mono text-[12px] leading-[1.55]">
        {shown.length === 0 ? <p className="px-3 py-2 font-sans text-[13px] text-[var(--text-faint)]">{t('turnLog.noMatch')}</p> : (
          <div className="relative" style={{ height: total }}>
            <div className="absolute inset-x-0" style={{ top: offsets[first] }}>
              {shown.slice(first, last).map((row) => {
                const key = row.events[0]!;
                const open = openRows.has(key);
                const line = (
                  <div className="rounded-[6px] hover:bg-[var(--bg-hover)]" style={open ? undefined : { height: ROW_HEIGHT }}>
                    <button type="button" onClick={() => toggle(key)} className="flex w-full items-start gap-3 px-3 py-1 text-left">
                      <ChevronRight size={12} className={`mt-[3px] shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-90' : ''}`} />
                      <span className="w-[68px] shrink-0 text-right tabular-nums text-[var(--text-faint)]">+{((row.at - start) / 1000).toFixed(2)}s</span>
                      <span className={`w-[150px] shrink-0 truncate ${KIND_COLOR[row.kind] ?? 'text-[var(--text-faint)]'}`}>{row.label}{row.events.length > 1 ? ` ×${row.events.length}` : ''}</span>
                      <span className={`min-w-0 flex-1 ${open ? 'whitespace-pre-wrap break-words' : 'truncate'} ${row.tone === 'error' ? 'text-[var(--err)]' : row.tone === 'quiet' ? 'text-[var(--text-faint)]' : 'text-[var(--text)]'}`}>{open ? row.summary : row.summary.slice(0, 1000)}</span>
                    </button>
                    {open ? (
                      <pre className="mx-3 mb-2 ml-[100px] max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border)] bg-[var(--bg-field)] p-3 text-[11.5px] text-[var(--text)]">
                        {JSON.stringify(row.events.length === 1 ? row.events[0] : row.events, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                );
                return open ? <Measured key={rowKey(key)} onHeight={measure(key)}>{line}</Measured> : <React.Fragment key={rowKey(key)}>{line}</React.Fragment>;
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
