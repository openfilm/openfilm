/**
 * A caption track's words, in the caption inspector. Transcript: the track's words as text to cut the film by, as a
 * talk is cut (lib/transcript-cut): words picked by a press and a drag (⇧ a press further on: as far as there) and
 * Delete cuts the film's time they take, picture and sound with it, everything after closed up; a press on a word
 * goes to it. Word effects: how the words come as they are said (lib/word-effects), each tile playing its effect under
 * the pointer; a track whose words have no times of their own can have them timed by their length.
 */
import React from 'react';
import { Loader2, Trash2, Wand2 } from 'lucide-react';
import { cuePlain, timedText } from '../../../../src/captions.mjs';
import { useT } from '@/i18n';
import type { Vtt } from '@/lib/caption-edits';
import { cutOfWords, transcriptWords } from '@/lib/transcript-cut';
import { WORD_COLOR, WORD_EFFECTS, wordEffectOf, withWordColor, withWordEffect, type WordEffect } from '@/lib/word-effects';
import { ColorField } from './inspector-fields';

type Cut = (ranges: readonly { startMs: number; endMs: number }[]) => Promise<string | null>;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
/* a cue after one this long a silence starts a paragraph of its own */
const PARAGRAPH_GAP_S = 1.5;

/** The track's words to cut the film by. */
export function Transcript({ vtt, timeMs, onSeek, onCut, onDone }: {
  vtt: Vtt; timeMs: number; onSeek: (ms: number) => void; onCut: Cut; onDone: () => void;
}) {
  const t = useT();
  const words = React.useMemo(() => transcriptWords(vtt), [vtt]);
  const [picked, setPicked] = React.useState<ReadonlySet<number>>(() => new Set());
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const box = React.useRef<HTMLDivElement | null>(null);
  const anchor = React.useRef<number | null>(null);
  const press = React.useRef<{ at: number; moved: boolean } | null>(null);
  /* the words change once cut (or edited): what was picked is gone */
  React.useEffect(() => { setPicked(new Set()); anchor.current = null; }, [vtt]);
  React.useEffect(() => {
    const up = () => {
      const p = press.current;
      press.current = null;
      if (p && !p.moved) onSeek(Math.round((words[p.at]?.start ?? 0) * 1000));
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [words, onSeek]);
  const span = (a: number, b: number) => new Set(Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => Math.min(a, b) + k));
  const ranges = cutOfWords(words, picked);
  const seconds = ranges.reduce((n, r) => n + (r.endMs - r.startMs), 0) / 1000;
  const cut = async () => {
    if (!ranges.length || busy) return;
    setBusy(true);
    setProblem(null);
    const why = await onCut(ranges);
    setBusy(false);
    if (why) setProblem(why); else setPicked(new Set());
  };
  /* paragraphs: a cue after a long silence starts one */
  const paragraphs: number[][] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (!prev || (prev.cue !== w.cue && w.start - prev.end > PARAGRAPH_GAP_S)) paragraphs.push([]);
    paragraphs.at(-1)!.push(i);
  });
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-start gap-2 rounded-[6px] bg-[var(--bg-field)] px-2.5 py-2">
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{t('captionTrack.transcriptHint')}</p>
        <button type="button" data-transcript-done="" onClick={onDone} className="shrink-0 text-[11.5px] font-medium text-[var(--accent)] hover:underline">{t('captionTrack.transcriptDone')}</button>
      </div>
      <div ref={box} tabIndex={0} data-transcript="" role="listbox" aria-multiselectable="true" aria-label={t('captionTrack.cutMode')}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && picked.size) { e.preventDefault(); e.stopPropagation(); void cut(); }
          if (e.key === 'Escape' && picked.size) { e.stopPropagation(); setPicked(new Set()); }
        }}
        className="flex select-none flex-col gap-3 rounded-[6px] px-1 py-1 text-[13px] leading-[1.9] text-[var(--text)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]">
        {paragraphs.map((list) => (
          <p key={list[0]}>
            {list.map((i) => {
              const w = words[i]!;
              const prev = words[i - 1];
              /* two cues of words written with spaces: a space between them */
              const gap = prev && prev.cue !== w.cue && !/\s$/.test(prev.text) && !CJK.test(prev.text.slice(-1)) && !CJK.test(w.text[0] ?? '') ? ' ' : '';
              const on = picked.has(i);
              const now = w.start * 1000 <= timeMs && timeMs < w.end * 1000;
              return (
                <React.Fragment key={i}>
                  {gap}
                  <span role="option" aria-selected={on} data-word={i}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      box.current?.focus();
                      if (e.shiftKey && anchor.current != null) setPicked(span(anchor.current, i));
                      else { anchor.current = i; setPicked(new Set([i])); }
                      press.current = { at: i, moved: e.shiftKey };
                    }}
                    onPointerEnter={() => { if (press.current && anchor.current != null) { press.current.moved = true; setPicked(span(anchor.current, i)); } }}
                    className={`cursor-text rounded-[3px] ${on ? 'bg-[color-mix(in_srgb,var(--accent)_32%,transparent)] text-[var(--text)]' : now ? 'text-[var(--accent)]' : 'hover:bg-[var(--bg-hover)]'}`}>
                    {w.text}
                  </span>
                </React.Fragment>
              );
            })}
          </p>
        ))}
      </div>
      {problem ? <p role="alert" className="text-[11px] text-[var(--err)]">{problem}</p> : null}
      <div className="sticky bottom-0 -mx-3 flex items-center gap-2 border-t border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2">
        <span data-transcript-picked="" className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-[var(--text-muted)]">
          {ranges.length ? t('captionTrack.transcriptPicked').replace('{n}', String(ranges.length)).replace('{s}', seconds.toFixed(1)) : t('captionTrack.transcriptNone')}
        </span>
        <button type="button" data-transcript-cut="" disabled={!ranges.length || busy} onClick={() => void cut()}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--primary)] px-2.5 text-[11.5px] font-medium text-[var(--on-primary)] hover:bg-[var(--primary-hover)]">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}{t('captionTrack.transcriptCut')}
        </button>
      </div>
    </div>
  );
}

/* the effects as the tiles play them: each effect's CSS on its tile's words */
const decls = (o: Record<string, string> | undefined) => Object.entries(o ?? {}).map(([k, v]) => `${k}: ${v};`).join(' ');
const DEMO_CSS = WORD_EFFECTS.map((e) => [
  `[data-wfx="${e.id}"] .past { ${decls(e.past)} }`,
  `[data-wfx="${e.id}"] .future { ${decls(e.future)} }`,
  e.frames ? `@keyframes wfx-${e.id} { ${e.frames} }` : '',
].join('\n')).join('\n');

/** How the track's words come as they are said: a tile for each effect, the color it lights with. */
export function WordEffects({ vtt, onWrite }: { vtt: Vtt; onWrite: (next: Vtt, step?: string) => void }) {
  const t = useT();
  const timed = vtt.cues.some((c) => /<\d+:\d{2}/.test(c.text));
  const { id, color } = wordEffectOf(vtt);
  const fx = WORD_EFFECTS.find((e) => e.id === id);
  const sample = t('captionTrack.wordFxSample');
  const units = sample.match(CJK.test(sample) ? /./gu : /\S+\s*/g) ?? [sample];
  return (
    <section data-word-effects="" className="flex flex-col gap-2">
      <style>{DEMO_CSS}</style>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-[var(--text)]">{t('captionTrack.wordFx')}</span>
        <span className="truncate text-[10.5px] text-[var(--text-faint)]">{t('captionTrack.wordFxTrack')}</span>
      </div>
      {!timed ? (
        <div className="flex items-center gap-2 rounded-[6px] bg-[var(--bg-field)] px-2.5 py-2">
          <p className="min-w-0 flex-1 text-[10.5px] leading-snug text-[var(--text-muted)]">{t('captionTrack.wordsUntimed')}</p>
          <button type="button" data-word-time="" onClick={() => onWrite({ ...vtt, cues: vtt.cues.map((c) => ({ ...c, text: timedText(cuePlain(c.text), c.start, c.end) })) }, 'captionTrack.stepWordTimes')}
            className="flex shrink-0 items-center gap-1 rounded-[5px] bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--border)] hover:bg-[var(--bg-hover)]">
            <Wand2 size={12} />{t('captionTrack.wordTimeGo')}
          </button>
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-1.5">
        {WORD_EFFECTS.map((e) => (
          <Tile key={e.id} fx={e} units={units} on={id === e.id} label={t(`captionTrack.wordFx_${e.id}`)} color={color}
            onPick={() => onWrite(withWordEffect(vtt, e.id, color))} />
        ))}
      </div>
      {fx?.color ? (
        <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
          <span className="text-[11px] text-[var(--text-muted)]">{t('captionTrack.wordFxColor')}</span>
          <ColorField label={t('captionTrack.wordFxColor')} value={color} onCommit={(c) => onWrite(withWordColor(vtt, c))} />
        </div>
      ) : null}
    </section>
  );
}

/** One effect: its words said one after another while the pointer is on it, all said otherwise. */
function Tile({ fx, units, on, label, color, onPick }: { fx: WordEffect; units: string[]; on: boolean; label: string; color: string; onPick: () => void }) {
  const [step, setStep] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (step == null) return undefined;
    const id = window.setTimeout(() => setStep((s) => (s == null ? null : s >= units.length + 4 ? 0 : s + 1)), 240);
    return () => window.clearTimeout(id);
  }, [step, units.length]);
  const said = step ?? units.length;
  return (
    <button type="button" data-word-effect={fx.id} aria-pressed={on} onClick={onPick}
      onPointerEnter={() => setStep(0)} onPointerLeave={() => setStep(null)}
      className="group min-w-0 text-left">
      <span data-wfx={fx.id} style={{ '--wfx-color': color || WORD_COLOR } as React.CSSProperties}
        className={`grid h-11 place-items-center overflow-hidden rounded-[6px] bg-[#2b2b30] px-1 text-[12.5px] font-semibold text-white ${on ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-transparent group-hover:ring-[var(--text-faint)]'}`}>
        <span className="whitespace-nowrap">
          {units.map((u, i) => <span key={`${i}:${step == null ? 's' : 'p'}:${i < said}`} className={i < said ? 'past' : 'future'}>{u}</span>)}
        </span>
      </span>
      <span className={`mt-1 block truncate text-center text-[10.5px] ${on ? 'font-medium text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>{label}</span>
    </button>
  );
}
