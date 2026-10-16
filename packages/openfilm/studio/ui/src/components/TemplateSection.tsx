/**
 * The inspector's Template section for a page clip: the page's custom properties and its words, changed here without
 * opening the page, as a motion graphics template is filled in (lib/template-controls). Each field paints first and
 * writes when let go, as every inspector field does; each change is an override of the clip, and a field changed from
 * the page's own value can go back to it.
 */
import * as React from 'react';
import { RotateCcw } from 'lucide-react';

import { useT } from '@/i18n';
import type { FilmOverride } from '@/lib/film';
import {
  ROOT, changedText, changedVar, fieldOf, labelOf, valueOf, withText, withVar, type TemplateControls, type VarField,
} from '@/lib/template-controls';
import { ColorField, FIELD, INPUT, NumField, Section, SectionAction } from './inspector-fields';

type T = ReturnType<typeof useT>;

/** What the section needs of the clip: its controls as the page has them, its overrides, and the picture. */
export interface TemplateHost {
  /** Null when the clip is not on the picture now (the page is read where it is drawn). */
  read: () => Promise<TemplateControls | null>;
  overrides: () => readonly FilmOverride[] | undefined;
  /** Paints a change without writing it; null takes it back. */
  preview: (target: { at: string; n?: number }, patch: { style?: Record<string, string>; text?: string } | null) => void;
}

/* a page clip off the picture is read again now and then: the playhead may come to it */
const OFF_PICTURE_EVERY_MS = 1500;

const isNamedColor = (v: string) => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', v);

export function TemplateSection({ host, commit }: {
  host: TemplateHost;
  /** Writes the clip's next overrides (null: none left). */
  commit: (next: FilmOverride[] | null) => void;
}) {
  const t = useT();
  const [controls, setControls] = React.useState<TemplateControls | null | undefined>(undefined);
  const overrides = host.overrides();
  const kept = JSON.stringify(overrides ?? []);
  React.useEffect(() => {
    let live = true;
    let timer = 0;
    const read = () => {
      void host.read().catch(() => null).then((next) => {
        if (!live) return;
        setControls((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        if (!next) timer = window.setTimeout(read, OFF_PICTURE_EVERY_MS);
      });
    };
    /* the picture shows a written change a moment after it is kept */
    timer = window.setTimeout(read, 120);
    return () => { live = false; window.clearTimeout(timer); };
  }, [host, kept]);

  if (controls === undefined) return null;
  if (controls && !controls.vars.length && !controls.texts.length) return null;
  const setVar = (name: string, value: string | null) => commit(withVar(overrides, name, value));
  const setText = (at: string, n: number | undefined, value: string | null) => commit(withText(overrides, at, n, value));

  return (
    <Section id="template" title={t('inspector.template')}>
      {!controls ? (
        <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{t('inspector.templateOffPicture')}</p>
      ) : (
        <>
          {controls.vars.map(({ name, value }) => (
            <Line key={name} label={labelOf(name)} title={name} changed={changedVar(overrides, name) != null} onReset={() => setVar(name, null)} t={t}>
              <VarInput
                name={name}
                field={fieldOf(value, isNamedColor)}
                onCommit={(next) => setVar(name, next)}
                onPreview={(next) => host.preview({ at: ROOT }, next == null ? null : { style: { [name]: next } })}
              />
            </Line>
          ))}
          {controls.texts.map(({ at, n, label, value }, i) => (
            <Line
              key={`${at}#${n ?? 0}`}
              label={label || `${t('inspector.templateText')} ${i + 1}`}
              title={n ? `${at} (${n})` : at}
              changed={changedText(overrides, at, n) != null}
              onReset={() => setText(at, n, null)}
              t={t}
              wide
            >
              <WordsInput
                value={value}
                label={label || `${t('inspector.templateText')} ${i + 1}`}
                onCommit={(next) => setText(at, n, next)}
                onPreview={(next) => host.preview({ at, ...(n ? { n } : {}) }, next == null ? null : { text: next })}
              />
            </Line>
          ))}
        </>
      )}
    </Section>
  );
}

/** A control: its name on the left (words above their box), its field, and going back to the page's own value. */
function Line({ label, title, changed, onReset, wide = false, t, children }: {
  label: string; title: string; changed: boolean; onReset: () => void; wide?: boolean; t: T; children: React.ReactNode;
}) {
  const reset = changed ? (
    <SectionAction label={t('inspector.templateReset')} onClick={onReset}><RotateCcw size={11} /></SectionAction>
  ) : <span className="w-5" />;
  const name = (
    <span className="min-w-0 truncate text-[11px] text-[var(--text-muted)]" title={title}>
      {changed ? <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)] align-middle" /> : null}
      {label}
    </span>
  );
  if (wide) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex h-5 items-center justify-between gap-2">{name}{reset}</div>
        {children}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_20px] items-center gap-1.5">
      {name}
      <div className="min-w-0">{children}</div>
      {reset}
    </div>
  );
}

/** A custom property's field by its kind: a color, a number with its unit, or words. */
function VarInput({ name, field, onCommit, onPreview }: {
  name: string;
  field: VarField;
  onCommit: (value: string) => void;
  onPreview: (value: string | null) => void;
}) {
  const label = labelOf(name);
  if (field.kind === 'color') {
    return <ColorField label={label} value={field.value} onCommit={onCommit} onPreview={onPreview} />;
  }
  if (field.kind === 'number') {
    const step = Number.isInteger(field.value) && Math.abs(field.value) >= 2 ? 1 : 0.1;
    return (
      <NumField
        label={label}
        bare
        value={field.value}
        step={step}
        {...(field.unit ? { unit: field.unit } : {})}
        onCommit={(n) => onCommit(valueOf({ ...field, value: n }))}
        onPreview={(n) => onPreview(valueOf({ ...field, value: n }))}
        onRevert={() => onPreview(null)}
      />
    );
  }
  return (
    <TypedInput
      label={label}
      value={field.value}
      onCommit={(v) => onCommit(valueOf({ ...field, value: v }))}
    />
  );
}

/** One line typed and kept when left or on Enter; Esc gives up. */
function TypedInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [raw, setRaw] = React.useState(value);
  React.useEffect(() => setRaw(value), [value]);
  const cancelled = React.useRef(false);
  return (
    <div className={FIELD}>
      <input
        aria-label={label}
        value={raw}
        spellCheck={false}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          if (cancelled.current) { cancelled.current = false; return; }
          if (raw.trim() && raw !== value) onCommit(raw);
          else setRaw(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { cancelled.current = true; setRaw(value); (e.target as HTMLInputElement).blur(); }
        }}
        className={`${INPUT} pl-2`}
      />
    </div>
  );
}

/** A layer's words: the picture follows as they are typed, kept when left or on Enter (Shift+Enter: a new line). */
function WordsInput({ label, value, onCommit, onPreview }: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  onPreview: (value: string | null) => void;
}) {
  const [raw, setRaw] = React.useState(value);
  const typing = React.useRef(false);
  React.useEffect(() => { if (!typing.current) setRaw(value); }, [value]);
  const cancelled = React.useRef(false);
  return (
    <textarea
      aria-label={label}
      value={raw}
      rows={Math.min(4, Math.max(1, raw.split('\n').length))}
      onChange={(e) => { typing.current = true; setRaw(e.target.value); onPreview(e.target.value); }}
      onBlur={() => {
        typing.current = false;
        if (cancelled.current) { cancelled.current = false; return; }
        if (raw !== value) onCommit(raw);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
        if (e.key === 'Escape') {
          cancelled.current = true;
          typing.current = false;
          setRaw(value);
          onPreview(null);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className="w-full resize-none rounded-[5px] bg-[var(--fill-tsp)] px-2 py-1 text-[11.5px] leading-[1.5] text-[var(--text)] outline-none ring-1 ring-inset ring-transparent transition hover:ring-[var(--border)] focus:bg-[var(--bg)] focus:ring-[1.5px] focus:ring-[var(--accent)]"
    />
  );
}
