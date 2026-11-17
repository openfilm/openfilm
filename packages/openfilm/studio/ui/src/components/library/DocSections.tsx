/**
 * The body of an editor's, a connector's and a skill's page, laid out alike so each is read the same way: an editor's
 * recording of it at work (a connector has none; a skill's is SkillChatBand), what it does (highlights), working with the agent (a request and what the agent does, each put in the chat
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
import type { Plugin, PluginExample } from '@/lib/plugins';

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

/* ── the editor at work: a recording of the real app ─────────────────────────────────────────────────────────── */

/** Whether the person asked for less motion: a recording is then shown as its first picture. */
const lessMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The editor at work, at the head of its page: its recording (openfilm.json `showcase.video`), played muted, looped and
 * inline from its poster, with no controls; its poster alone where less motion is asked for. A plugin without one (a
 * connector) has no band.
 */
export function PreviewBand({ plugin }: { plugin: Pick<Plugin, 'id' | 'mcpServers' | 'showcase'> }) {
  const video = plugin.mcpServers ? undefined : plugin.showcase?.video;
  if (!video) return null;
  const at = (name: string) => `/api/plugin-preview/${encodeURIComponent(plugin.id)}/${encodeURIComponent(name)}`;
  const poster = video.poster ? at(video.poster) : undefined;
  return (
    <div aria-hidden data-preview-band={plugin.id}
      className="relative mt-8 aspect-video w-full overflow-hidden rounded-[16px] bg-black shadow-[0_18px_48px_-18px_rgba(0,0,0,.6)] ring-1 ring-[var(--border)]">
      {lessMotion() && poster
        ? <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
        : <video src={at(video.src)} poster={poster} autoPlay muted loop playsInline preload="auto" disablePictureInPicture className="absolute inset-0 h-full w-full object-cover" />}
    </div>
  );
}
