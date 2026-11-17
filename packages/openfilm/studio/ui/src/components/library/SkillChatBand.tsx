/**
 * A skill at work, at the head of its page, as the conversation shows it: the person's request typed in (the skill
 * named with /, then when it is for, in its own words), the agent saying it uses the skill and each of its steps
 * ticked off in turn (its `details`' "how" lines), then the result landing as a card (its name and what it does). It
 * plays over and over; where less motion is asked for, it is shown done. A skill with no words of its own has none.
 */
import React from 'react';
import { Check, CircleDashed, Sparkles } from 'lucide-react';
import { useT } from '@/i18n';
import { sortDetails } from './DocSections';

/* how long each part takes, ms */
const TYPE_MS = 34, STEP_MS = 750, HOLD_MS = 2600;

export function SkillChatBand({ name, title, summary, details, icon }: {
  /** what the skill is called with (`/name`) */
  name: string; title: string; summary: string; details?: string; icon: React.ReactNode;
}) {
  const t = useT();
  const sorted = sortDetails(details);
  /* what the person says: when it is for, as they would ask it; else what it does */
  const ask = (sorted.about[0]?.text ?? summary).replace(/[。.]$/, '');
  const steps = (sorted.how.length ? sorted.how : summary.split(/[；;。]/)).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* the moment of the loop: letters typed, then steps done, then the card */
  const total = ask.length + 1 + steps.length + 1;
  const [at, setAt] = React.useState(still ? total : 0);
  React.useEffect(() => {
    if (still || !ask) return;
    const typing = at < ask.length;
    const wait = typing ? TYPE_MS : at === ask.length ? 500 : at < total ? STEP_MS : HOLD_MS;
    const timer = setTimeout(() => setAt((n) => (n >= total ? 0 : n + 1)), wait);
    return () => clearTimeout(timer);
  }, [at, ask, total, still]);
  if (!ask) return null;
  const typed = ask.slice(0, Math.min(at, ask.length));
  const sent = at > ask.length;
  const done = Math.max(0, at - ask.length - 1);
  const landed = at >= total;
  return (
    <div aria-hidden data-skill-band="" className="relative mt-8 aspect-[16/7] w-full overflow-hidden rounded-[16px] bg-[var(--bg-panel)] ring-1 ring-[var(--border)]">
      <div className="absolute inset-0 flex flex-col justify-end gap-3 px-[7%] pb-[5%] pt-[4%]">
        {/* the person's request */}
        <div className={`ml-auto max-w-[78%] rounded-[16px] rounded-br-[6px] bg-[var(--bg-field)] px-4 py-2.5 text-[14px] leading-[21px] text-[var(--text)] transition-opacity ${typed ? 'opacity-100' : 'opacity-0'}`}>
          <span className="mr-1.5 rounded-[6px] bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] px-1.5 py-0.5 text-[13px] font-medium text-[var(--accent)]">/{name}</span>
          {typed}{!sent ? <span className="ml-0.5 inline-block h-[15px] w-[1.5px] translate-y-[2px] animate-pulse bg-[var(--text)]" /> : null}
        </div>
        {/* the agent: the skill it uses, its steps ticked off */}
        <div className={`flex flex-col gap-1.5 transition-opacity duration-300 ${sent ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
            <Sparkles size={14} aria-hidden className="text-[var(--text-faint)]" />{t('assetDrawer.bandUses').replace('{name}', title)}
          </div>
          {steps.map((step, i) => (
            <div key={step} className={`flex items-center gap-2 pl-[2px] text-[13px] transition-all duration-300 ${i < done ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'}`}>
              {i < done - 1 || landed ? <Check size={14} aria-hidden className="text-[var(--accent)]" /> : <CircleDashed size={14} aria-hidden className="animate-spin text-[var(--text-faint)] [animation-duration:2s]" />}
              <span className="min-w-0 truncate text-[var(--text)]">{step}</span>
            </div>
          ))}
        </div>
        {/* what it made */}
        <div className={`flex items-center gap-3 rounded-[14px] bg-[var(--bg-field)] p-3 ring-1 ring-[var(--border)] transition-all duration-500 ${landed ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
          <span className="shrink-0">{icon}</span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[13.5px] font-medium text-[var(--text)]">{title}</span>
            <span className="truncate text-[12.5px] text-[var(--text-muted)]">{summary}</span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-panel)] px-2.5 py-1 text-[12px] text-[var(--text-muted)]"><Check size={12} aria-hidden />{t('assetDrawer.bandDone')}</span>
        </div>
      </div>
    </div>
  );
}
