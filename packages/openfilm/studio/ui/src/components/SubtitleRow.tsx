/**
 * The subtitle row: the film's subtitles as blocks under the ruler, timed by hand as CapCut's caption track is.
 *
 *   drag a cue's edge     its start or end (never over a neighbor, snapping to clip edges, cues and the playhead)
 *   drag a cue            moves it, its length kept
 *   double-click          types its words, in place (Enter keeps them, Esc lets them go; empty takes it away)
 *   right-click           split at the playhead, merge with the next, edit, delete; on empty space, add one
 *   ⌘B                    with the row targeted (the last thing pressed on the timeline): splits the cue at the playhead
 *   ⌫ / Delete, Enter     the selected cue: deletes it, types its words
 *
 * Each edit goes back into the transcript the cue comes from, in one undo step (lib/use-subtitle-edits). The row is
 * shown or hidden with its button in the toolbar (kept on this machine).
 */
import React from 'react';
import { Captions, Combine, Pencil, Plus, Scissors, Trash2 } from 'lucide-react';
import { useT } from '@/i18n';
import { shortcutHint } from '@/lib/shortcut-hint';
import {
  addSpan,
  canMerge,
  canSplitAt,
  cueEnd,
  cueIndexAt,
  cueKey,
  moveCue,
  retimeCue,
  rowOrder,
} from '@/lib/subtitle-cues';
import type { SubtitleCue } from '@/lib/subtitles';
import { snapToFrame } from '@/lib/timecode';
import { DRAG_THRESHOLD_PX, snapMs, type SnapTarget } from '@/lib/timeline-drag';
import type { SubtitleEdits } from '@/lib/use-subtitle-edits';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { Tooltip } from './Tooltip';
import { isTypingTarget } from './typing-target';

export const SUBTITLE_ROW_H = 30;
/** How wide a cue's edge can be grabbed (px), less on a narrow cue so its middle can still be. */
const EDGE_PX = 6;

/** What the editor gives the timeline for the row. */
export interface SubtitleRowSpec {
  /** The film's subtitles (GET captions), as the film shows them. */
  cues: readonly SubtitleCue[];
  edits: SubtitleEdits;
  /** The clip a cue added at `ms` would be said by, or null: nothing heard there. */
  speakerAt: (ms: number) => { clipId: string; src: string; endMs: number } | null;
}

/* ── shown or not: kept on this machine ── */

const SHOWN_KEY = 'openfilm.timeline.subtitleRow';
const shownListeners = new Set<() => void>();
let shownNow: boolean | null = null;
function readShown(): boolean {
  if (shownNow != null) return shownNow;
  try { shownNow = localStorage.getItem(SHOWN_KEY) !== '0'; } catch { shownNow = true; }
  return shownNow;
}
function setShown(on: boolean): void {
  shownNow = on;
  try { localStorage.setItem(SHOWN_KEY, on ? '1' : '0'); } catch { /* this session only */ }
  for (const fn of shownListeners) fn();
}
export function useSubtitleRowShown(): [boolean, (on: boolean) => void] {
  const on = React.useSyncExternalStore((fn) => { shownListeners.add(fn); return () => { shownListeners.delete(fn); }; }, readShown, () => true);
  return [on, setShown];
}

/**
 * The switch for the row, in the subtitle panel's Lines header: the lines edited on the timeline (timed, split,
 * merged), or not shown there. Kept on this machine.
 */
export function SubtitleRowToggle() {
  const t = useT();
  const [on, set] = useSubtitleRowShown();
  return (
    <Tooltip side="bottom" label={t(on ? 'subtitleRow.hideRow' : 'subtitleRow.showRow')}>
      <button
        type="button"
        data-subtitle-row-toggle={on ? '1' : '0'}
        onClick={() => set(!on)}
        onMouseDown={(e) => e.preventDefault()}
        aria-pressed={on}
        className="flex h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-[10.5px] font-medium outline-none transition focus-visible:ring-1 focus-visible:ring-[var(--border-strong)]"
        style={on ? { color: '#fff', background: 'var(--tl-accent)' } : { color: 'var(--text-muted)', background: 'var(--fill-tsp)' }}
      >
        <Captions size={11} aria-hidden />
        {t('subtitleRow.editOnTimeline')}
      </button>
    </Tooltip>
  );
}

/** The row's head, in the timeline's head column: its name, and a cue added at the playhead. */
export function SubtitleRowHead({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-1 border-b pl-2 pr-1" style={{ height: SUBTITLE_ROW_H, borderColor: 'var(--tl-line)' }}>
      <span className="truncate text-[10.5px] font-medium" style={{ color: 'var(--tl-text)' }}>{t('subtitleRow.name')}</span>
      <Tooltip side="bottom" label={t('subtitleRow.add')}>
        <button type="button" onClick={onAdd} onMouseDown={(e) => e.preventDefault()} aria-label={t('subtitleRow.add')}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[var(--tl-faint)] hover:bg-black/5 hover:text-[var(--tl-text)] dark:hover:bg-white/10">
          <Plus size={13} />
        </button>
      </Tooltip>
    </div>
  );
}

type Drag = { key: string; startMs: number; endMs: number; guideMs: number | null };

export interface SubtitleRowHandle {
  /** Add a cue at the playhead (the head's "+"). */
  addAtPlayhead: () => void;
}

export const SubtitleRow = React.forwardRef<SubtitleRowHandle, {
  spec: SubtitleRowSpec;
  pxPerMs: number;
  scrollLeft: number;
  /** The width of the time laid out (px). */
  width: number;
  /** The playhead now (ms). */
  playheadMs: () => number;
  snap: boolean;
  /** Where the row's drags snap besides other cues: 0, the playhead, every clip's edges. */
  snapTargets: () => SnapTarget[];
  /** Why an edit could not be done, said in the timeline's toolbar. */
  onError: (text: string) => void;
}>(function SubtitleRow({ spec, pxPerMs, scrollLeft, width, playheadMs, snap, snapTargets, onError }, ref) {
  const t = useT();
  const cues = React.useMemo(() => rowOrder(spec.cues), [spec.cues]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState<Drag | null>(null);
  /** Times an edit was sent with, shown until the lines come back. */
  const [held, setHeld] = React.useState<{ key: string; startMs: number; endMs: number } | null>(null);
  const [editing, setEditing] = React.useState<{ key: string; text: string } | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  /** The cue to select (and maybe type into) once the lines come back from an edit, by its start. */
  const [after, setAfter] = React.useState<{ startMs: number; edit: boolean } | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const targeted = React.useRef(false);
  const cuesRef = React.useRef(cues);
  cuesRef.current = cues;

  /* the lines came back: what an edit made is picked */
  React.useEffect(() => {
    if (!after) return;
    const found = cues.find((c) => Math.abs(c.startMs - after.startMs) <= 2);
    if (!found) return;
    setSelected(cueKey(found));
    if (after.edit) setEditing({ key: cueKey(found), text: found.text });
    setAfter(null);
  }, [cues, after]);
  /* the selection follows the lines: one gone is let go */
  React.useEffect(() => {
    if (selected && !cues.some((c) => cueKey(c) === selected) && !after) setSelected(null);
  }, [cues, selected, after]);

  const run = React.useCallback(async (job: Promise<string | null>, then?: { startMs: number; edit?: boolean }) => {
    const why = await job;
    setHeld(null);
    if (why) { onError(why); return; }
    if (then) setAfter({ startMs: then.startMs, edit: then.edit ?? false });
  }, [onError]);

  const msAt = (clientX: number) => {
    const box = innerRef.current?.getBoundingClientRect();
    return box && pxPerMs > 0 ? Math.max(0, (clientX - box.left) / pxPerMs) : 0;
  };

  /* ── the edits ── */
  const split = React.useCallback((cue: SubtitleCue, atMs: number) => {
    if (!canSplitAt(cue, atMs)) { onError(t('subtitleRow.splitWhere')); return; }
    void run(spec.edits.split(cue, snapToFrame(atMs)), { startMs: cue.startMs });
  }, [spec.edits, run, onError, t]);
  const merge = React.useCallback((cue: SubtitleCue) => {
    const list = cuesRef.current;
    const next = list[list.indexOf(cue) + 1];
    if (!next || !canMerge(cue, next)) return;
    void run(spec.edits.merge(cue, next), { startMs: cue.startMs });
  }, [spec.edits, run]);
  const remove = React.useCallback((cue: SubtitleCue) => {
    setSelected(null);
    void run(spec.edits.remove(cue));
  }, [spec.edits, run]);
  const addAt = React.useCallback((atMs: number) => {
    const at = snapToFrame(atMs);
    const speaker = spec.speakerAt(at);
    if (!speaker) { onError(t('subtitleRow.nothingHeard')); return; }
    const span = addSpan(cuesRef.current, at, speaker.endMs);
    if (!span) { onError(t('subtitleRow.noRoom')); return; }
    void run(spec.edits.add(speaker.clipId, speaker.src, span.startMs, span.endMs, t('subtitleRow.newText')), { startMs: span.startMs, edit: true });
  }, [spec, run, onError, t]);
  React.useImperativeHandle(ref, () => ({ addAtPlayhead: () => addAt(playheadMs()) }), [addAt, playheadMs]);
  const commitText = React.useCallback(() => {
    const now = editing;
    setEditing(null);
    if (!now) return;
    const cue = cuesRef.current.find((c) => cueKey(c) === now.key);
    if (!cue || now.text.trim() === cue.text.trim()) return;
    void run(now.text.trim() ? spec.edits.setText(cue, now.text) : spec.edits.remove(cue), { startMs: cue.startMs });
  }, [editing, spec.edits, run]);

  /* ── keys, while the row is the timeline's target ── */
  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (rowRef.current?.contains(el)) { targeted.current = true; return; }
      /* another row of the timeline pressed: it is the target now */
      if (el?.closest?.('[data-timeline] .tl-scroll')) { targeted.current = false; setSelected(null); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!targeted.current || isTypingTarget(e.target) || (e.target as Element | null)?.closest?.('[role="dialog"]')) return;
      const list = cuesRef.current;
      const picked = list.find((c) => cueKey(c) === selected);
      const mod = e.metaKey || e.ctrlKey;
      const take = () => { e.preventDefault(); e.stopPropagation(); };
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        take();
        if (e.repeat) return;
        const at = playheadMs();
        const cue = picked && canSplitAt(picked, at) ? picked : list[cueIndexAt(list, at)];
        if (cue) split(cue, at);
        return;
      }
      if (!picked || mod || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { take(); remove(picked); return; }
      if (e.key === 'Enter') { take(); setEditing({ key: cueKey(picked), text: picked.text }); return; }
      if (e.key === 'Escape') { setSelected(null); }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [selected, split, remove, playheadMs]);

  /* ── dragging: an edge, or the whole cue ── */
  const startDrag = (e: React.PointerEvent, cue: SubtitleCue, how: 'start' | 'end' | 'move') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const i = cuesRef.current.indexOf(cue);
    const key = cueKey(cue);
    setSelected(key);
    targeted.current = true;
    const fromX = e.clientX;
    const grabMs = msAt(e.clientX) - cue.startMs;
    const others = cuesRef.current.flatMap((c, j) => (j === i ? [] : [{ ms: c.startMs, kind: 'edge' as const }, { ms: cueEnd(c), kind: 'edge' as const }]));
    const targets = [...snapTargets(), ...others];
    const snapped = (ms: number) => {
      if (!snap) return { ms: snapToFrame(ms), guide: null };
      const hit = snapMs(ms, targets, pxPerMs);
      return hit.target ? { ms: hit.ms, guide: hit.ms } : { ms: snapToFrame(ms), guide: null };
    };
    let moved = false;
    let last: Drag | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - fromX) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const ms = msAt(ev.clientX);
      let next: Drag;
      if (how === 'move') {
        /* the start or the end snaps, whichever is nearer something */
        const start = snapped(ms - grabMs);
        const end = snapped(ms - grabMs + cue.durMs);
        const byEnd = !start.guide && end.guide != null;
        const at = moveCue(cuesRef.current, i, byEnd ? end.ms - cue.durMs : start.ms);
        next = { key, ...at, guideMs: byEnd ? end.guide : start.guide };
      } else {
        const s = snapped(ms);
        next = { key, ...retimeCue(cuesRef.current, i, how, s.ms), guideMs: s.guide };
      }
      last = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      const done = last;
      if (!moved || !done || (done.startMs === cue.startMs && done.endMs === cueEnd(cue))) return;
      setHeld({ key, startMs: done.startMs, endMs: done.endMs });
      void run(spec.edits.retime(cue, done.startMs, done.endMs), { startMs: done.startMs });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const openMenu = (e: React.MouseEvent, cue: SubtitleCue | null) => {
    e.preventDefault();
    e.stopPropagation();
    targeted.current = true;
    const at = playheadMs();
    if (!cue) {
      setSelected(null);
      setMenu({ x: e.clientX, y: e.clientY, items: [{ id: 'add', label: t('subtitleRow.add'), icon: <Plus size={14} />, onSelect: () => addAt(at) }] });
      return;
    }
    setSelected(cueKey(cue));
    const list = cuesRef.current;
    const next = list[list.indexOf(cue) + 1];
    setMenu({
      x: e.clientX, y: e.clientY, items: [
        { id: 'split', label: t('subtitleRow.split'), icon: <Scissors size={14} />, shortcut: shortcutHint('B', { mod: true }),
          disabled: !canSplitAt(cue, at), hint: t('subtitleRow.splitWhere'), onSelect: () => split(cue, at) },
        { id: 'merge', label: t('subtitleRow.merge'), icon: <Combine size={14} />, disabled: !canMerge(cue, next), hint: t('subtitleRow.mergeWhy'), onSelect: () => merge(cue) },
        { id: 'edit', label: t('subtitleRow.edit'), icon: <Pencil size={14} />, shortcut: '↵', onSelect: () => setEditing({ key: cueKey(cue), text: cue.text }) },
        { id: 'sep', separator: true },
        { id: 'delete', label: t('subtitleRow.delete'), icon: <Trash2 size={14} />, danger: true, shortcut: '⌫', onSelect: () => remove(cue) },
      ],
    });
  };

  return (
    <div
      ref={rowRef}
      data-subtitle-row=""
      className="relative shrink-0 overflow-hidden border-b select-none"
      style={{ height: SUBTITLE_ROW_H, background: 'var(--tl-lane)', borderColor: 'var(--tl-line)' }}
      onPointerDown={(e) => { if (e.button === 0) { setSelected(null); targeted.current = true; } }}
      onContextMenu={(e) => openMenu(e, null)}
    >
      <div ref={innerRef} className="absolute inset-y-0 left-0" style={{ width, transform: `translate3d(${-scrollLeft}px,0,0)` }}>
        {cues.map((cue) => {
          const key = cueKey(cue);
          const shown = drag?.key === key ? drag : held?.key === key ? held : { startMs: cue.startMs, endMs: cueEnd(cue) };
          const left = shown.startMs * pxPerMs;
          const w = Math.max(2, (shown.endMs - shown.startMs) * pxPerMs);
          const picked = selected === key;
          const edge = Math.min(EDGE_PX, w / 4);
          return (
            <div
              key={key}
              data-subtitle-cue={cue.startMs}
              title={cue.text}
              className="absolute top-[3px] bottom-[3px] cursor-grab overflow-hidden rounded-[3px] active:cursor-grabbing"
              style={{
                left, width: w, background: 'var(--tl-caption)',
                boxShadow: picked ? '0 0 0 1.5px var(--tl-select)' : undefined,
                zIndex: picked ? 2 : 1,
              }}
              onPointerDown={(e) => startDrag(e, cue, 'move')}
              onDoubleClick={(e) => { e.stopPropagation(); setEditing({ key, text: cue.text }); }}
              onContextMenu={(e) => openMenu(e, cue)}
            >
              <span className="pointer-events-none absolute inset-0 flex items-center truncate px-1.5 text-[10.5px] leading-none text-white/95">
                {w > 14 ? cue.text : null}
              </span>
              <span role="presentation" data-trim="start" className="absolute inset-y-0 left-0 z-[2] cursor-ew-resize" style={{ width: edge }}
                onPointerDown={(e) => startDrag(e, cue, 'start')} />
              <span role="presentation" data-trim="end" className="absolute inset-y-0 right-0 z-[2] cursor-ew-resize" style={{ width: edge }}
                onPointerDown={(e) => startDrag(e, cue, 'end')} />
            </div>
          );
        })}
        {editing ? (() => {
          const cue = cues.find((c) => cueKey(c) === editing.key);
          if (!cue) return null;
          return (
            <input
              autoFocus
              data-subtitle-edit=""
              aria-label={t('subtitleRow.edit')}
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); commitText(); }
                if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
              }}
              onBlur={commitText}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute top-[3px] z-10 h-[24px] rounded-[3px] bg-[var(--bg)] px-1.5 text-[11.5px] text-[var(--text)] outline-none ring-1 ring-[var(--tl-accent)]"
              style={{ left: cue.startMs * pxPerMs, width: Math.max(180, cue.durMs * pxPerMs) }}
            />
          );
        })() : null}
        {drag?.guideMs != null ? (
          <div aria-hidden className="pointer-events-none absolute inset-y-0 z-[3] w-px bg-[var(--tl-accent)]" style={{ left: drag.guideMs * pxPerMs }} />
        ) : null}
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  );
});
