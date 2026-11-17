/**
 * The body of an editor's, a connector's and a skill's page, laid out alike and set mostly in type, few boxes: a bar of
 * facts under its head, then sections ruled apart: what it does (a line, then its highlights in two columns), what to
 * say to the agent (a list of requests, what the agent then does under each, each put in the chat by a click), how to
 * use it (numbered), its keys, and one quiet line on what turning it off does. A plugin's `details` (a line each,
 * "When to use it: …") is sorted into these by each line's lead.
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

/** A part of the page, ruled off from the one before: its head, a line under it, what it holds. */
export function DocSection({ title, note, children }: { title: string; note?: string; children?: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] pt-7 mt-8 first:mt-0 first:border-t-0 first:pt-0" data-doc-section="">
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h3>
      {note ? <p className="mt-1 text-[13.5px] leading-[20px] text-[var(--text-muted)]">{note}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

/**
 * The page's facts in one bar under its head, as an app store sums an app up: each a small name, its value large, a
 * word under it; ruled apart, no box.
 */
export function InfoBar({ items }: { items: ReadonlyArray<{ key: string; name: string; value: React.ReactNode; note?: string } | null | false> }) {
  const shown = items.filter((f): f is { key: string; name: string; value: React.ReactNode; note?: string } => Boolean(f));
  if (!shown.length) return null;
  return (
    <div className="grid border-b border-[var(--border)] py-5 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]" data-info-bar="">
      {shown.map((f, i) => (
        <div key={f.key} className={`flex min-w-0 flex-col items-center gap-1.5 px-3 text-center ${i ? 'border-l border-[var(--border)]' : ''}`}>
          <span className="max-w-full truncate whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-faint)]">{f.name}</span>
          <span className="flex h-[22px] items-center text-[16px] font-semibold text-[var(--text)]">{f.value}</span>
          {f.note ? <span className="max-w-full truncate text-[12px] text-[var(--text-muted)]">{f.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Lines with a lead ("When to use it: …"), the lead a shade brighter. */
export function DocLines({ lines }: { lines: readonly { lead?: string; text: string }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line) => (
        <p key={`${line.lead ?? ''}${line.text}`} className="text-[14.5px] leading-[23px] text-[var(--text-muted)]">
          {line.lead ? <span className="font-medium text-[var(--text)]">{line.lead} </span> : null}{line.text}
        </p>
      ))}
    </div>
  );
}

/** What it does, at a glance: two columns, each its mark, a few words, a line; no boxes. */
export function DocHighlights({ items }: { items: readonly { icon: string; title: string; text: string }[] }) {
  return (
    <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2" data-doc-highlights="">
      {items.map((item) => {
        const Mark = MARKS[item.icon] ?? Sparkles;
        return (
          <div key={item.title} className="flex gap-3">
            <Mark size={18} strokeWidth={1.75} className="mt-[1px] shrink-0 text-[var(--text-muted)]" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold leading-[20px] text-[var(--text)]">{item.title}</span>
              <span className="mt-0.5 block text-[13.5px] leading-[20px] text-[var(--text-muted)]">{item.text}</span>
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
 * What to say to the agent: one list, a request on each line as the person would write it, what the agent then does
 * under it; a click on the line puts the request in the chat (where there is one).
 */
export function DocAgent({ examples, put }: { examples: readonly PluginExample[]; put: string }) {
  const say = (text: string) => { studioHost?.ask?.({ text, refs: [] }); closePlugins(); };
  const canSay = Boolean(studioHost?.ask);
  return (
    <ul className="overflow-hidden rounded-[12px] border border-[var(--border)]" data-doc-agent="">
      {examples.map(exampleWords).map(({ say: text, does }) => {
        const body = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] leading-[21px] text-[var(--text)]">“{text}”</span>
              {does ? <span className="mt-1 block text-[13px] leading-[19px] text-[var(--text-muted)]">{does}</span> : null}
            </span>
            {canSay ? <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100"><MessageSquarePlus size={14} aria-hidden />{put}</span> : null}
          </>
        );
        return (
          <li key={text} className="border-b border-[var(--border)] last:border-b-0">
            {canSay ? (
              <button type="button" onClick={() => say(text)} data-doc-example="" title={put}
                className="group flex w-full items-center gap-4 px-4 py-3.5 text-left transition hover:bg-[var(--bg-hover)]">{body}</button>
            ) : <div className="flex items-center gap-4 px-4 py-3.5">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** Steps, numbered, each on a line of its own. */
export function DocSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, i) => (
        <li key={step} className="flex items-start gap-3 text-[14.5px] leading-[22px] text-[var(--text-muted)]">
          <span className="mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[var(--border-strong)] text-[11px] font-semibold tabular-nums text-[var(--text)]">{i + 1}</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** Its keys: what each does, and its key caps, in two columns ruled apart. */
export function DocKeys({ items }: { items: readonly { keys: readonly string[]; label: string }[] }) {
  return (
    <div className="grid gap-x-10 sm:grid-cols-2" data-doc-keys="">
      {items.map((k) => (
        <div key={k.label} className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2.5 text-[13.5px] text-[var(--text-muted)]">
          <span className="min-w-0 truncate">{k.label}</span>
          <span className="flex shrink-0 items-center gap-1">
            {k.keys.map((cap) => (
              <kbd key={cap} className="grid h-[22px] min-w-[22px] place-items-center rounded-[5px] border border-[var(--border-strong)] px-1.5 font-sans text-[11.5px] font-medium text-[var(--text)]">{cap}</kbd>
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
  return <p className="mt-8 border-t border-[var(--border)] pt-6 text-[13px] leading-[20px] text-[var(--text-faint)]">{said}</p>;
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
