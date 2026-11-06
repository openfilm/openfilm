/**
 * A text node's words as written: Markdown's few marks a note needs (a heading, bold, italic, a rule), drawn as they
 * read, and the bar over the node while it is written in that puts them in, as the node canvases people know do.
 */
import React from 'react';
import { Bold, ChevronDown, Italic, Maximize2, Minus, Type as TypeIcon } from 'lucide-react';
import { useT } from '@/i18n';

/** `**bold**` and `*italic*` in a line, drawn. */
function inline(line: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const bit = m[0];
    out.push(bit.startsWith('**') ? <strong key={`${key}-${i++}`}>{bit.slice(2, -2)}</strong> : <em key={`${key}-${i++}`}>{bit.slice(1, -1)}</em>);
    last = m.index + bit.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** A note's words drawn: its headings larger, its rules as lines, its bold and italic. */
export function Words({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, n) => {
        const head = /^(#{1,3})\s+(.*)$/.exec(line);
        if (head) {
          const size = head[1]!.length === 1 ? 'text-[20px]' : head[1]!.length === 2 ? 'text-[17px]' : 'text-[15px]';
          return <div key={n} className={`${size} font-semibold leading-snug`}>{inline(head[2]!, String(n))}</div>;
        }
        if (/^-{3,}\s*$/.test(line)) return <hr key={n} className="my-2 border-0 border-t border-[var(--cv-line)]" />;
        return <div key={n} className="min-h-[1.65em]">{inline(line, String(n))}</div>;
      })}
    </>
  );
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
      <button type="button" aria-label={t('canvas.words.rule')} title={t('canvas.words.rule')} className={btn}
        onClick={() => edit((text, from) => { const add = `${from && text[from - 1] !== '\n' ? '\n' : ''}---\n`; return { text: text.slice(0, from) + add + text.slice(from), from: from + add.length, to: from + add.length }; })}>
        <Minus size={14} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-[var(--cv-float-line)]" />
      <button type="button" aria-label={t('canvas.words.larger')} title={t('canvas.words.larger')} className={btn} onClick={onLarger}><Maximize2 size={13} /></button>
    </div>
  );
}
