'use client';

/**
 * A question from the agent (ask_user), shown above the composer where error cards appear.
 *
 * As with Claude Code's AskUserQuestion and Codex's request_user_input, the turn waits here: a picked option (or
 * number key), or a line written under "Other", is the result of that tool call and the agent carries on, in the
 * same turn, with no new bubble. The "asked you…" row in the conversation then shows the answer. Closing skips the
 * question and the agent goes on by its own judgment.
 */
import React from 'react';
import { ArrowUp, MessageCircleQuestion } from 'lucide-react';
import type { AgentAsk } from '@openfilm/shared';
import type { LocalAgentAnswer, LocalAgentQuestion } from '@/lib/desktop-bridge';
import { ChoiceRow, ComposerCard, useNumberKeys } from './ComposerCard';
import { useT } from '@/i18n';

export function TurnQuestionCard({
  ask,
  onAnswer,
  onSkip,
  allowOther = true,
}: {
  ask: Pick<AgentAsk, 'question' | 'options'>;
  /** Whether a free answer is allowed (some local agent questions take options only). A question without options always allows one. */
  allowOther?: boolean;
  /** The answer (the picked option's text, or what was written). */
  onAnswer: (text: string) => void;
  /** Closing skips the question. */
  onSkip: () => void;
}) {
  const t = useT();
  const [other, setOther] = React.useState('');
  /* Collapsed: out of the way, but the turn still waits; the card stays as one line with the question */
  const [collapsed, setCollapsed] = React.useState(false);
  const freeTextOnly = ask.options.length === 0;
  const [otherOpen, setOtherOpen] = React.useState(freeTextOnly);
  const canWrite = allowOther || freeTextOnly;
  const inputRef = React.useRef<HTMLInputElement>(null);

  const send = React.useCallback((text: string) => {
    const value = text.trim();
    if (value) onAnswer(value);
  }, [onAnswer]);
  const pickByIndex = React.useCallback((index: number) => {
    const option = ask.options[index];
    if (option) send(option.label);
    else if (canWrite && index === ask.options.length) { setOtherOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0); }
  }, [ask.options, canWrite, send]);
  useNumberKeys(ask.options.length + (canWrite ? 1 : 0), collapsed ? null : pickByIndex);

  return (
    <ComposerCard
      role="dialog"
      icon={<MessageCircleQuestion size={14} />}
      title={ask.question}
      onClose={onSkip}
      collapse={{ collapsed, onToggle: () => setCollapsed((v) => !v), label: t(collapsed ? 'turnAsk.expand' : 'turnAsk.collapse') }}
    >
      <div className="-mx-1 mt-2 flex flex-col gap-0.5">
        {ask.options.map((option, index) => (
          <ChoiceRow
            key={`${index}-${option.label}`}
            index={index + 1}
            label={option.label}
            description={option.description}
            onPick={() => send(option.label)}
          />
        ))}
        {otherOpen ? (
            <form
              className="flex items-center gap-2 px-2 py-1"
              onSubmit={(event) => { event.preventDefault(); send(other); }}
            >
              <input
                ref={inputRef}
                autoFocus={freeTextOnly}
                value={other}
                onChange={(event) => setOther(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape' && !freeTextOnly) setOtherOpen(false); }}
                placeholder={t('turnAsk.otherPlaceholder')}
                className="h-7 min-w-0 flex-1 rounded-lg bg-[var(--surface-2)] px-2.5 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--border-strong)]"
              />
              <button
                type="submit"
                disabled={!other.trim()}
                aria-label={t('turnAsk.send')}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--text)] text-[var(--panel)] transition hover:opacity-90 disabled:opacity-30"
              >
                <ArrowUp size={14} />
              </button>
            </form>
          ) : canWrite ? (
            <ChoiceRow
              index={ask.options.length + 1}
              label={<span className="text-[var(--text-muted)]">{t('turnAsk.other')}</span>}
              onPick={() => pickByIndex(ask.options.length)}
            />
          ) : null}
      </div>
    </ComposerCard>
  );
}

/**
 * Questions from a local Claude Code or Codex (see LocalAgentTurn in local-agent-run): possibly several at once.
 * One card steps through them and returns all answers after the last. Closing skips them all.
 */
export function LocalAgentQuestionCard({
  questions,
  onDone,
}: {
  questions: LocalAgentQuestion[];
  onDone: (answers: Record<string, LocalAgentAnswer> | null) => void;
}) {
  const [at, setAt] = React.useState(0);
  const answers = React.useRef<Record<string, LocalAgentAnswer>>({});
  const q = questions[at];
  if (!q) return null;
  return (
    <TurnQuestionCard
      key={q.id}
      ask={{ question: q.question, options: q.options }}
      allowOther={q.customId != null}
      onAnswer={(text) => {
        answers.current[q.id] = q.options.some((o) => o.label === text) ? { label: text } : { text };
        if (at + 1 < questions.length) setAt(at + 1);
        else onDone(answers.current);
      }}
      onSkip={() => onDone(null)}
    />
  );
}
