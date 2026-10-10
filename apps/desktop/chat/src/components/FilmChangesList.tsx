/**
 * Under the agent's reply, in developer mode (Settings → Developer): what the turn changed in the film
 * (lib/film-changes), one line that opens to each clip as a diff of film.html — its pill (a click shows it in Studio)
 * and what happened in a few words, then its line as it was (−) and as it is (+). A clip that is gone has nothing to
 * show: its pill is struck through and does not click. Turns saved before the lines were kept show the words only.
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useT } from '@/i18n';
import { clipPillKind, type ClipAspect, type ClipChange } from '@/lib/film-changes';
import { PromptPill, PromptPillRevealContext } from './prompt-editor';
import { StickToBottomContext } from './useStickToBottom';

/* a place to the tenth of a second, as the timeline shows it; a speed to the hundredth; a track as it is */
const NUMBER: Partial<Record<ClipAspect, (n: number) => string>> = {
  at: (n) => n.toFixed(1),
  speed: (n) => String(Math.round(n * 100) / 100),
  track: (n) => String(n),
};

/** What happened to a clip, in the chat's language: "moved 13.6 → 13.0 s · trimmed". */
function summary(change: ClipChange, t: (path: string) => string): string {
  if (change.change !== 'changed') return t(`filmChanges.${change.change}`);
  const phrase = (aspect: ClipAspect) => {
    const pair = aspect === 'at' ? change.at : aspect === 'speed' ? change.speed : aspect === 'track' ? change.track : undefined;
    const said = t(`filmChanges.aspect.${aspect}`);
    const show = NUMBER[aspect];
    return pair && show ? said.replace('{from}', show(pair[0])).replace('{to}', show(pair[1])) : said;
  };
  return (change.aspects?.length ? change.aspects : ['other' as const]).map(phrase).join(' · ');
}

/* a clip's line before and after, as git shows a change: one that only moved track is the same line, shown once */
function DiffLines({ before, after }: { before?: string; after?: string }) {
  if (before == null && after == null) return null;
  const lines: Array<['-' | '+' | ' ', string]> = before != null && before === after
    ? [[' ', before]]
    : [...(before != null ? [['-', before] as ['-', string]] : []), ...(after != null ? [['+', after] as ['+', string]] : [])];
  return (
    <div className="min-w-0 overflow-x-auto rounded-[6px] border border-[var(--border)] font-mono text-[11.5px] leading-[18px]">
      {lines.map(([sign, text], i) => (
        <div
          key={i}
          className={`flex w-max min-w-full whitespace-pre pr-2 ${sign === '-' ? 'bg-[rgba(229,83,75,0.13)] text-[#e5534b]' : sign === '+' ? 'bg-[rgba(63,185,80,0.13)] text-[#3fb950]' : 'text-[var(--chat-hint)]'}`}
        >
          <span aria-hidden className="w-5 shrink-0 select-none text-center opacity-80">{sign === ' ' ? '' : sign === '-' ? '−' : '+'}</span>
          <span>{text}</span>
        </div>
      ))}
    </div>
  );
}

export function FilmChangesList({ changes }: { changes: ClipChange[] }) {
  const t = useT();
  const ctx = React.useContext(PromptPillRevealContext);
  const thread = React.useContext(StickToBottomContext);
  const [open, setOpen] = React.useState(false);
  const label = changes.length === 1 ? t('filmChanges.one') : t('filmChanges.many').replace('{n}', String(changes.length));
  const toggle = () => {
    /* opening it makes the reply taller: the thread stays where it is, as it does for the work summary */
    thread?.skipNextPin();
    setOpen((value) => !value);
  };

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex items-center gap-1 text-[13px] text-[var(--chat-hint)] transition-colors hover:text-[var(--chat-text)]"
      >
        <span>{label}</span>
        <ChevronRight size={13} aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open ? (
        <ul className="mt-1 flex flex-col gap-2 border-l border-[var(--border)] pl-3 text-[13px]">
          {changes.map((change, index) => {
            const gone = change.change === 'removed';
            const reference = {
              id: `film-change:${change.id}`,
              kind: clipPillKind(change.src),
              label: change.id,
              target: { kind: 'clip', id: change.id, loc: null, label: change.id, clipKind: 'mg', src: change.src, start: 0, end: 0 },
            };
            const reveal = !gone ? ctx?.onReveal : undefined;
            return (
              <li key={`${change.id}:${index}`} className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`min-w-0 shrink ${gone ? 'opacity-60 [&_.truncate]:line-through' : ''}`}>
                    <PromptPill
                      reference={reference}
                      card={ctx?.describe?.(reference) ?? null}
                      {...(reveal && ctx?.revealLabel ? { hint: ctx.revealLabel } : {})}
                      {...(reveal ? { onClick: (event: React.MouseEvent) => { event.preventDefault(); reveal(reference); } } : {})}
                    />
                  </span>
                  <span className="min-w-0 truncate text-[var(--chat-hint)]">{summary(change, t)}</span>
                </div>
                <DiffLines before={change.before} after={change.after} />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
