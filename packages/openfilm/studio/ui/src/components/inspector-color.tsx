/**
 * A video clip's color in the inspector: white balance, light and color as seven sliders, and the library's filter it
 * wears with its strength. Both are files of the project (lib/clip-color): the sliders the clip's own layer, the filter
 * a file made for the screen at the end of its chain; so the film plays and exports them at the footage's own depth,
 * the color workbench and an agent see them, and an agent's change shows here at once. Dragging shows the grade on the
 * picture as it goes; letting go writes it, one step of the undo. Several clips picked: each slider moves each clip's
 * own from where it is.
 */
import * as React from 'react';
import { Minus, RotateCcw } from 'lucide-react';
import { useLanguage, type useT } from '@/i18n';
import {
  ADJUST_KEYS, ADJUST_RANGE, adjustWrite, clipAdjust, clipFilter, colorPaths, filterWrite, isFilter, isNeutral,
  type Adjust, type AdjustKey, type ColorClip, type ColorWrite,
} from '@/lib/clip-color';
import { STANDARD, useColorFiles, type ColorHost } from '@/lib/color-files';
import { nameOf, useLibraryIndex } from '@/lib/library';
import { MIXED } from '@/lib/mixed';
import { Section, SectionAction, SliderField, type FieldApply } from './inspector-fields';

type T = ReturnType<typeof useT>;

/** How each slider's number reads: stops for exposure, the rest as they are. */
const UNIT: Partial<Record<AdjustKey, string>> = { exposure: ' EV' };

/** The groups the sliders are shown in: white balance, light, color. */
const GROUPS: readonly (readonly AdjustKey[])[] = [['temperature', 'tint'], ['exposure', 'contrast', 'highlights', 'shadows'], ['saturation']];

export function ClipColorSection({ clips, host, t }: { clips: readonly ColorClip[]; host: ColorHost; t: T }) {
  const lang = useLanguage();
  const index = useLibraryIndex();
  const paths = React.useMemo(() => clips.flatMap(colorPaths), [clips]);
  const { text, ready } = useColorFiles(host.projectId, paths);
  const ids = React.useMemo(() => clips.map((c) => c.id), [clips]);
  const [why, setWhy] = React.useState<string | null>(null);

  const common = <V,>(fn: (c: ColorClip) => V): V | typeof MIXED => {
    const all = clips.map(fn);
    const key = JSON.stringify(all[0]);
    return all.every((v) => JSON.stringify(v) === key) ? all[0]! : MIXED;
  };
  const values = clips.map((c) => clipAdjust(c, text));
  const touched = values.some((v) => !isNeutral(v));
  const write = async (w: ColorWrite) => {
    setWhy(null);
    const failed = await host.commit(w, 'history.stepColor');
    if (failed) { host.preview(null, ids); setWhy(failed); }
  };
  const slider = (key: AdjustKey) => {
    const r = ADJUST_RANGE[key];
    const at = (apply: FieldApply) => adjustWrite(clips, text, (now: Adjust) => ({ [key]: Math.min(r.max, Math.max(r.min, Math.round(apply(now[key]) / r.step) * r.step)) }), STANDARD);
    const v = common((c) => clipAdjust(c, text)[key]);
    return (
      <SliderField
        key={key}
        label={t(`inspector.colorKeys.${key}`)}
        value={ready ? v : undefined}
        min={r.min}
        max={r.max}
        step={r.step}
        neutral={0}
        unit={UNIT[key] ?? ''}
        disabled={!ready}
        onPreview={(_, apply) => host.preview(at(apply), ids)}
        onCommit={(_, apply) => { void write(at(apply)); }}
        onRevert={() => host.preview(null, ids)}
      />
    );
  };

  /* the library's filter, when they all wear the same one */
  const worn = common((c) => { const f = clipFilter(c); return f ? { slug: f.slug, amount: f.amount } : null; });
  const item = worn && worn !== MIXED ? index?.items.find((i) => i.grade && isFilter(worn.slug, i.id)) : undefined;
  const filter = item?.grade ? { id: item.id, title: nameOf(item.name, 'en'), grade: item.grade } : null;
  const strength = (apply: FieldApply) => filterWrite(clips, text, filter, Math.max(0, Math.min(100, Math.round(apply(worn && worn !== MIXED ? worn.amount * 100 : 100)))) / 100, STANDARD);

  return (
    <>
      {worn && worn !== MIXED ? (
        <Section
          id="filter"
          title={t('inspector.filter')}
          aside={(
            <SectionAction label={t('inspector.filterRemove')} onClick={() => { void write(filterWrite(clips, text, null, 1, STANDARD)); }}>
              <Minus size={12} />
            </SectionAction>
          )}
        >
          <p className="truncate text-[11.5px] font-medium text-[var(--text)]">{item ? nameOf(item.name, lang) : worn.slug}</p>
          <SliderField
            label={t('inspector.filterAmount')}
            value={Math.round(worn.amount * 100)}
            min={0}
            max={100}
            neutral={0}
            unit="%"
            disabled={!filter || !ready}
            onPreview={(_, apply) => host.preview(strength(apply), ids)}
            onCommit={(_, apply) => { void write(strength(apply)); }}
            onRevert={() => host.preview(null, ids)}
          />
        </Section>
      ) : null}
      <Section
        id="adjust"
        title={t('inspector.adjust')}
        aside={touched ? (
          <SectionAction
            label={t('inspector.resetSection')}
            onClick={() => { void write(adjustWrite(clips, text, () => Object.fromEntries(ADJUST_KEYS.map((k) => [k, 0])), STANDARD)); }}
          >
            <RotateCcw size={11} />
          </SectionAction>
        ) : null}
      >
        {GROUPS.map((keys, i) => (
          <div key={keys[0]} className={`flex flex-col gap-2 ${i ? 'border-t border-[var(--border)] pt-2' : ''}`}>
            {keys.map(slider)}
          </div>
        ))}
        {why ? <p className="mt-1 text-[10.5px] leading-[15px] text-[var(--warn)]">{why}</p> : null}
      </Section>
    </>
  );
}
