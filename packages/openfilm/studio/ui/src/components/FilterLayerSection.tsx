/**
 * A filter of the library on a track of its own (lib/library isFilterLayer): which filter it is and how strongly it
 * grades every layer under it, 0–100. Its strength is the grade's amount in the clip's `backdrop-filter` (lib/grade),
 * painted on the picture while dragged and written when let go.
 */
import { useLanguage, useT } from '@/i18n';
import { gradeFilter, gradeOf } from '@/lib/grade';
import { BUILT_IN, builtInItem, nameOf } from '@/lib/library';
import { Section, SliderField } from './inspector-fields';

const BACKDROP = /(^|;)\s*backdrop-filter\s*:\s*([^;]*)/i;

/** The clip's style with its backdrop-filter set to `value`. */
export function withBackdrop(css: string, value: string): string {
  const rest = css.replace(BACKDROP, '$1').split(';').map((s) => s.trim()).filter(Boolean);
  return [`backdrop-filter: ${value}`, ...rest].join('; ');
}

export function FilterLayerSection({ css, onPreview, onCommit }: {
  /** the clip's style as written */
  css: string;
  /** a style shown on the picture for now (null: as written) */
  onPreview: (css: string | null) => void;
  onCommit: (css: string) => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const graded = gradeOf(BACKDROP.exec(css)?.[2]?.trim());
  const item = graded ? builtInItem(`${BUILT_IN}/${graded.id}`) : null;
  const at = (n: number) => (item?.grade && graded ? withBackdrop(css, gradeFilter(graded.id, item.grade, n / 100)) : null);
  return (
    <Section id="filter" title={item ? nameOf(item.name, lang) : t('filterLayer.title')}>
      <p className="text-[11px] leading-[1.5] text-[var(--text-muted)]">{t('filterLayer.hint')}</p>
      <SliderField
        label={t('filterLayer.strength')}
        value={graded ? Math.round(graded.amount * 100) : undefined}
        min={0}
        max={100}
        neutral={100}
        unit="%"
        disabled={!item?.grade}
        onPreview={(n) => onPreview(at(n))}
        onRevert={() => onPreview(null)}
        onCommit={(n) => { const next = at(n); if (next) onCommit(next); }}
      />
    </Section>
  );
}
