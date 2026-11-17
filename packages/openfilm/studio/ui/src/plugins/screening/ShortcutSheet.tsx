/**
 * How the screening room is used, step by step with a drawing of each, then its keys as key caps: drawn into the
 * editor's help, which its "?" and the ? key open.
 */
import * as React from 'react';

export interface Shortcut { keys: readonly string[]; label: string }

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
 * How the screening room is used, step by step, then its keys: drawn into the editor's help (studio `help`), under
 * what its plugin says of it.
 */
export function SheetBody({ steps, keysTitle, groups }: {
  steps: readonly Step[]; keysTitle: string; groups: readonly { title: string; items: readonly Shortcut[] }[];
}) {
  return (
    <div>
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
      <div className="mt-5">
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
    </div>
  );
}

/** A small drawing of a way to use the room, in the room's own shapes: the marks row, the strip, the picture, a message. */
function Art({ kind }: { kind: Step['art'] }) {
  const frames = (
    <span className="flex h-[22px] w-full overflow-hidden rounded-[5px] ring-1 ring-inset ring-white/10">
      {['#3a4a5c', '#5c4636', '#2f4d47', '#4b3a58', '#5a5235', '#34485e'].map((c) => <span key={c} className="h-full flex-1 border-r border-black/30" style={{ background: c }} />)}
    </span>
  );
  const lane = (children?: React.ReactNode) => <span className="relative mb-[3px] block h-[11px] w-full rounded-[4px] bg-white/[.06]">{children}</span>;
  return (
    <div className="relative grid h-[84px] place-items-center overflow-hidden rounded-[10px] bg-black/35 px-4 ring-1 ring-inset ring-white/[.06]">
      {kind === 'watch' ? (
        <span className="relative w-full">
          {lane()}
          <span className="relative block">
            {frames}
            <span className="absolute inset-y-0 left-[46%] w-[2px] bg-white shadow-[0_0_6px_white]" />
            <span className="absolute -bottom-[14px] left-[46%] -translate-x-1/2 text-[11px] leading-none text-white/80">⟷</span>
          </span>
          <span className="mt-[16px] block h-[4px] w-full rounded-full bg-white/10"><span className="block h-full w-[40%] translate-x-[30%] rounded-full bg-white/50" /></span>
        </span>
      ) : kind === 'time' ? (
        <span className="relative w-full">
          {lane(<>
            <span className="absolute left-[22%] top-1/2 grid h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--accent)] text-[7.5px] font-bold text-[var(--on-accent)]">1</span>
            <span className="absolute inset-y-[1px] left-[52%] w-[30%] rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_40%,transparent)] shadow-[inset_0_0_0_1px_var(--accent)]" />
            <span className="absolute left-[52%] top-1/2 grid h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--accent)] text-[7.5px] font-bold text-[var(--on-accent)]">2</span>
          </>)}
          <span className="relative block">
            {frames}
            <span className="absolute inset-y-0 left-[22%] w-[2px] -translate-x-1/2 bg-[var(--accent)]" />
            <span className="absolute inset-y-0 left-[52%] w-[30%] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]" />
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

