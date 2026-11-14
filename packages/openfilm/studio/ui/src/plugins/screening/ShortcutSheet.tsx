/**
 * How the screening room is used, step by step with a drawing of each, then its keys as key caps: shown while ⌘ (Ctrl
 * elsewhere) is held alone for a moment and gone as it is let go, or opened from its button (closed by a click anywhere).
 */
import * as React from 'react';
import { MAC } from '@/lib/keymap-store';

/** How long the key is held alone before the sheet shows, ms: a ⌘ pressed for a shortcut never shows it. */
const HOLD_MS = 450;

export interface Shortcut { keys: readonly string[]; label: string }

/**
 * Whether the sheet is shown: while ⌘ (Ctrl) is held alone, from `HOLD_MS` on; `active` false: never. Held for
 * anything else (a scroll, a click, another key: ⌘ with the wheel zooms the bar), it does not show until let go.
 */
export function useHeldSheet(active: boolean): boolean {
  const [held, setHeld] = React.useState(false);
  React.useEffect(() => {
    if (!active) { setHeld(false); return; }
    const modifier = MAC ? 'Meta' : 'Control';
    let timer: ReturnType<typeof setTimeout> | null = null;
    /* the key is held for something else: no sheet until it is let go */
    let used = false;
    const stop = () => { if (timer) clearTimeout(timer); timer = null; setHeld(false); };
    const spoil = () => { used = true; stop(); };
    const down = (e: KeyboardEvent) => {
      if (e.key === modifier && !e.repeat && !e.shiftKey && !e.altKey) {
        used = false;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { if (!used) setHeld(true); }, HOLD_MS);
      } else spoil();
    };
    const up = (e: KeyboardEvent) => { if (e.key === modifier) { used = false; stop(); } };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', stop);
    window.addEventListener('pointerdown', spoil, true);
    window.addEventListener('wheel', spoil, { capture: true, passive: true });
    return () => {
      stop();
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', stop);
      window.removeEventListener('pointerdown', spoil, true);
      window.removeEventListener('wheel', spoil, true);
    };
  }, [active]);
  return held;
}

export function Keys({ keys, small = false }: { keys: readonly string[]; small?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k) => (
        <kbd key={k} className={`grid place-items-center rounded-[5px] border border-[color:var(--border-strong)] bg-[var(--bg-raised)] font-sans font-medium text-[var(--text)] shadow-[0_1px_0_var(--border-strong)] ${small ? 'h-[18px] min-w-[18px] px-1 text-[10.5px]' : 'h-6 min-w-6 px-1.5 text-[12px]'}`}>{k}</kbd>
      ))}
    </span>
  );
}

/** A way the screening room is used: a drawing of it, its name, what is done. */
export interface Step { art: 'watch' | 'time' | 'picture' | 'say'; title: string; text: string }

/**
 * The sheet over the screening room: how it is used, step by step, then its keys. `onClose`: it was opened from its
 * button, and a click anywhere closes it.
 */
export function ShortcutSheet({ title, steps, keysTitle, groups, hold, onClose }: {
  title: string; steps: readonly Step[]; keysTitle: string;
  groups: readonly { title: string; items: readonly Shortcut[] }[]; hold: Shortcut; onClose?: () => void;
}) {
  return (
    <div className={`absolute inset-0 z-40 grid place-items-center bg-black/40 ${onClose ? 'pointer-events-auto' : 'pointer-events-none'}`} onClick={onClose}>
      <div role="dialog" aria-label={title} className="max-h-[calc(100%-32px)] w-[min(780px,calc(100%-48px))] overflow-auto rounded-2xl border border-[color:var(--border-strong)] bg-[var(--bg-raised)] p-6 shadow-[0_24px_64px_rgb(0_0_0/.45)]">
        <div className="mb-5 text-[15px] font-semibold text-[var(--text)]">{title}</div>
        <div className="grid grid-cols-4 gap-4">
          {steps.map((step, i) => (
            <div key={step.art} className="flex flex-col gap-2">
              <Art kind={step.art} />
              <div className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text)]">
                <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-white/10 text-[10.5px] text-[var(--text-muted)]">{i + 1}</span>{step.title}
              </div>
              <p className="text-[12px] leading-[1.55] text-[var(--text-muted)]">{step.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 border-t border-[color:var(--border)] pt-4">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{keysTitle}</div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-2">
            {groups.flatMap((group) => group.items).map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3 text-[12.5px] text-[var(--text-muted)]">
                <span className="min-w-0 truncate">{s.label}</span>
                <Keys keys={s.keys} small />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between text-[11.5px] text-[var(--text-faint)]">
          <span>{hold.label}</span>
          <Keys keys={hold.keys} small />
        </div>
      </div>
    </div>
  );
}

/** A small drawing of a way to use the room, in the room's own shapes: the marks row, the strip, the picture, a message. */
function Art({ kind }: { kind: Step['art'] }) {
  /* the progress bar, `played` of it red, its knob there */
  const bar = (played: number, knob = false) => (
    <span className="relative block h-[4px] w-full rounded-full bg-white/25">
      <span className="absolute inset-y-0 left-0 rounded-full bg-[#f03]" style={{ width: `${played}%` }} />
      {knob ? <span className="absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f03]" style={{ left: `${played}%` }} /> : null}
    </span>
  );
  const lane = (children?: React.ReactNode) => <span className="relative mb-[6px] block h-[11px] w-full rounded-[4px] bg-white/[.06]">{children}</span>;
  return (
    <div className="relative grid h-[84px] place-items-center overflow-hidden rounded-[10px] bg-black/35 px-4 ring-1 ring-inset ring-white/[.06]">
      {kind === 'watch' ? (
        <span className="relative w-full">
          {lane()}
          {bar(46, true)}
          <span className="mt-[6px] block text-center text-[11px] leading-none text-white/70">⟷</span>
        </span>
      ) : kind === 'time' ? (
        <span className="relative w-full">
          {lane(<>
            <span className="absolute left-[22%] top-1/2 grid h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--accent)] text-[7.5px] font-bold text-[var(--on-accent)]">1</span>
            <span className="absolute left-[52%] top-1/2 h-[3px] w-[30%] -translate-y-1/2 rounded-full bg-[var(--accent)]" />
            <span className="absolute left-[52%] top-1/2 grid h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--accent)] text-[7.5px] font-bold text-[var(--on-accent)]">2</span>
          </>)}
          <span className="relative block">
            {bar(30)}
            <span className="absolute left-[22%] top-1/2 h-[8px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)]" />
            <span className="absolute left-[52%] top-0 h-[4px] w-[30%] bg-[var(--accent)]" />
          </span>
        </span>
      ) : kind === 'picture' ? (
        <span className="relative block h-[60px] w-[106px] overflow-hidden rounded-[5px] bg-gradient-to-br from-[#4a5a70] to-[#2b2f3a] ring-1 ring-inset ring-white/10">
          <span className="absolute bottom-0 left-[18%] h-[60%] w-[26%] rounded-t-full bg-black/35" />
          <span className="absolute left-[48%] top-[22%] h-[50%] w-[38%] rounded-[2px] border-[1.5px] border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]" />
          <span className="absolute left-[48%] top-[22%] grid h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[3px] bg-[var(--accent)] text-[7.5px] font-bold text-[var(--on-accent)]">3</span>
        </span>
      ) : (
        <span className="flex w-full flex-col gap-1.5 rounded-[8px] bg-white/[.06] p-2">
          <span className="flex gap-1">
            {['1', '2', '3'].map((n) => <span key={n} className="grid h-[13px] min-w-[13px] place-items-center rounded-full bg-[var(--accent)] px-1 text-[8px] font-bold text-[var(--on-accent)]">{n}</span>)}
          </span>
          <span className="block h-[5px] w-[85%] rounded-full bg-white/30" />
          <span className="block h-[5px] w-[60%] rounded-full bg-white/20" />
        </span>
      )}
    </div>
  );
}

/** The modifier's name as this computer's keyboard shows it. */
export const MOD = MAC ? '⌘' : 'Ctrl';
