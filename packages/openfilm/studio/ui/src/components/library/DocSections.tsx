/**
 * The body of an editor's, a connector's and a skill's page, laid out alike so each is read the same way: a picture of
 * it at work, what it does (highlights), working with the agent (a request and what the agent does, each put in the chat
 * by a click), how to use it (numbered steps), its keys, then one quiet line on what turning it off does. A plugin's
 * `details` (a line each, "When to use it: …") is sorted into these by each line's lead.
 */
import React from 'react';
import {
  ArrowUpRight, AudioLines, Captions, Clapperboard, Copy, Crop, Eye, FolderOpen, Gauge, Image, Layers, ListChecks, MapPin,
  MessageSquare, MessageSquarePlus, Music, Palette, PenLine, Scissors, Search, Send, Share2, SlidersHorizontal, Sparkles,
  Upload, Video, Wand2, Workflow, type LucideIcon,
} from 'lucide-react';
import { studioHost } from '@/lib/host';
import { closePlugins } from '@/lib/plugins-window';
import type { PluginExample } from '@/lib/plugins';

/** The marks a highlight may name (openfilm.json `showcase.highlights[].icon`); another is drawn as sparkles. */
const MARKS: Record<string, LucideIcon> = {
  scissors: Scissors, layers: Layers, captions: Captions, music: Music, upload: Upload, eye: Eye, 'map-pin': MapPin,
  message: MessageSquare, crop: Crop, sparkles: Sparkles, image: Image, video: Video, palette: Palette, sliders: SlidersHorizontal,
  wand: Wand2, copy: Copy, gauge: Gauge, workflow: Workflow, audio: AudioLines, film: Clapperboard, folder: FolderOpen,
  search: Search, send: Send, share: Share2, pen: PenLine, list: ListChecks, open: ArrowUpRight,
};

/** A part of the page: its head, a line under it, what it holds. */
export function DocSection({ title, note, children }: { title: string; note?: string; children?: React.ReactNode }) {
  return (
    <section className="mt-10 first:mt-0" data-doc-section="">
      <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h3>
      {note ? <p className="mt-1 text-[13px] leading-[18px] text-[var(--text-faint)]">{note}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

/** Lines with a lead ("When to use it: …"), the lead a shade brighter. */
export function DocLines({ lines }: { lines: readonly { lead?: string; text: string }[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {lines.map((line) => (
        <p key={`${line.lead ?? ''}${line.text}`} className="text-[14px] leading-[22px] text-[var(--text-muted)]">
          {line.lead ? <span className="font-medium text-[var(--text)]">{line.lead} </span> : null}{line.text}
        </p>
      ))}
    </div>
  );
}

/** What it does, at a glance: a card each, its mark, a few words, a line. */
export function DocHighlights({ items }: { items: readonly { icon: string; title: string; text: string }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-doc-highlights="">
      {items.map((item) => {
        const Mark = MARKS[item.icon] ?? Sparkles;
        return (
          <div key={item.title} className="flex gap-3.5 rounded-[14px] bg-[var(--bg-field)] p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--bg-pressed)] text-[var(--text)]"><Mark size={17} strokeWidth={1.75} aria-hidden /></span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold leading-[20px] text-[var(--text)]">{item.title}</span>
              <span className="mt-1 block text-[13px] leading-[19px] text-[var(--text-muted)]">{item.text}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** One of `examples` as words to say and what the agent does (none: it only says). */
const exampleWords = (e: PluginExample) => (typeof e === 'string' ? { say: e, does: undefined } : e);

/**
 * Working with the agent: each request as the person would write it, in a bubble, and under it what the agent does;
 * a click puts the request in the chat (where there is one).
 */
export function DocAgent({ examples, put }: { examples: readonly PluginExample[]; put: string }) {
  const say = (text: string) => { studioHost?.ask?.({ text, refs: [] }); closePlugins(); };
  const canSay = Boolean(studioHost?.ask);
  return (
    <div className="flex flex-col gap-3" data-doc-agent="">
      {examples.map(exampleWords).map(({ say: text, does }) => (
        <div key={text} className="group rounded-[14px] bg-[var(--bg-field)] p-4">
          <div className="flex items-start justify-end gap-3">
            <p className="max-w-[85%] rounded-[16px] rounded-tr-[5px] bg-[var(--bg-pressed)] px-3.5 py-2.5 text-[14px] leading-[20px] text-[var(--text)]">{text}</p>
          </div>
          {does ? (
            <div className="mt-3 flex items-start gap-2.5">
              <span className="mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]"><Sparkles size={12} aria-hidden /></span>
              <p className="min-w-0 flex-1 text-[13.5px] leading-[20px] text-[var(--text-muted)]">{does}</p>
            </div>
          ) : null}
          {canSay ? (
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => say(text)} data-doc-example=""
                className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                <MessageSquarePlus size={13} aria-hidden />{put}
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Steps, numbered, each on a line of its own. */
export function DocSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="flex flex-col overflow-hidden rounded-[14px] bg-[var(--bg-field)]">
      {steps.map((step, i) => (
        <li key={step} className="flex items-start gap-3.5 border-b border-[var(--border)] px-4 py-3.5 text-[14px] leading-[21px] text-[var(--text-muted)] last:border-b-0">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--bg-pressed)] text-[12px] font-semibold tabular-nums text-[var(--text)]">{i + 1}</span>
          <span className="pt-[1px]">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** Its keys: what each does, and its key caps. */
export function DocKeys({ items }: { items: readonly { keys: readonly string[]; label: string }[] }) {
  return (
    <div className="grid gap-x-8 gap-y-0 rounded-[14px] bg-[var(--bg-field)] px-4 py-1.5 sm:grid-cols-2" data-doc-keys="">
      {items.map((k) => (
        <div key={k.label} className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2.5 text-[13.5px] text-[var(--text-muted)] last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
          <span className="min-w-0 truncate">{k.label}</span>
          <span className="flex shrink-0 items-center gap-1">
            {k.keys.map((cap) => (
              <kbd key={cap} className="grid h-6 min-w-6 place-items-center rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-raised)] px-1.5 font-sans text-[11.5px] font-medium text-[var(--text)] shadow-[0_1px_0_var(--border-strong)]">{cap}</kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The quiet last line: what turning it off does. */
export function DocOff({ text }: { text: string }) {
  /* the line after a lead ("Turned off: no timeline…") stands alone here: it starts as a sentence does */
  const said = text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text;
  return <p className="mt-10 border-t border-[var(--border)] pt-5 text-[13px] leading-[20px] text-[var(--text-faint)]">{said}</p>;
}

/* the leads of a plugin's `details`, in every language its words are in */
const HOW = /^(怎么用|怎么改|How to use it|How it changes|How|使い方|直し方|사용법|쓰는 법|고치는 법|Cómo usarlo|Cómo se cambia|Cómo)\s*[：:]$/i;
const OFF = /^(关掉后|停用后|Turned off|オフにすると|끄면|Si se desactiva)\s*[：:]$/i;
/* every plugin is free: a line on cost is not shown */
const COST = /^(费用|Cost|費用|비용|Coste)\s*[：:]$/i;

/** A plugin's or a skill's `details` sorted into what it does, how to use it, and what turning it off does. */
export function sortDetails(text: string | undefined): { about: { lead?: string; text: string }[]; how: string[]; off: string | null } {
  const about: { lead?: string; text: string }[] = [];
  const how: string[] = [];
  let off: string | null = null;
  for (const line of (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^(.{1,24}?[：:])\s*(.+)$/.exec(line);
    const lead = m?.[1], body = m?.[2] ?? line;
    if (lead && COST.test(lead)) continue;
    if (lead && HOW.test(lead)) how.push(body);
    else if (lead && OFF.test(lead)) off = body;
    else about.push(lead ? { lead, text: body } : { text: body });
  }
  return { about, how, off };
}

/* ── the picture of it at work: each editor drawn from its own pieces, as it looks ─────────────────────────────── */

const BAND = 'relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[radial-gradient(120%_140%_at_50%_0%,color-mix(in_srgb,var(--text)_7%,transparent),transparent_60%),var(--bg-field)]';
/** A frame of film, as the picture: a soft light over dark, with a horizon. */
const Frame = ({ className = '', warm = false }: { className?: string; warm?: boolean }) => (
  <div className={`relative overflow-hidden rounded-[8px] ${className}`}
    style={{ background: warm
      ? 'radial-gradient(60% 80% at 70% 30%, #f5b06b 0%, #c4623a 28%, #3a2230 62%, #141018 100%)'
      : 'radial-gradient(70% 90% at 30% 25%, #9fb7d8 0%, #4d6a92 30%, #1d2638 64%, #0d1018 100%)' }}>
    <div className="absolute inset-x-0 bottom-0 h-[38%] bg-[linear-gradient(to_top,rgba(0,0,0,.65),transparent)]" />
    <div className="absolute bottom-[26%] left-0 right-0 h-px bg-white/25" />
  </div>
);
const Bar = ({ w, tone = 'bg-[var(--text)]/20', className = '' }: { w: string; tone?: string; className?: string }) => <span className={`block h-[6px] rounded-full ${tone} ${className}`} style={{ width: w }} />;

function EditBand() {
  const lane = (clips: [number, number, boolean?][], color: string) => (
    <div className="relative h-[18px]">
      {clips.map(([at, len, on], i) => (
        <span key={i} className={`absolute top-0 h-full rounded-[4px] ${on ? 'ring-2 ring-[var(--accent)]' : ''}`} style={{ left: `${at}%`, width: `${len}%`, background: color }} />
      ))}
    </div>
  );
  return (
    <div className="grid h-full grid-rows-[1fr_auto] gap-3 p-5">
      <div className="grid min-h-0 grid-cols-[1fr_180px] gap-3">
        <div className="flex min-h-0 items-center justify-center rounded-[10px] bg-black/40 p-3"><Frame className="aspect-video h-full max-h-full" /></div>
        <div className="flex flex-col gap-2.5 rounded-[10px] bg-black/20 p-3.5">
          <Bar w="45%" tone="bg-[var(--text)]/45" /><Bar w="80%" /><Bar w="65%" /><div className="mt-1.5 h-px bg-[var(--border)]" />
          <Bar w="35%" tone="bg-[var(--text)]/45" /><Bar w="70%" /><Bar w="55%" />
        </div>
      </div>
      <div className="relative flex flex-col gap-1.5 rounded-[10px] bg-black/25 px-3 py-3">
        {lane([[2, 18], [22, 30, true], [54, 24], [80, 16]], 'color-mix(in srgb, #5b8def 55%, #1b2234)')}
        {lane([[10, 22], [40, 14]], 'color-mix(in srgb, #c98b4b 55%, #1b2234)')}
        {lane([[0, 96]], 'color-mix(in srgb, #3fae8a 45%, #1b2234)')}
        <span className="absolute bottom-1 top-1 w-[2px] rounded-full bg-[var(--text)]" style={{ left: '38%' }} />
      </div>
    </div>
  );
}

function ScreeningBand() {
  return (
    <div className="flex h-full flex-col gap-3 px-10 py-5">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <Frame warm className="aspect-video h-full max-h-full" />
        <span className="absolute left-[56%] top-[24%] h-[34%] w-[16%] rounded-[4px] border-2 border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]" />
        <span className="absolute left-[56%] top-[24%] grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--accent)] text-[10.5px] font-bold text-[var(--on-accent)]">2</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="relative h-4">
          <span className="absolute top-1/2 grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--accent)] text-[9px] font-bold text-[var(--on-accent)]" style={{ left: '24%' }}>1</span>
          <span className="absolute inset-y-[3px] rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_35%,transparent)] ring-1 ring-[var(--accent)]" style={{ left: '62%', width: '18%' }} />
        </div>
        <div className="flex h-7 overflow-hidden rounded-[6px]">
          {['#2b3550', '#4a3a52', '#6a4a44', '#8a5a3c', '#5a4a5a', '#3a4a62', '#2e3a54', '#4d3c50'].map((c) => <span key={c} className="h-full flex-1 border-r border-black/30" style={{ background: c }} />)}
        </div>
        <span className="block h-1 rounded-full bg-[var(--text)]/15"><span className="block h-full w-[46%] rounded-full bg-[var(--text)]/60" /></span>
      </div>
    </div>
  );
}

function CanvasBand() {
  const node = (x: string, y: string, w: string, children: React.ReactNode, on = false) => (
    <div className={`absolute rounded-[10px] bg-[var(--bg-raised)] p-2 shadow-[0_8px_24px_rgba(0,0,0,.35)] ${on ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-[var(--border)]'}`} style={{ left: x, top: y, width: w }}>{children}</div>
  );
  return (
    <div className="relative h-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--text)_14%,transparent)_1px,transparent_1.2px)] [background-size:16px_16px]">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden>
        <path d="M27 38 C 36 38, 36 30, 45 30" stroke="var(--text-faint)" strokeWidth="0.35" fill="none" vectorEffect="non-scaling-stroke" />
        <path d="M27 38 C 36 38, 36 66, 45 66" stroke="var(--text-faint)" strokeWidth="0.35" fill="none" vectorEffect="non-scaling-stroke" />
        <path d="M66 30 C 72 30, 72 48, 78 48" stroke="var(--accent)" strokeWidth="0.5" fill="none" vectorEffect="non-scaling-stroke" />
        <path d="M66 66 C 72 66, 72 48, 78 48" stroke="var(--text-faint)" strokeWidth="0.35" fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      {node('7%', '24%', '20%', <><Bar w="40%" tone="bg-[var(--text)]/45" /><Bar w="90%" className="mt-2" /><Bar w="75%" className="mt-1.5" /><Bar w="60%" className="mt-1.5" /></>)}
      {node('45%', '12%', '21%', <Frame className="aspect-video w-full" />)}
      {node('45%', '54%', '21%', <Frame warm className="aspect-video w-full" />)}
      {node('78%', '30%', '17%', <div className="flex aspect-[9/16] w-full items-center justify-center rounded-[6px] bg-black/50 text-[var(--text-muted)]"><Video size={18} aria-hidden /></div>, true)}
    </div>
  );
}

function ColorBand() {
  const wheel = (label: string, dot: [number, number]) => (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative aspect-square w-full rounded-full p-[3px]" style={{ background: 'conic-gradient(from 90deg, #e25c5c, #e2c35c, #6ad36a, #5cc8e2, #6a6ae2, #d35cd3, #e25c5c)' }}>
        <div className="h-full w-full rounded-full bg-[radial-gradient(circle,#2a2a2e_0%,#1a1a1e_70%)]" />
        <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent" style={{ left: `${dot[0]}%`, top: `${dot[1]}%` }} />
      </div>
      <span className="text-[10px] text-[var(--text-faint)]">{label}</span>
    </div>
  );
  return (
    <div className="grid h-full grid-cols-[1.35fr_1fr] gap-4 p-5">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-[10px] bg-black/40 p-3"><Frame warm className="aspect-video h-full max-h-full" /></div>
        <div className="flex h-9 gap-1.5">
          {['#3a5878', '#7a5a3c', '#5a6a4a', '#7a4a4a', '#4a5a7a'].map((c, i) => <span key={c} className={`flex-1 rounded-[5px] ${i === 1 ? 'ring-2 ring-[var(--accent)]' : ''}`} style={{ background: c }} />)}
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-3">
        <div className="grid grid-cols-3 gap-3 px-1">{wheel('Lift', [44, 56])}{wheel('Gamma', [52, 48])}{wheel('Gain', [62, 40])}</div>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[10px] bg-black/50">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
            {Array.from({ length: 60 }, (_, i) => {
              const x = (i / 59) * 100, y = 20 + Math.sin(i / 5) * 8 + Math.cos(i / 2.3) * 3;
              return <line key={i} x1={x} x2={x} y1={y - 5} y2={y + 6} stroke="rgba(160,220,170,.55)" strokeWidth="0.6" />;
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

function ConnectorBand({ icon }: { icon?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center gap-6 px-8">
      <span className="flex h-16 w-16 items-center justify-center rounded-[16px] bg-[var(--bg-raised)] text-[var(--text)] shadow-[0_8px_24px_rgba(0,0,0,.35)] ring-1 ring-[var(--border)]"><Sparkles size={26} strokeWidth={1.6} aria-hidden /></span>
      <span className="flex items-center gap-1.5">
        {Array.from({ length: 7 }, (_, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === 3 ? 'bg-[var(--accent)]' : 'bg-[var(--text)]/25'}`} />)}
      </span>
      <span className="flex h-16 w-16 items-center justify-center rounded-[16px] shadow-[0_8px_24px_rgba(0,0,0,.35)]">{icon}</span>
    </div>
  );
}

/** The picture of a plugin at work, at the head of its page: the editor drawn from its own pieces, or a connector's link. */
export function PreviewBand({ kind, icon }: { kind: string | null; icon?: React.ReactNode }) {
  const drawn = kind === 'edit' ? <EditBand /> : kind === 'screening' ? <ScreeningBand /> : kind === 'canvas' ? <CanvasBand />
    : kind === 'color' ? <ColorBand /> : kind === 'connector' ? <ConnectorBand icon={icon} /> : null;
  if (!drawn) return null;
  return <div aria-hidden className={`${BAND} mt-8 h-[260px]`} data-preview-band={kind}>{drawn}</div>;
}
