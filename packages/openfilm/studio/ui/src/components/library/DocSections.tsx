/**
 * The body of an editor's, a connector's and a skill's page, laid out alike so each is read the same way: what it does,
 * how to use it (numbered steps), what to say (lines put in the chat by a click), then one quiet line on what turning it
 * off does. A plugin's `details` (a line each, "When to use it: …") is sorted into these by each line's lead.
 */
import React from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { studioHost } from '@/lib/host';
import { closePlugins } from '@/lib/plugins-window';

/** A part of the page: its head, a line under it, what it holds. */
export function DocSection({ title, note, children }: { title: string; note?: string; children?: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-6" data-doc-section="">
      <h3 className="text-[16px] font-semibold text-[var(--text)]">{title}</h3>
      {note ? <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{note}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

/** Lines with a lead ("When to use it: …"), the lead a shade brighter. */
export function DocLines({ lines }: { lines: readonly { lead?: string; text: string }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line) => (
        <p key={`${line.lead ?? ''}${line.text}`} className="text-[14px] leading-[21px] text-[var(--text-muted)]">
          {line.lead ? <span className="font-medium text-[var(--text)]">{line.lead} </span> : null}{line.text}
        </p>
      ))}
    </div>
  );
}

/** Steps, numbered. */
export function DocSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((step, i) => (
        <li key={step} className="flex items-start gap-3 text-[14px] leading-[20px] text-[var(--text-muted)]">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--bg-pressed)] text-[11.5px] font-semibold tabular-nums text-[var(--text)]">{i + 1}</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** What to say: each line put in the chat by a click (where there is a chat). */
export function DocSay({ examples }: { examples: readonly string[] }) {
  const say = (text: string) => { studioHost?.ask?.({ text, refs: [] }); closePlugins(); };
  return (
    <div className="flex flex-col gap-2">
      {examples.map((text) => (
        <button key={text} type="button" disabled={!studioHost?.ask} onClick={() => say(text)} data-doc-example=""
          className="group flex items-center gap-3 rounded-[12px] bg-[var(--bg-field)] px-4 py-3 text-left text-[14px] leading-[20px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:hover:bg-[var(--bg-field)]">
          <span className="min-w-0 flex-1">「{text}」</span>
          {studioHost?.ask ? <MessageSquarePlus size={15} className="shrink-0 text-[var(--text-faint)] transition group-hover:text-[var(--text)]" aria-hidden /> : null}
        </button>
      ))}
    </div>
  );
}

/** The quiet last line: what turning it off does. */
export function DocOff({ text }: { text: string }) {
  return <p className="mt-8 text-[13.5px] leading-[20px] text-[var(--text-faint)]">{text}</p>;
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
