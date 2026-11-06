/**
 * A text node's words as written: plain text with Markdown's marks (headings, lists, quotes, code, bold, italic, a
 * rule), drawn as they read, and the bar over the node while it is written in that puts them in.
 */
import React from 'react';
import { Bold, ChevronDown, Italic, List, Maximize2, Minus, Type as TypeIcon } from 'lucide-react';
import { useT } from '@/i18n';

/**
 * Words written in a box whose words the board holds. The board's copy reaches the box a render late, so a box drawn
 * from it is put back to what it was before each key — which ends what an input method is composing and leaves its
 * letters behind (shuang, not 双). The box keeps its own words instead, sent to the board as they change, and takes the
 * board's only while it is not written in (an agent's words, an undo). `set` changes them from outside the box (the bar
 * over a note).
 */
export function useDraft(value: string, send: (text: string) => void) {
  const [draft, setDraft] = React.useState(value);
  const writing = React.useRef(false);
  React.useEffect(() => { if (!writing.current) setDraft(value); }, [value]);
  const set = (text: string) => { setDraft(text); send(text); };
  return {
    set,
    props: {
      value: draft,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => set(event.target.value),
      onFocusCapture: () => { writing.current = true; },
      onBlurCapture: () => { writing.current = false; },
    },
  };
}

/** A line's inline marks drawn: `**bold**`, `*italic*` (or `_italic_`), `` `code` ``, `~~struck~~`, `[a link](…)` as its words. */
function inline(line: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)]*\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const bit = m[0];
    const k = `${key}-${i++}`;
    if (bit.startsWith('**') || bit.startsWith('__')) out.push(<strong key={k} className="font-semibold">{inline(bit.slice(2, -2), k)}</strong>);
    else if (bit.startsWith('`')) out.push(<code key={k} className="rounded-[4px] bg-[var(--cv-chip)] px-1 py-px font-mono text-[0.9em]">{bit.slice(1, -1)}</code>);
    else if (bit.startsWith('~~')) out.push(<s key={k} className="text-[var(--cv-ink-2)]">{inline(bit.slice(2, -2), k)}</s>);
    else if (bit.startsWith('[')) out.push(<span key={k} className="underline decoration-[var(--cv-ink-3)] underline-offset-2">{bit.slice(1, bit.indexOf(']('))}</span>);
    else out.push(<em key={k}>{inline(bit.slice(1, -1), k)}</em>);
    last = m.index + bit.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

const HEAD_SIZE = ['text-[20px]', 'text-[17px]', 'text-[15px]'] as const;

/**
 * A note's words drawn as Markdown reads: headings, lists (bulleted, numbered, to-do), quotes, code, rules, and the
 * inline marks. The words themselves stay plain text, as they are kept and as an agent reads and writes them.
 */
export function Words({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!;
    /* a fenced block of code, as it is */
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      let end = n + 1;
      while (end < lines.length && !/^\s*```/.test(lines[end]!)) body.push(lines[end++]!);
      out.push(<pre key={n} className="my-1 overflow-hidden whitespace-pre-wrap rounded-[8px] bg-[var(--cv-chip)] px-3 py-2 font-mono text-[12.5px] leading-[1.55]">{body.join('\n')}</pre>);
      n = end;
      continue;
    }
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      out.push(<div key={n} className={`${HEAD_SIZE[Math.min(head[1]!.length, 3) - 1]} mb-0.5 mt-1 font-semibold leading-snug first:mt-0`}>{inline(head[2]!, String(n))}</div>);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push(<hr key={n} className="my-2 border-0 border-t border-[var(--cv-line)]" />); continue; }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { out.push(<div key={n} className="border-l-2 border-[var(--cv-line)] pl-3 text-[var(--cv-ink-2)]">{inline(quote[1]!, String(n))}</div>); continue; }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (item) {
      const depth = Math.min(4, Math.floor(item[1]!.replace(/\t/g, '  ').length / 2));
      const task = item[3] ? /\[[xX]\]/.test(item[3]) : null;
      const mark = task !== null
        ? <span className={`mt-[0.35em] flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border ${task ? 'border-[var(--cv-ink-2)] bg-[var(--cv-ink-2)] text-[var(--cv-bg)]' : 'border-[var(--cv-ink-3)]'}`}>{task ? <span className="text-[9px] leading-none">✓</span> : null}</span>
        : /\d/.test(item[2]!) ? <span className="shrink-0 tabular-nums text-[var(--cv-ink-2)]">{item[2]!.replace(')', '.')}</span>
          : <span className="mt-[0.62em] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--cv-ink-2)]" />;
      out.push(
        <div key={n} className={`flex gap-2 ${task ? 'text-[var(--cv-ink-3)] line-through' : ''}`} style={{ paddingLeft: depth * 16 }}>
          {mark}<span className="min-w-0 flex-1">{inline(item[4]!, String(n))}</span>
        </div>,
      );
      continue;
    }
    out.push(<div key={n} className="min-h-[1.65em] whitespace-pre-wrap">{inline(line, String(n))}</div>);
  }
  return <>{out}</>;
}

/** The bar over a note being written in: its line a heading or body text, bold, italic, a rule, and the node larger. */
export function WritingBar({ area, onChange, onLarger }: {
  area: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (text: string) => void;
  onLarger: () => void;
}) {
  const t = useT();
  const [levels, setLevels] = React.useState(false);
  /* what is written changed as a person would: the selection kept where the words went */
  const edit = (change: (text: string, from: number, to: number) => { text: string; from: number; to: number }) => {
    const el = area.current;
    if (!el) return;
    const next = change(el.value, el.selectionStart, el.selectionEnd);
    onChange(next.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.from, next.to); });
  };
  const wrap = (mark: string) => edit((text, from, to) => ({ text: text.slice(0, from) + mark + text.slice(from, to) + mark + text.slice(to), from: from + mark.length, to: to + mark.length }));
  const level = (n: 0 | 1 | 2 | 3) => edit((text, from, to) => {
    const start = text.lastIndexOf('\n', from - 1) + 1;
    const rest = text.slice(start).replace(/^#{1,3}\s+/, '');
    const head = n ? `${'#'.repeat(n)} ` : '';
    const shift = head.length - (text.length - start - rest.length);
    return { text: text.slice(0, start) + head + rest, from: Math.max(start, from + shift), to: Math.max(start, to + shift) };
  });
  /* the lines picked (or the one the caret is on) a bulleted list, or plain lines again when they all are one */
  const list = () => edit((text, from, to) => {
    const start = text.lastIndexOf('\n', from - 1) + 1;
    const stop = text.indexOf('\n', to) === -1 ? text.length : text.indexOf('\n', to);
    const lines = text.slice(start, stop).split('\n');
    const all = lines.every((l) => /^\s*[-*+]\s/.test(l));
    const next = lines.map((l) => (all ? l.replace(/^(\s*)[-*+]\s/, '$1') : /^\s*[-*+]\s/.test(l) ? l : `- ${l}`)).join('\n');
    const end = start + next.length;
    return { text: text.slice(0, start) + next + text.slice(stop), from: end, to: end };
  });
  const btn = 'flex h-7 min-w-7 items-center justify-center gap-1 rounded-[6px] px-1.5 text-[12.5px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
  /* pressed without taking the focus from the words */
  const keep = (event: React.MouseEvent) => event.preventDefault();
  return (
    <div className="nodrag nopan flex items-center gap-0.5 rounded-[10px] bg-[var(--cv-float)] p-1 shadow-[var(--cv-float-shadow)]" onMouseDown={keep}>
      <span className="relative">
        <button type="button" className={btn} onClick={() => setLevels((v) => !v)}><TypeIcon size={13} />{t('canvas.words.body')}<ChevronDown size={11} /></button>
        {levels ? (
          <span className="absolute left-0 top-9 z-10 flex w-[120px] flex-col rounded-[10px] bg-[var(--cv-float)] p-1 shadow-[var(--cv-float-shadow)]">
            {([0, 1, 2, 3] as const).map((n) => (
              <button key={n} type="button" className={`${btn} !justify-start`} onClick={() => { level(n); setLevels(false); }}>
                {n ? t('canvas.words.heading').replace('{n}', String(n)) : t('canvas.words.body')}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      <span className="mx-0.5 h-4 w-px bg-[var(--cv-float-line)]" />
      <button type="button" aria-label={t('canvas.words.bold')} title={t('canvas.words.bold')} className={btn} onClick={() => wrap('**')}><Bold size={14} /></button>
      <button type="button" aria-label={t('canvas.words.italic')} title={t('canvas.words.italic')} className={btn} onClick={() => wrap('*')}><Italic size={14} /></button>
      <button type="button" aria-label={t('canvas.words.list')} title={t('canvas.words.list')} className={btn} onClick={list}><List size={14} /></button>
      <button type="button" aria-label={t('canvas.words.rule')} title={t('canvas.words.rule')} className={btn}
        onClick={() => edit((text, from) => { const add = `${from && text[from - 1] !== '\n' ? '\n' : ''}---\n`; return { text: text.slice(0, from) + add + text.slice(from), from: from + add.length, to: from + add.length }; })}>
        <Minus size={14} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-[var(--cv-float-line)]" />
      <button type="button" aria-label={t('canvas.words.larger')} title={t('canvas.words.larger')} className={btn} onClick={onLarger}><Maximize2 size={13} /></button>
    </div>
  );
}
