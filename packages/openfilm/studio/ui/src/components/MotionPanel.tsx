/**
 * Motion's own panel, in the inspector's place while motion shows (the edit's inspector is about cutting): two
 * categories, as an animation editor keeps two panels there.
 *
 * - Properties: the picked layer's Transform (a stopwatch each, its values dragged or typed), and what it has beyond
 *   that, as sliders — its effects (an effect's controls), its 3D, its stroke drawn on. An effect is added from its +.
 * - Effects & Presets: everything that can be put on a layer (components/motion-items), each a tile playing what it
 *   does while the pointer is on it: clicked, it goes on the picked layers; dragged, onto the layer it is let go on.
 */
import * as React from 'react';
import { Plus, Search, X } from 'lucide-react';
import { EFFECTS, MOTION_PROPS, type EffectProp, type MotionProp } from '../../../../src/clip-motion.mjs';
import { useT } from '@/i18n';
import { Stopwatch } from './KeyframesSection';
import { ContextMenu } from './ContextMenu';
import { Scrub, type Layer, type LayerHost } from './MotionLayers';
import { FILTER_EFFECTS, ITEM_DRAG, ITEM_SECTIONS, applyItem, itemApplies, itemKey, itemLabel, type MotionItem } from './motion-items';
import styles from './MotionPanel.module.css';

type Tab = 'properties' | 'presets';
let keptTab: Tab = 'properties';

/** Each effect's slider: from, to, a step. */
const RANGE: Record<EffectProp, [number, number, number]> = {
  blur: [0, 40, 0.5], brightness: [0, 300, 1], contrast: [0, 300, 1], saturate: [0, 300, 1], hue: [-180, 180, 1],
  grayscale: [0, 100, 1], invert: [0, 100, 1], glow: [0, 60, 0.5], trim: [0, 100, 0.5], z: [-1000, 1000, 5], rx: [-180, 180, 1], ry: [-180, 180, 1],
  ax: [-1920, 1920, 1], ay: [-1920, 1920, 1],
};
const PROP_LABEL: Record<MotionProp, string> = { translate: 'inspector.keyPosition', scale: 'inspector.keyScale', rotate: 'inspector.keyRotate', opacity: 'inspector.keyOpacity' };
const LABEL: Record<string, string> = { video: '#4ca3ad', mg: '#a594d6', still: '#c7a35f', text: '#d0706f', image: '#c7a35f', shape: '#5b8fd6', box: '#8c9a6b', group: '#8a8f98' };

export function MotionPanel({ layers, hostOf, onApplied, contents }: {
  /** The picked layers, the first the one shown. */
  layers: readonly Layer[];
  /** What the layer itself is made of (a text's words and font, a shape's fill and stroke): its page's properties. */
  contents?: React.ReactNode;
  hostOf: (layer: Layer) => LayerHost;
  /** Something was put on these layers (the timeline twirls them open). */
  onApplied: (ids: readonly string[]) => void;
}) {
  const t = useT();
  const [tab, setTab] = React.useState<Tab>(keptTab);
  const choose = (next: Tab) => { keptTab = next; setTab(next); };
  const layer = layers[0] ?? null;
  const host = layer ? hostOf(layer) : null;
  const put = (item: MotionItem) => {
    const took = layers.filter((l) => itemApplies(hostOf(l), item));
    for (const l of took) applyItem(hostOf(l), item);
    if (took.length) onApplied(took.map((l) => l.clipId));
  };
  return (
    /* the inspector of Motion: a press in it keeps what is in hand on the picture */
    <div className={styles.panel} data-motion-panel="" data-film-inspector="">
      <div className={styles.tabs} role="tablist">
        {(['properties', 'presets'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? styles.on : undefined} onClick={() => choose(id)} data-motion-tab={id}>
            {t(id === 'properties' ? 'canvas.panelProperties' : 'canvas.panelPresets')}
          </button>
        ))}
      </div>
      <div className={styles.scroll}>
        {tab === 'properties'
          ? (layer && host ? <Properties layer={layer} count={layers.length} host={host} t={t} onApplied={onApplied} contents={contents} /> : <HowTo t={t} />)
          : <Presets host={host} count={layers.length} onPut={put} t={t} />}
      </div>
    </div>
  );
}

function Properties({ layer, count, host, t, onApplied, contents }: { layer: Layer; count: number; host: LayerHost; t: (key: string) => string; onApplied: (ids: readonly string[]) => void; contents?: React.ReactNode }) {
  const model = host.model;
  const motion = model?.preset?.motion ?? {};
  const [adding, setAdding] = React.useState<{ x: number; y: number } | null>(null);
  const fxOn = (host.effects?.on ?? []).filter((fx) => EFFECTS[fx].filter);
  const missing = FILTER_EFFECTS.filter((fx) => !fxOn.includes(fx));
  return (
    <>
      <div className={styles.layer} data-motion-panel-layer={layer.clipId}>
        <span className={styles.chip} style={{ background: LABEL[layer.kind] ?? '#8a8f98' }} />
        <span className={styles.name} title={layer.title}>{layer.title || layer.clipId}</span>
        <span className={styles.kind}>{count > 1 ? t('canvas.panelMore').replace('{n}', String(count - 1)) : null}</span>
      </div>
      {contents ? <div className="px-[10px]" data-panel-section="contents">{contents}</div> : null}
      {model ? (
        <section className={styles.section} data-panel-section="transform">
          <div className={styles.sectionHead}><span>{t('inspector.transform')}</span></div>
          {MOTION_PROPS.map((prop) => {
            const keyed = Boolean(motion[prop]?.length);
            const value = model.now(prop);
            const set = (n: number | [number, number]) => host.commit(model.set(prop, n));
            return (
              <div key={prop} className={styles.row} data-panel-prop={prop}>
                <Stopwatch on={keyed} label={t(keyed ? 'inspector.stopwatchOff' : 'inspector.stopwatchOn')} disabled={!keyed && !model.on}
                  onClick={() => host.commit(model.stopwatch(prop))} />
                <span className={styles.label}>{t(PROP_LABEL[prop])}</span>
                <span className="flex min-w-0 items-center gap-2">
                  {Array.isArray(value) ? (
                    <>
                      <Scrub label="X" value={value[0]} onCommit={(n) => set([n, value[1]])} />
                      <Scrub label="Y" value={value[1]} onCommit={(n) => set([value[0], n])} />
                    </>
                  ) : prop === 'opacity' ? <Scrub label={t(PROP_LABEL[prop])} value={value} unit="%" step={0.5} digits={0} onCommit={(n) => set(Math.min(100, Math.max(0, n)))} />
                    : <Scrub label={t(PROP_LABEL[prop])} value={value} unit={prop === 'scale' ? '%' : '°'} step={0.5} onCommit={set} />}
                </span>
              </div>
            );
          })}
        </section>
      ) : null}
      {host.three?.on ? (
        <Sliders title={t('canvas.threeD')} id="three" fxs={['z', 'rx', 'ry']} model={host.three.model} commit={host.three.commit} keyed={(fx) => Boolean(motion[fx]?.length)}
          onRemove={() => host.three?.toggle(false)} t={t} />
      ) : null}
      {host.effects ? (
        fxOn.length ? (
          <Sliders title={t('canvas.fxGroup')} id="fx" fxs={fxOn} model={host.effects} commit={host.commitEffects} keyed={(fx) => Boolean(motion[fx]?.length)}
            onRemoveOne={(fx) => host.commitEffects(host.effects!.remove(fx))} t={t}
            add={missing.length ? (e) => { const r = e.currentTarget.getBoundingClientRect(); setAdding({ x: r.right, y: r.bottom + 2 }); } : undefined} />
        ) : (
          <section className={styles.section} data-panel-section="fx">
            <div className={styles.sectionHead}>
              <span>{t('canvas.fxGroup')}</span>
              <button type="button" className={styles.iconBtn} aria-label={t('canvas.fxAdd')} title={t('canvas.fxAdd')} data-panel-fx-add=""
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAdding({ x: r.right, y: r.bottom + 2 }); }}><Plus size={14} /></button>
            </div>
            <p className="text-[11px] leading-[1.5] text-[var(--text-faint)]">{t('canvas.fxNone')}</p>
          </section>
        )
      ) : null}
      {host.stroke?.on ? (
        <Sliders title={t('canvas.shapeGroup')} id="stroke" fxs={['trim']} model={host.stroke.model} commit={host.stroke.commit} keyed={(fx) => Boolean(motion[fx]?.length)}
          onRemove={() => host.stroke?.commit(host.stroke.model.remove('trim'))} t={t} />
      ) : null}
      <p className={styles.hint}>{t('canvas.panelHint')}</p>
      {adding ? (
        <ContextMenu x={adding.x} y={adding.y} align="end" onClose={() => setAdding(null)}
          items={missing.map((fx) => ({ id: fx, label: t(`canvas.fx.${fx}`), onSelect: () => { applyItem(host, { kind: 'fx', id: fx }); onApplied([layer.clipId]); } }))} />
      ) : null}
    </>
  );
}

/** A group of an effect's controls: each a stopwatch, its name, a slider and its value; taken off one by one or all. */
function Sliders({ title, id, fxs, model, commit, keyed, onRemove, onRemoveOne, add, t }: {
  title: string; id: string; fxs: readonly EffectProp[];
  model: NonNullable<LayerHost['effects']>; commit: LayerHost['commitEffects']; keyed: (fx: EffectProp) => boolean;
  onRemove?: () => void; onRemoveOne?: (fx: EffectProp) => void; add?: ((e: React.MouseEvent<HTMLButtonElement>) => void) | undefined;
  t: (key: string) => string;
}) {
  return (
    <section className={styles.section} data-panel-section={id}>
      <div className={styles.sectionHead}>
        <span>{title}</span>
        {add ? <button type="button" className={styles.iconBtn} aria-label={t('canvas.fxAdd')} title={t('canvas.fxAdd')} data-panel-fx-add="" onClick={add}><Plus size={14} /></button> : null}
        {onRemove ? <button type="button" className={styles.iconBtn} aria-label={t('canvas.groupRemove')} title={t('canvas.groupRemove')} onClick={onRemove}><X size={13} /></button> : null}
      </div>
      {fxs.map((fx) => <Slider key={fx} fx={fx} model={model} commit={commit} keyed={keyed(fx)} onRemove={onRemoveOne ? () => onRemoveOne(fx) : undefined} t={t} />)}
    </section>
  );
}

function Slider({ fx, model, commit, keyed, onRemove, t }: {
  fx: EffectProp; model: NonNullable<LayerHost['effects']>; commit: LayerHost['commitEffects']; keyed: boolean; onRemove?: (() => void) | undefined; t: (key: string) => string;
}) {
  const [lo, hi, step] = RANGE[fx];
  const value = model.now(fx);
  /* shown as it is dragged, written once let go */
  const [live, setLive] = React.useState<number | null>(null);
  const write = (n: number) => commit(model.set(fx, Math.min(hi, Math.max(lo, n))));
  const unit = EFFECTS[fx].unit === 'deg' ? '°' : EFFECTS[fx].unit || '%';
  const done = () => { if (live != null) { write(live); setLive(null); } };
  return (
    <div className={`group/fx ${styles.row}`} data-panel-effect={fx}>
      <Stopwatch on={keyed} label={t(keyed ? 'inspector.stopwatchOff' : 'inspector.stopwatchOn')} onClick={() => commit(model.stopwatch(fx))} />
      <span className={styles.label}>{t(`canvas.fx.${fx}`)}</span>
      <input type="range" className={styles.slider} min={lo} max={hi} step={step} value={live ?? value} aria-label={t(`canvas.fx.${fx}`)}
        onChange={(e) => setLive(Number(e.target.value))} onPointerUp={done} onKeyUp={done} onBlur={done} />
      <span className={styles.value}><Scrub label={t(`canvas.fx.${fx}`)} value={live ?? value} unit={unit} step={step} onCommit={write} /></span>
      {onRemove ? (
        <button type="button" className={`${styles.iconBtn} opacity-0 group-hover/fx:opacity-100`} aria-label={t('canvas.fxRemove')} title={t('canvas.fxRemove')} onClick={onRemove}><X size={12} /></button>
      ) : null}
    </div>
  );
}

const SECTION_TITLE: Record<string, string> = {
  'anim-in': 'canvas.presetsIn', 'anim-out': 'canvas.presetsOut', 'anim-along': 'canvas.presetsAlong',
  fx: 'canvas.fxGroup', mask: 'inspector.mask', text: 'canvas.textAnimator', layer: 'canvas.presetsLayer',
};

function Presets({ host, count, onPut, t }: { host: LayerHost | null; count: number; onPut: (item: MotionItem) => void; t: (key: string) => string }) {
  const [query, setQuery] = React.useState('');
  const q = query.trim().toLowerCase();
  const sections = ITEM_SECTIONS.map((s) => ({ ...s, items: s.items.filter((item) => !q || t(itemLabel(item)).toLowerCase().includes(q) || t(SECTION_TITLE[s.id]!).toLowerCase().includes(q)) }))
    .filter((s) => s.items.length);
  return (
    <>
      <label className={styles.search}>
        <Search size={13} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('canvas.presetsSearch')} aria-label={t('canvas.presetsSearch')}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); e.stopPropagation(); }} />
      </label>
      {sections.map((s) => (
        <div key={s.id} data-presets-section={s.id}>
          <div className={styles.groupTitle}>{t(SECTION_TITLE[s.id]!)}</div>
          <div className={styles.grid}>
            {s.items.map((item) => {
              const ok = count > 0 && itemApplies(host, item);
              return (
                <div key={itemKey(item)} role="button" tabIndex={0} aria-disabled={!ok} draggable data-preset={itemKey(item)}
                  title={ok ? t('canvas.presetsUse') : t(count ? 'canvas.presetsCannot' : 'canvas.panelPick')}
                  className={`${styles.tile} ${tileClass(item)}`}
                  onClick={() => { if (ok) onPut(item); }}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && ok) { e.preventDefault(); onPut(item); } }}
                  onDragStart={(e) => { e.dataTransfer.setData(ITEM_DRAG, itemKey(item)); e.dataTransfer.effectAllowed = 'copy'; }}>
                  <TilePicture item={item} />
                  <span>{t(itemLabel(item))}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {!sections.length ? <p className={styles.empty}>{t('canvas.presetsNone')}</p> : null}
      <p className={styles.hint}>{t('canvas.presetsHint')}</p>
    </>
  );
}

const tileClass = (item: MotionItem) => {
  switch (item.kind) {
    case 'anim': return styles[item.id] ?? '';
    case 'fx': return styles[`fx-${item.id}`] ?? '';
    case 'mask': return `${styles.mask} ${styles[`mask-${item.id}`] ?? ''}`;
    case 'text': return styles[`text-${item.id}`] ?? '';
    case 'three': return styles.three ?? '';
    case 'stroke': return styles.stroke ?? '';
  }
};

function TilePicture({ item }: { item: MotionItem }) {
  if (item.kind === 'text') return <span className={styles.stage}><span className={styles.words}><span>A</span><span>b</span><span>c</span></span></span>;
  if (item.kind === 'stroke') {
    return (
      <span className={styles.stage}>
        <svg width="40" height="22" viewBox="0 0 40 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M3 17 C 10 2, 16 2, 20 11 S 30 20, 37 5" strokeDasharray="60" strokeDashoffset="0" />
        </svg>
      </span>
    );
  }
  return <span className={styles.stage}><span className={styles.card} /></span>;
}

/**
 * With nothing in hand, how a move is made, in three steps, as the first thing anyone animating needs: a layer, its
 * stopwatch, the playhead moved and a value changed (the keyframes follow).
 */
function HowTo({ t }: { t: (key: string) => string }) {
  const steps = ['canvas.howPick', 'canvas.howWatch', 'canvas.howChange'];
  return (
    <div className={styles.howTo} data-motion-howto="">
      <p className={styles.howTitle}>{t('canvas.howTitle')}</p>
      <ol className={styles.howSteps}>
        {steps.map((key, i) => (
          <li key={key}><span className={styles.howN}>{i + 1}</span><span>{t(key)}</span></li>
        ))}
      </ol>
      <p className={styles.howMore}>{t('canvas.howMore')}</p>
    </div>
  );
}
