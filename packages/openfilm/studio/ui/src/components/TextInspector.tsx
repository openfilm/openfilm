/**
 * The inspector of a line of words made with the library's text component (lib/text-look): three categories of its
 * own. Text: its words, font, size, weight, color, edge, box, alignment and spacing. Word art: the library's looks,
 * one click each (the one it has lit). Motion: how it comes in, moves while shown and goes out, each with its time.
 * Every field paints the picture while dragged or picked and writes when let go, as the inspector's fields do.
 */
import * as React from 'react';
import { Ban } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { joinFontFamily, splitFontFamily } from '@/lib/font-styles';
import { nameOf, posterUrl, previewUrl, useLibraryIndex, type LibraryItem } from '@/lib/library';
import {
  LOOK_VARS, MOTION_VARS, TEXT_DEFAULTS, WORDS_AT, currentOf, textVars, textWords, withLook, withMotion, withVars, withWords,
  type MotionSlot,
} from '@/lib/text-look';
import { ColorField, NumField, Row, Section, Segmented, SelectField } from './inspector-fields';
import { FontFamilyPicker } from './FontFamilyPicker';
import type { PropsHost } from './PropertiesSection';

type Overrides = Record<string, unknown>[];
const ROOT = { at: ':root' };
const num = (v: string | undefined) => { const n = Number.parseFloat(v ?? ''); return Number.isFinite(n) ? n : undefined; };
const MOTION_SLOTS: MotionSlot[] = ['in', 'loop', 'out'];

export function TextInspector({ host, commit }: { host: PropsHost; commit: (next: Overrides) => void }) {
  const t = useT();
  const lang = useLanguage();
  const index = useLibraryIndex();
  /* what the clip has now: read again after each write (the host's overrides are the film's) */
  const [rev, setRev] = React.useState(0);
  const overrides = React.useMemo(() => (host.overrides() ?? []) as unknown as Overrides, [host, rev]);
  const vars = textVars(overrides);
  const words = textWords(overrides) ?? '';
  const write = (next: Overrides) => { host.preview(ROOT, null); commit(next); setRev((r) => r + 1); };
  const setVar = (key: string, value: string) => write(withVars(overrides, { [key]: value }));
  const paint = (key: string, value: string) => host.preview(ROOT, { style: { [key]: value } });
  const revert = () => host.preview(ROOT, null);

  const looks = (index?.items ?? []).filter((i) => i.kind === 'textstyle' && i.group === 'wordart');
  const motions = (slot: MotionSlot) => (index?.items ?? []).filter((i) => i.kind === 'textmotion' && i.group === slot);
  const look = currentOf(vars, looks, LOOK_VARS);
  const family = splitFontFamily(vars['--font'] ?? '')[0];
  /* a font picked keeps the page's fallbacks after it */
  const withFont = (f: string) => joinFontFamily(f, splitFontFamily(TEXT_DEFAULTS['--font']!)[1]);

  return (
    <>
      <Section id="text" title={t('textInspector.text')}>
        <textarea
          key={words}
          defaultValue={words}
          placeholder={t('textInspector.wordsHint')}
          rows={2}
          onBlur={(e) => { if (e.target.value !== words) write(withWords(overrides, e.target.value)); }}
          onFocus={() => host.point?.({ at: WORDS_AT })}
          className="w-full resize-none rounded-[5px] bg-[var(--fill-tsp)] px-2 py-1.5 text-[12px] leading-[1.5] text-[var(--text)] outline-none ring-1 ring-inset ring-transparent focus:ring-[var(--tl-accent)]"
        />
        <Line label={t('textInspector.font')}>
          <FontFamilyPicker
            label={t('textInspector.font')}
            value={family}
            sample={words || 'Aa'}
            onPreview={(f) => paint('--font', withFont(f))}
            onRevert={revert}
            onCommit={(f) => setVar('--font', withFont(f))}
            className="w-full"
          />
        </Line>
        <Line label={t('textInspector.size')}>
          <Row>
            {/* of the clip's box: how tall the words are in it (they never spill out of it) */}
            <NumField label={t('textInspector.size')} value={num(vars['--size'])} unit="%" step={1} min={5} max={100}
              onPreview={(n) => paint('--size', `${n}vh`)} onRevert={revert} onCommit={(n) => setVar('--size', `${n}vh`)} />
            <SelectField label={t('textInspector.weight')} value={vars['--weight'] ?? '800'}
              options={['200', '300', '400', '500', '600', '700', '800', '900'].map((w) => ({ value: w, label: w }))}
              onPreview={(w) => paint('--weight', w)} onRevert={revert} onCommit={(w) => setVar('--weight', w)} />
          </Row>
        </Line>
        <Line label={t('textInspector.color')}>
          <ColorField label={t('textInspector.color')} value={vars['--fill'] && vars['--fill'] !== 'none' ? 'transparent' : vars['--color']!}
            onPreview={(c) => paint('--color', c)} onCommit={(c) => write(withVars(overrides, { '--color': c }, ['--fill']))} />
        </Line>
        <Line label={t('textInspector.edge')}>
          <Row>
            <NumField label={t('textInspector.edge')} value={num(vars['--stroke'])} unit="em" step={0.01} min={0} max={0.4}
              onPreview={(n) => paint('--stroke', `${n}em`)} onRevert={revert} onCommit={(n) => setVar('--stroke', `${n}em`)} />
            <ColorField label={t('textInspector.edgeColor')} value={vars['--stroke-color']!}
              onPreview={(c) => paint('--stroke-color', c)} onCommit={(c) => setVar('--stroke-color', c)} />
          </Row>
        </Line>
        <Line label={t('textInspector.box')}>
          <ColorField label={t('textInspector.box')} value={vars['--box']!}
            onPreview={(c) => paint('--box', c)}
            onCommit={(c) => write(withVars(overrides, { '--box': c, ...(num(vars['--box-pad']) ? {} : { '--box-pad': '0.25em 0.55em', '--box-radius': '0.18em' }) }))} />
        </Line>
        <Line label={t('textInspector.align')}>
          <Segmented label={t('textInspector.align')} value={vars['--align']!} small
            options={[{ value: 'left', label: t('textInspector.left') }, { value: 'center', label: t('textInspector.center') }, { value: 'right', label: t('textInspector.right') }]}
            onChange={(a) => setVar('--align', a)} />
        </Line>
        <Line label={t('textInspector.spacing')}>
          <NumField label={t('textInspector.spacing')} value={num(vars['--spacing'])} unit="em" step={0.01} min={-0.1} max={1}
            onPreview={(n) => paint('--spacing', `${n}em`)} onRevert={revert} onCommit={(n) => setVar('--spacing', `${n}em`)} />
        </Line>
      </Section>

      <Section id="wordart" title={t('textInspector.wordart')}>
        <Tiles
          items={looks}
          on={look?.id ?? (LOOK_VARS.every((k) => vars[k] === TEXT_DEFAULTS[k]) ? '' : null)}
          none={t('textInspector.none')}
          lang={lang}
          onPick={(item) => write(withLook(overrides, item?.vars ?? {}))}
        />
      </Section>

      <Section id="motion" title={t('textInspector.motion')}>
        {MOTION_SLOTS.map((slot) => {
          const [nameKey, timeKey] = MOTION_VARS[slot];
          const items = motions(slot).filter((i) => i.vars?.[nameKey] !== 'none');
          const now = vars[nameKey];
          return (
            <div key={slot} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[var(--text-muted)]">{t(`textInspector.${slot}`)}</span>
                {now !== 'none' && slot !== 'loop' ? (
                  <div className="w-[96px]">
                    <NumField label={t('textInspector.time')} value={num(vars[timeKey])} unit="s" step={0.1} min={0.1} max={5}
                      onCommit={(n) => setVar(timeKey, `${n}s`)} />
                  </div>
                ) : null}
              </div>
              <Tiles
                items={items}
                on={now === 'none' ? '' : items.find((i) => i.vars?.[nameKey] === now)?.id ?? null}
                none={t('textInspector.none')}
                lang={lang}
                small
                onPick={(item) => write(withMotion(overrides, slot, item?.vars ?? { [nameKey]: 'none' }))}
              />
            </div>
          );
        })}
      </Section>
    </>
  );
}

/** A field with its name before it, as the inspector's other rows are. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-[11px] text-[var(--text-muted)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A grid of the library's looks or motions, by their posters (playing under the pointer): the one on lit, "none" first. */
function Tiles({ items, on, none, lang, small, onPick }: {
  items: LibraryItem[]; on: string | null; none: string; lang: ReturnType<typeof useLanguage>; small?: boolean;
  onPick: (item: LibraryItem | null) => void;
}) {
  const [hover, setHover] = React.useState<string | null>(null);
  const ring = (lit: boolean) => (lit ? 'ring-2 ring-[var(--tl-accent)]' : 'ring-1 ring-[var(--border)] hover:ring-[var(--text-faint)]');
  const label = (lit: boolean) => `mt-1 truncate text-center text-[10.5px] ${lit ? 'font-medium text-[var(--tl-accent)]' : 'text-[var(--text-muted)]'}`;
  return (
    <div className={`grid gap-1.5 ${small ? 'grid-cols-4' : 'grid-cols-3'}`}>
      <button type="button" onClick={() => onPick(null)} className="min-w-0 text-left">
        <span className={`grid aspect-video place-items-center rounded-[5px] bg-[var(--fill-tsp)] text-[var(--text-faint)] ${ring(on === '')}`}><Ban size={14} /></span>
        <span className={`block ${label(on === '')}`}>{none}</span>
      </button>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onPick(item)} title={nameOf(item.name, lang)} className="min-w-0 text-left"
          onMouseEnter={() => setHover(item.id)} onMouseLeave={() => setHover(null)}>
          <span className={`relative block aspect-video overflow-hidden rounded-[5px] ${ring(on === item.id)}`}>
            <img src={posterUrl(item)} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
            {hover === item.id ? <video src={previewUrl(item)} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
          </span>
          <span className={`block ${label(on === item.id)}`}>{nameOf(item.name, lang)}</span>
        </button>
      ))}
    </div>
  );
}
