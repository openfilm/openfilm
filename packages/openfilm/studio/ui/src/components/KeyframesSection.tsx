/**
 * A clip's keyframes (src/clip-motion.mjs): where it is moved, how big, how turned and how seen at the playhead, each
 * on top of its box. A value changed sets a keyframe there; the diamond beside it adds one or takes it away; the
 * arrows go to the clip's keyframes before and after; a keyframe in hand has its easing (how it goes on to the next).
 * Written as the clip's `motion`: its animations and the film's @keyframes of its name.
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { useT } from '@/i18n';
import { EASES, MOTION_PROPS, valueAt, type Key, type Motion, type MotionProp, type MotionValue } from '../../../../src/clip-motion.mjs';
import { NumField, Row, Section, SectionAction, SelectField } from './inspector-fields';

type T = ReturnType<typeof useT>;
type EaseName = keyof typeof EASES;
const EASE_NAMES = Object.keys(EASES) as EaseName[];

export interface KeyframesSectionProps {
  t: T;
  motion: Motion;
  /** The playhead in the clip's own seconds (null: not on it). */
  local: number | null;
  /** How long the clip is, s. */
  length: number;
  /** One frame, s: keyframes nearer than half of it are the same. */
  frame: number;
  onCommit: (motion: Motion) => void;
  /** To the clip's second `s`. */
  onSeek: (s: number) => void;
}

const near = (a: number, b: number, frame: number) => Math.abs(a - b) < frame / 2;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The motion with a property's keyframe at `t` set (or taken away: null). */
function withKey(motion: Motion, prop: MotionProp, t: number, v: MotionValue | null, frame: number, ease?: string): Motion {
  const keys = (motion[prop] ?? []).filter((k) => !near(k.t, t, frame));
  const was = (motion[prop] ?? []).find((k) => near(k.t, t, frame));
  if (v != null) keys.push({ t: round3(t), v, ...(ease ?? was?.ease ? { ease: ease ?? was?.ease } : {}) });
  keys.sort((a, b) => a.t - b.t);
  const next = { ...motion };
  if (keys.length) next[prop] = keys; else delete next[prop];
  return next;
}

export function KeyframesSection({ t, motion, local, length, frame, onCommit, onSeek }: KeyframesSectionProps) {
  const on = local != null && local >= 0 && local <= length + frame / 2;
  const at = on ? Math.min(Math.max(local, 0), length) : 0;
  const times = [...new Set(MOTION_PROPS.flatMap((p) => (motion[p] ?? []).map((k) => k.t)))].sort((a, b) => a - b);
  const count = MOTION_PROPS.reduce((n, p) => n + (motion[p]?.length ?? 0), 0);
  const prev = on ? [...times].reverse().find((s) => s < at - frame / 2) : undefined;
  const next = on ? times.find((s) => s > at + frame / 2) : undefined;
  /* the keyframes at the playhead, whose easing is shown */
  const here = MOTION_PROPS.flatMap((p) => (motion[p] ?? []).filter((k) => on && near(k.t, at, frame)));
  const ease = here.length && here.every((k) => (k.ease ?? 'linear') === (here[0]!.ease ?? 'linear')) ? (here[0]!.ease ?? 'linear') : here.length ? '' : null;

  const set = (prop: MotionProp, v: MotionValue) => { if (on) onCommit(withKey(motion, prop, at, v, frame)); };
  const toggle = (prop: MotionProp) => {
    if (!on) return;
    const has = (motion[prop] ?? []).some((k) => near(k.t, at, frame));
    onCommit(withKey(motion, prop, at, has ? null : valueAt(prop, motion[prop], at), frame));
  };
  const setEase = (name: string) => {
    let nextMotion = motion;
    for (const p of MOTION_PROPS) {
      const k = (motion[p] ?? []).find((x) => near(x.t, at, frame));
      if (k) nextMotion = withKey(nextMotion, p, k.t, k.v, frame, name);
    }
    onCommit(nextMotion);
  };

  const value = (prop: MotionProp) => valueAt(prop, motion[prop], at);
  const pos = value('translate') as [number, number];
  const row = (prop: MotionProp, label: string, field: React.ReactNode) => (
    <div className="grid grid-cols-[52px_minmax(0,1fr)_22px] items-center gap-1.5">
      <span className="truncate text-[11px] text-[var(--text-muted)]">{label}</span>
      <div className="min-w-0">{field}</div>
      <Diamond state={(motion[prop] ?? []).some((k) => on && near(k.t, at, frame)) ? 'here' : motion[prop]?.length ? 'some' : 'none'}
        label={t((motion[prop] ?? []).some((k) => on && near(k.t, at, frame)) ? 'inspector.keyRemove' : 'inspector.keyAdd')} disabled={!on} onClick={() => toggle(prop)} />
    </div>
  );

  return (
    <Section
      id="keyframes"
      title={t('inspector.keyframes')}
      aside={(
        <div className="flex items-center gap-0.5">
          <SectionAction label={t('inspector.keyPrev')} onClick={() => prev != null && onSeek(prev)} disabled={prev == null}><ChevronLeft size={12} /></SectionAction>
          <SectionAction label={t('inspector.keyNext')} onClick={() => next != null && onSeek(next)} disabled={next == null}><ChevronRight size={12} /></SectionAction>
          {count ? <SectionAction label={t('inspector.keyClear')} onClick={() => onCommit({})}><RotateCcw size={11} /></SectionAction> : null}
        </div>
      )}
    >
      {!on ? <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{t('inspector.keyOutside')}</p> : null}
      {row('translate', t('inspector.keyPosition'), (
        <Row>
          <NumField label="X" value={Math.round(pos[0])} unit="px" disabled={!on} onCommit={(n) => set('translate', [n, pos[1]])} />
          <NumField label="Y" value={Math.round(pos[1])} unit="px" disabled={!on} onCommit={(n) => set('translate', [pos[0], n])} />
        </Row>
      ))}
      {row('scale', t('inspector.keyScale'), (
        <NumField label={t('inspector.keyScale')} value={Math.round((value('scale') as number) * 1000) / 10} unit="%" step={1} min={0} max={2000} disabled={!on}
          onCommit={(n) => set('scale', n / 100)} />
      ))}
      {row('rotate', t('inspector.keyRotate'), (
        <NumField label={t('inspector.keyRotate')} value={Math.round((value('rotate') as number) * 10) / 10} unit="°" step={1} disabled={!on}
          onCommit={(n) => set('rotate', n)} />
      ))}
      {row('opacity', t('inspector.keyOpacity'), (
        <NumField label={t('inspector.keyOpacity')} value={Math.round((value('opacity') as number) * 100)} unit="%" step={1} min={0} max={100} disabled={!on}
          onCommit={(n) => set('opacity', Math.min(1, Math.max(0, n / 100)))} />
      ))}
      {ease != null ? (
        <div className="grid grid-cols-[52px_minmax(0,1fr)_22px] items-center gap-1.5">
          <span className="truncate text-[11px] text-[var(--text-muted)]">{t('inspector.keyEase')}</span>
          <SelectField label={t('inspector.keyEase')} value={ease || 'linear'}
            options={EASE_NAMES.map((n) => ({ value: n, label: t(`inspector.eases.${n}`) }))}
            onCommit={setEase} />
          <span />
        </div>
      ) : null}
      {count ? <p className="text-[10.5px] text-[var(--text-faint)]">{t('inspector.keyCount').replace('{n}', String(count))}</p> : null}
    </Section>
  );
}

/** A keyframe's diamond: filled where the playhead has one, outlined where its property has some, faint where none. */
function Diamond({ state, label, disabled, onClick }: { state: 'here' | 'some' | 'none'; label: string; disabled?: boolean; onClick: () => void }) {
  const color = state === 'none' ? 'var(--text-faint)' : 'var(--tl-accent)';
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="grid h-[22px] w-[22px] place-items-center rounded-[4px] hover:bg-[var(--fill-tsp)] disabled:opacity-40">
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1 11 6 6 11 1 6Z" fill={state === 'here' ? color : 'none'} stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export type { Key };
