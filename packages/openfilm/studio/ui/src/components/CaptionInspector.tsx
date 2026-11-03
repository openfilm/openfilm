/**
 * The look of the cues picked on a caption track (SPEC §1 Captions), and their words. What it changes is the file's
 * STYLE: with "Apply to all captions" (on, as captions are one look) the track's (`::cue`), every cue's own say of
 * those properties taken away; off, the picked cues' own rules (`::cue(#c3)`). Cues with a look of their own are
 * said so here, with the way back to the track's.
 */
import React from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { cuePlain, cueSettings, withSettings } from '../../../../src/captions.mjs';
import { useT } from '@/i18n';
import { cueRule, removeCues, setCueRule, setCueSettings, setCueText, type Vtt } from '@/lib/caption-edits';
import { setCaptionSelection, useCaptionSelection, useCaptionTrack } from '@/lib/caption-tracks';
import { InspectorPanel } from './InspectorPanel';
import { ColorField, Section, Segmented, SliderField, SubLabel } from './inspector-fields';

/** The properties the panel sets, and what each reads as when the file says nothing (WebVTT's own default). */
const DEFAULTS = { size: 5, color: '#ffffff', weight: '400', stroke: 0, strokeColor: '#000000', background: '#000000', backgroundOpacity: 80 };

const num = (v: string | undefined) => { const n = Number.parseFloat(v ?? ''); return Number.isFinite(n) ? n : undefined; };

/** What the CSS of one rule says of the panel's properties (the `font` shorthand read for its size and weight). */
function lookOf(rule: Record<string, string>) {
  const font = rule.font ?? '';
  const size = num(rule['font-size']?.replace(/cqmin$/, '')) ?? num(/([\d.]+)cqmin/.exec(font)?.[1]);
  const weight = rule['font-weight'] ?? /^(?:italic\s+)?(\d{3}|bold)\b/.exec(font)?.[1];
  const stroke = /^([\d.]+)em\s+(.+)$/.exec(rule['-webkit-text-stroke'] ?? '');
  const bg = rule.background ?? rule['background-color'];
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(bg ?? '');
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return {
    ...(size != null ? { size } : {}),
    ...(rule.color ? { color: rule.color } : {}),
    ...(weight ? { weight: weight === 'bold' ? '700' : weight } : {}),
    ...(stroke ? { stroke: Number(stroke[1]), strokeColor: stroke[2]! } : {}),
    ...(bg === 'none' || bg === 'transparent' ? { backgroundOpacity: 0 } : {}),
    ...(rgba ? { background: `#${hex(+rgba[1]!)}${hex(+rgba[2]!)}${hex(+rgba[3]!)}`, backgroundOpacity: Math.round(Number(rgba[4]) * 100) } : {}),
    ...(/^#[0-9a-f]{6}$/i.test(bg ?? '') ? { background: bg!, backgroundOpacity: 100 } : {}),
  };
}

/** A background as CSS: none at 0%, else its color at that opacity. */
const backgroundCss = (color: string, opacity: number) => {
  if (opacity <= 0) return 'none';
  const n = Number.parseInt(color.slice(1), 16);
  return opacity >= 100 ? color : `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity / 100})`;
};

export function CaptionInspector({ projectId, width, onClose }: { projectId: string; width: number; onClose: () => void }) {
  const t = useT();
  const sel = useCaptionSelection();
  const { vtt, write } = useCaptionTrack(projectId, sel?.src ?? '');
  const [all, setAll] = React.useState(true);
  const scope = all ? 'all' : 'selected';
  const ids = React.useMemo(() => [...(sel?.ids ?? [])], [sel]);
  const one = ids.length === 1 ? vtt?.cues.find((c) => c.id === ids[0]) : undefined;
  const [text, setText] = React.useState('');
  React.useEffect(() => { setText(one ? cuePlain(one.text) : ''); }, [one]);
  if (!sel || !vtt) return <InspectorPanel title={t('captionTrack.title')} width={width} onClose={onClose}><p className="mt-3 text-[11.5px] text-[var(--text-muted)]">{t('captionTrack.pickHint')}</p></InspectorPanel>;

  const track = lookOf(cueRule(vtt, '::cue'));
  const own = ids.map((id) => lookOf(cueRule(vtt, `::cue(#${id})`)));
  /* what the panel shows: the track's look under the first picked cue's own (a mixed value shows the first's) */
  const shown = { ...DEFAULTS, ...track, ...(scope === 'selected' ? own[0] : {}) };
  const ownCount = ids.filter((id) => Object.keys(cueRule(vtt, `::cue(#${id})`)).length).length;

  const apply = (decls: Record<string, string | null>, label: string) => {
    let next: Vtt = vtt;
    if (scope === 'all') {
      next = setCueRule(next, '::cue', decls);
      /* every cue takes the track's look for these: their own say of them goes */
      const off = Object.fromEntries(Object.keys(decls).map((k) => [k, null]));
      for (const c of next.cues) next = setCueRule(next, `::cue(#${c.id})`, off);
    } else {
      for (const id of ids) next = setCueRule(next, `::cue(#${id})`, decls);
    }
    void write(next, label);
  };
  const first = vtt.cues.find((c) => ids.includes(c.id));
  const line = first ? num(cueSettings(first.settings).line) : undefined;
  const placeAt = (pct: number) => {
    const targets = new Set(scope === 'all' ? vtt.cues.map((c) => c.id) : ids);
    /* a place of its own: out of its region, its line where it was put, its text kept in the middle */
    void write(setCueSettings(vtt, targets, (s) => withSettings(s, { region: null, line: `${Math.round(pct)}%`, position: null })), 'captionTrack.stepPlace');
  };

  return (
    <InspectorPanel title={t('captionTrack.title')} width={width} onClose={onClose}>
      <div className="mt-3 flex flex-col gap-1.5">
        <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-[var(--text)]">
          <input type="checkbox" data-caption-apply-all="" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-[var(--accent)]" />
          {t('captionTrack.applyAll')}
        </label>
        {!all ? <p className="text-[10.5px] leading-snug text-[var(--text-faint)]">{t('captionTrack.selectedOnly').replace('{n}', String(ids.length))}</p> : null}
        {ownCount ? (
          <div data-caption-own="" className="flex items-center justify-between gap-2 rounded-[5px] bg-[var(--fill-tsp)] px-2 py-1 text-[10.5px] text-[var(--text-muted)]">
            <span>{t(ownCount === 1 && ids.length === 1 ? 'captionTrack.ownOne' : 'captionTrack.ownSome').replace('{n}', String(ownCount))}</span>
            <button type="button" className="flex shrink-0 items-center gap-1 text-[var(--text)] hover:underline"
              onClick={() => { let next = vtt; for (const id of ids) next = setCueRule(next, `::cue(#${id})`, null); void write(next, 'captionTrack.stepLook'); }}>
              <RotateCcw size={11} />{t('captionTrack.useTrack')}
            </button>
          </div>
        ) : null}
      </div>
      {one ? (
        <Section id="caption-text" title={t('captionTrack.text')}>
          <textarea
            data-caption-text=""
            value={text}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => { if (text.trim() && text !== cuePlain(one.text)) void write(setCueText(vtt, one.id, text.trim()), 'captionTrack.stepText'); }}
            className="w-full resize-y rounded-[5px] bg-[var(--fill-tsp)] px-2 py-1.5 text-[12px] text-[var(--text)] outline-none ring-1 ring-inset ring-transparent focus:bg-[var(--bg)] focus:ring-[var(--accent)]"
          />
        </Section>
      ) : null}
      <Section id="caption-look" title={t('captionTrack.look')}>
        <div className="flex flex-col gap-2">
          <SliderField label={t('captionTrack.size')} value={shown.size} min={2} max={12} step={0.1} unit="%" onCommit={(n) => apply({ 'font-size': `${n}cqmin` }, 'captionTrack.stepLook')} />
          <Segmented label={t('captionTrack.weight')} value={Number(shown.weight) >= 600 ? 'bold' : 'regular'} onChange={(v) => apply({ 'font-weight': v === 'bold' ? '800' : '400' }, 'captionTrack.stepLook')} options={[
            { value: 'regular', label: t('captionTrack.regular') }, { value: 'bold', label: t('captionTrack.bold') },
          ]} />
          <ColorField label={t('captionTrack.color')} value={shown.color} onCommit={(c) => apply({ color: c }, 'captionTrack.stepLook')} />
          <SubLabel>{t('captionTrack.stroke')}</SubLabel>
          <SliderField label={t('captionTrack.strokeWidth')} value={shown.stroke} min={0} max={0.3} step={0.01} unit="em" fieldWidth={64}
            onCommit={(n) => apply(n > 0 ? { '-webkit-text-stroke': `${n}em ${shown.strokeColor}`, 'paint-order': 'stroke fill' } : { '-webkit-text-stroke': null, 'paint-order': null }, 'captionTrack.stepLook')} />
          <ColorField label={t('captionTrack.strokeColor')} value={shown.strokeColor} onCommit={(c) => apply({ '-webkit-text-stroke': `${shown.stroke || 0.08}em ${c}`, 'paint-order': 'stroke fill' }, 'captionTrack.stepLook')} />
          <SubLabel>{t('captionTrack.background')}</SubLabel>
          <SliderField label={t('captionTrack.backgroundOpacity')} value={shown.backgroundOpacity} min={0} max={100} unit="%" onCommit={(n) => apply({ background: backgroundCss(shown.background, n) }, 'captionTrack.stepLook')} />
          <ColorField label={t('captionTrack.backgroundColor')} value={shown.background} onCommit={(c) => apply({ background: backgroundCss(c, shown.backgroundOpacity || 80) }, 'captionTrack.stepLook')} />
        </div>
      </Section>
      <Section id="caption-place" title={t('captionTrack.place')}>
        <SliderField label={t('captionTrack.height')} value={line ?? 90} min={0} max={100} unit="%" onCommit={placeAt} />
      </Section>
      <div className="mt-3">
        <button type="button" data-caption-delete="" onClick={() => { setCaptionSelection(null); void write(removeCues(vtt, new Set(ids)), 'captionTrack.stepRemove'); }}
          className="flex h-7 w-full items-center justify-center gap-1.5 rounded-[5px] bg-[var(--fill-tsp)] text-[11.5px] text-[var(--danger,#e5484d)] hover:bg-[var(--bg-hover)]">
          <Trash2 size={13} />{ids.length > 1 ? t('captionTrack.deleteN').replace('{n}', String(ids.length)) : t('subtitleRow.delete')}
        </button>
      </div>
    </InspectorPanel>
  );
}
