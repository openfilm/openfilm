/**
 * A clip's Transform, as an animation editor shows it: position, scale, rotation and opacity, each with its stopwatch
 * and, once it moves, its keyframe navigator. The numbers are where the picture is at the playhead (the box's place,
 * size and turn with the clip's keyframes on top: src/clip-motion.mjs), the same numbers as its Position & size.
 *
 * The stopwatch off, a value is the clip's own (its box, its opacity), for all of it; a click on the stopwatch sets the
 * first keyframe at the playhead, and from then on a value changed sets a keyframe there (or changes the one there).
 * The stopwatch clicked off takes every keyframe of that property away and keeps the value at the playhead.
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { useT } from '@/i18n';
import { MOTION_PROPS, valueAt, type Key, type Motion, type MotionProp, type MotionValue } from '../../../../src/clip-motion.mjs';
import { NumField, Row, Section } from './inspector-fields';

type T = ReturnType<typeof useT>;

import type { StaticTransform } from '@/lib/clip-transform';

export type { StaticTransform };

export interface TransformSectionProps {
  t: T;
  motion: Motion;
  base: StaticTransform;
  /** The playhead in the clip's own seconds (null: not on it). */
  local: number | null;
  length: number;
  /** One frame, s: keyframes nearer than half of it are the same. */
  frame: number;
  /** The clip's keyframes written, with its own transform changed too when given. */
  onCommit: (motion: Motion, base?: Partial<StaticTransform>) => void;
  onSeek: (s: number) => void;
}

const near = (a: number, b: number, frame: number) => Math.abs(a - b) < frame / 2;
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** A property as the panel shows it (on top of the clip's own) and back to a keyframe's value. */
const shown = {
  translate: (v: MotionValue, b: StaticTransform) => [b.x + (v as [number, number])[0], b.y + (v as [number, number])[1]] as [number, number],
  scale: (v: MotionValue, b: StaticTransform) => b.scale * (v as number) * 100,
  rotate: (v: MotionValue, b: StaticTransform) => b.rotate + (v as number),
  opacity: (v: MotionValue) => (v as number) * 100,
};
const keyed = {
  translate: (n: [number, number], b: StaticTransform): MotionValue => [round(n[0] - b.x, 2), round(n[1] - b.y, 2)],
  scale: (n: number, b: StaticTransform): MotionValue => round(n / 100 / (b.scale || 1), 4),
  rotate: (n: number, b: StaticTransform): MotionValue => round(n - b.rotate, 3),
  opacity: (n: number): MotionValue => round(Math.min(1, Math.max(0, n / 100)), 4),
};
/** The clip's own transform at a shown value. */
const asBase = {
  translate: (n: [number, number]): Partial<StaticTransform> => ({ x: n[0], y: n[1] }),
  scale: (n: number): Partial<StaticTransform> => ({ scale: n / 100 }),
  rotate: (n: number): Partial<StaticTransform> => ({ rotate: n }),
  opacity: (n: number): Partial<StaticTransform> => ({ opacity: Math.min(1, Math.max(0, n / 100)) }),
};

/** The motion with a property's keyframe at `t` set (null: taken away). */
export function withKey(motion: Motion, prop: MotionProp, t: number, v: MotionValue | null, frame: number): Motion {
  const was = (motion[prop] ?? []).find((k) => near(k.t, t, frame));
  const keys = (motion[prop] ?? []).filter((k) => k !== was);
  if (v != null) keys.push({ t: round(t), v, ...(was?.ease ? { ease: was.ease } : {}) });
  keys.sort((a, b) => a.t - b.t);
  const next = { ...motion };
  if (keys.length) next[prop] = keys; else delete next[prop];
  return next;
}

/** A change of a clip's Transform: its keyframes, and its own transform when that changes too. */
export interface TransformCommit { motion: Motion; base?: Partial<StaticTransform> }

/**
 * A clip's Transform as numbers, the inspector's and the motion timeline's alike: each property's value where the
 * picture is at the playhead, and what a value typed, a stopwatch or a navigator's middle makes of it (null: nothing,
 * the playhead off the clip).
 */
export function transformModel(motion: Motion, base: StaticTransform, local: number | null, length: number, frame: number) {
  const on = local != null && local >= -frame / 2 && local <= length + frame / 2;
  const at = on ? Math.min(Math.max(local, 0), length) : 0;
  /* a property's value where the picture is now, as shown */
  const now = (prop: MotionProp) => {
    const keys = motion[prop];
    if (prop === 'translate') return shown.translate(keys?.length ? valueAt(prop, keys, at) : [0, 0], base);
    if (prop === 'opacity') return keys?.length ? shown.opacity(valueAt(prop, keys, at)) : base.opacity * 100;
    return shown[prop](keys?.length ? valueAt(prop, keys, at) : prop === 'scale' ? 1 : 0, base);
  };
  /* a value typed: a keyframe here when the property moves, else the clip's own value */
  const set = (prop: MotionProp, n: number | [number, number]): TransformCommit | null => {
    if (motion[prop]?.length) {
      if (!on) return null;
      return { motion: withKey(motion, prop, at, (keyed[prop] as (n: never, b: StaticTransform) => MotionValue)(n as never, base), frame) };
    }
    return { motion, base: (asBase[prop] as (n: never) => Partial<StaticTransform>)(n as never) };
  };
  /* the stopwatch: on, the first keyframe here at the value it has; off, no keyframes and that value its own */
  const stopwatch = (prop: MotionProp): TransformCommit | null => {
    const value = now(prop);
    if (motion[prop]?.length) {
      const next = { ...motion };
      delete next[prop];
      return { motion: next, base: (asBase[prop] as (n: never) => Partial<StaticTransform>)(value as never) };
    }
    if (!on) return null;
    const first = prop === 'opacity' ? keyed.opacity(value as number) : prop === 'translate' ? [0, 0] as [number, number] : prop === 'scale' ? 1 : 0;
    return { motion: withKey(motion, prop, at, first, frame) };
  };
  /* the navigator's middle: a keyframe here added (at its value now) or taken away */
  const toggleHere = (prop: MotionProp): TransformCommit | null => {
    if (!on) return null;
    const has = (motion[prop] ?? []).some((k) => near(k.t, at, frame));
    return { motion: withKey(motion, prop, at, has ? null : valueAt(prop, motion[prop], at), frame) };
  };
  return { on, at, now, set, stopwatch, toggleHere };
}

export function KeyframesSection({ t, motion, base, local, length, frame, onCommit, onSeek }: TransformSectionProps) {
  const model = transformModel(motion, base, local, length, frame);
  const { on, at, now } = model;
  const commit = (c: TransformCommit | null) => { if (c) onCommit(c.motion, c.base); };
  const set = (prop: MotionProp, n: number | [number, number]) => commit(model.set(prop, n));
  const stopwatch = (prop: MotionProp) => commit(model.stopwatch(prop));
  const toggleHere = (prop: MotionProp) => commit(model.toggleHere(prop));

  const row = (prop: MotionProp, label: string, field: React.ReactNode) => {
    const keys = motion[prop] ?? [];
    const moving = keys.length > 0;
    const here = moving && on && keys.some((k) => near(k.t, at, frame));
    const prev = moving && on ? [...keys].reverse().find((k) => k.t < at - frame / 2) : undefined;
    const next = moving && on ? keys.find((k) => k.t > at + frame / 2) : undefined;
    return (
      <div className="grid grid-cols-[50px_18px_minmax(0,1fr)] items-center gap-1" data-motion-prop={prop}>
        {/* the navigator, once it moves: before, here, after */}
        <span className="flex items-center justify-start">
          {moving ? (
            <>
              <NavButton label={t('inspector.keyPrev')} disabled={!prev} onClick={() => prev && onSeek(prev.t)}><ChevronLeft size={11} /></NavButton>
              <NavButton label={t(here ? 'inspector.keyRemove' : 'inspector.keyAdd')} disabled={!on} onClick={() => toggleHere(prop)}>
                <KeyDiamond filled={here} />
              </NavButton>
              <NavButton label={t('inspector.keyNext')} disabled={!next} onClick={() => next && onSeek(next.t)}><ChevronRight size={11} /></NavButton>
            </>
          ) : null}
        </span>
        <Stopwatch on={moving} label={t(moving ? 'inspector.stopwatchOff' : 'inspector.stopwatchOn')} disabled={!moving && !on} onClick={() => stopwatch(prop)} />
        <div className="grid min-w-0 grid-cols-[58px_minmax(0,1fr)] items-center gap-1">
          <span className={`truncate text-[11px] ${moving ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{label}</span>
          <div className="min-w-0">{field}</div>
        </div>
      </div>
    );
  };
  const pos = now('translate') as [number, number];
  return (
    <Section id="keyframes" title={t('inspector.transform')}>
      {row('translate', t('inspector.keyPosition'), (
        <Row>
          <NumField label="X" value={Math.round(pos[0])} unit="px" onCommit={(n) => set('translate', [n, pos[1]])} />
          <NumField label="Y" value={Math.round(pos[1])} unit="px" onCommit={(n) => set('translate', [pos[0], n])} />
        </Row>
      ))}
      {row('scale', t('inspector.keyScale'), (
        <NumField label={t('inspector.keyScale')} value={Math.round((now('scale') as number) * 10) / 10} unit="%" step={1} min={0} max={2000} onCommit={(n) => set('scale', n)} />
      ))}
      {row('rotate', t('inspector.keyRotate'), (
        <NumField label={t('inspector.keyRotate')} value={Math.round((now('rotate') as number) * 10) / 10} unit="°" step={1} onCommit={(n) => set('rotate', n)} />
      ))}
      {row('opacity', t('inspector.keyOpacity'), (
        <NumField label={t('inspector.keyOpacity')} value={Math.round(now('opacity') as number)} unit="%" step={1} min={0} max={100} onCommit={(n) => set('opacity', n)} />
      ))}
      {!on && MOTION_PROPS.some((p) => motion[p]?.length) ? <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{t('inspector.keyOutside')}</p> : null}
    </Section>
  );
}

function NavButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="grid h-[18px] w-[15px] place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--fill-tsp)] hover:text-[var(--text)] disabled:opacity-35">
      {children}
    </button>
  );
}

function KeyDiamond({ filled }: { filled: boolean }) {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1 11 6 6 11 1 6Z" fill={filled ? 'var(--tl-accent)' : 'none'} stroke={filled ? 'var(--tl-accent)' : 'currentColor'} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** A property's stopwatch: lit while it moves. */
export function Stopwatch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  const color = on ? 'var(--tl-accent)' : 'var(--text-faint)';
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={on} disabled={disabled} onClick={onClick}
      className="grid h-[18px] w-[18px] place-items-center rounded-[4px] hover:bg-[var(--fill-tsp)] disabled:opacity-35">
      <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round">
        <circle cx="7" cy="8" r="5" />
        <path d="M7 8V5.4M5.6 1.6h2.8M11 3.6l.9-.9" />
      </svg>
    </button>
  );
}

export type { Key };
