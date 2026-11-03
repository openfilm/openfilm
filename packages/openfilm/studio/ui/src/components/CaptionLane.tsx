/**
 * A caption track's row on the timeline (SPEC §1 Captions): each cue of its WebVTT file a block of its own.
 *
 *   click, ⇧-click, ⌘-click   selects a cue, a run of cues, one more or one less
 *   drag on empty space       selects the cues it spans (a click there moves the playhead)
 *   ⌘A                        with the row the target: every cue of it
 *   drag a cue                moves it and the others selected with it; a neighbor it reaches is cut short
 *   drag a cue's edge         its start or end
 *   double-click              on a cue, types its words; on empty space, adds a cue there
 *   ⌘B, ⌫, Enter, Esc         splits the cue at the playhead, deletes the selected, types, lets go
 *
 * Every edit writes the file whole, one undo step (lib/caption-tracks). The selection is the inspector's too.
 */
import React from 'react';
import { Combine, Pencil, Plus, Scissors, Trash2 } from 'lucide-react';
import { cuePlain } from '../../../../src/captions.mjs';
import { useT } from '@/i18n';
import { hintOf } from '@/lib/keymap';
import { currentKeymap, keyAction, MAC } from '@/lib/keymap-store';
import {
  addCue, canSplit, cueRule, mergeCues, moveCues, removeCues, retimeCue, setCueText, splitCue, type Vtt, type VttCue,
} from '@/lib/caption-edits';
import { setCaptionSelection, useCaptionSelection, useCaptionTrack } from '@/lib/caption-tracks';
import { snapToFrame } from '@/lib/timecode';
import { DRAG_THRESHOLD_PX, snapMs, type SnapTarget } from '@/lib/timeline-drag';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { isTypingTarget } from './typing-target';

/** How wide a cue's edge can be grabbed (px), less on a narrow cue so its middle can still be. */
const EDGE_PX = 6;

export interface CaptionLaneProps {
  projectId: string;
  src: string;
  locked: boolean;
  hidden: boolean;
  pxPerMs: number;
  playheadMs: () => number;
  snap: boolean;
  snapTargets: () => SnapTarget[];
  /** A click on empty space: the playhead goes there. */
  onSeek: (ms: number) => void;
  /** A cue picked: the inspector shows the captions' look. */
  onPick: () => void;
  onError: (text: string) => void;
}

type Hand = { vtt: Vtt; guideMs: number | null };

export function CaptionLane({ projectId, src, locked, hidden, pxPerMs, playheadMs, snap, snapTargets, onSeek, onPick, onError }: CaptionLaneProps) {
  const t = useT();
  const { vtt, write } = useCaptionTrack(projectId, src);
  const sel = useCaptionSelection();
  const picked = React.useMemo(() => (sel?.src === src ? sel.ids : new Set<string>()), [sel, src]);
  /* while a hand moves cues: the file as it would be, drawn; then the file sent, held until it comes back */
  const [hand, setHand] = React.useState<Hand | null>(null);
  const [held, setHeld] = React.useState<Vtt | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; text: string } | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [marquee, setMarquee] = React.useState<{ from: number; to: number } | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const targeted = React.useRef(false);
  const shown = hand?.vtt ?? held ?? vtt;
  const cues = shown?.cues ?? [];
  /* the cues with a look of their own (a `::cue(#id)` rule): marked on their blocks */
  const own = React.useMemo(() => new Set(cues.filter((c) => shown && Object.keys(cueRule(shown, `::cue(#${c.id})`)).length).map((c) => c.id)), [cues, shown]);
  const vttRef = React.useRef(vtt);
  vttRef.current = vtt;
  const pickedRef = React.useRef(picked);
  pickedRef.current = picked;
  /* the file came back: what was held shows as it is */
  React.useEffect(() => { setHeld(null); }, [vtt]);

  const select = React.useCallback((ids: Iterable<string>) => setCaptionSelection({ src, ids: new Set(ids) }), [src]);
  const msAt = (clientX: number) => {
    const box = rowRef.current?.getBoundingClientRect();
    return box && pxPerMs > 0 ? Math.max(0, (clientX - box.left) / pxPerMs) : 0;
  };

  /** Send a version of the file: shown at once, written as one undo step. */
  const send = React.useCallback(async (next: Vtt, label: string) => {
    if (locked) { onError(t('timeline.trackLocked')); return false; }
    setHeld(next);
    const why = await write(next, label);
    if (why) { setHeld(null); onError(why); return false; }
    return true;
  }, [locked, write, onError, t]);

  /* ── the edits ── */
  const remove = React.useCallback((ids: ReadonlySet<string>) => {
    const now = vttRef.current;
    if (!now || !ids.size) return;
    setCaptionSelection(null);
    void send(removeCues(now, ids), 'captionTrack.stepRemove');
  }, [send]);
  const split = React.useCallback((cue: VttCue, atMs: number) => {
    const now = vttRef.current;
    const at = snapToFrame(atMs) / 1000;
    if (!now || !canSplit(cue, at)) { onError(t('subtitleRow.splitWhere')); return; }
    const done = splitCue(now, cue.id, at);
    if (done.id) void send(done.vtt, 'captionTrack.stepSplit').then((ok) => { if (ok) select([cue.id]); });
  }, [send, select, onError, t]);
  const merge = React.useCallback((a: VttCue, b: VttCue) => {
    const now = vttRef.current;
    if (now) void send(mergeCues(now, a.id, b.id), 'captionTrack.stepMerge').then((ok) => { if (ok) select([a.start <= b.start ? a.id : b.id]); });
  }, [send, select]);
  const addAt = React.useCallback((atMs: number) => {
    const now = vttRef.current;
    if (!now) return;
    const made = addCue(now, snapToFrame(atMs) / 1000, t('subtitleRow.newText'));
    if (!made) { onError(t('subtitleRow.noRoom')); return; }
    void send(made.vtt, 'captionTrack.stepAdd').then((ok) => {
      if (!ok) return;
      select([made.id]);
      setEditing({ id: made.id, text: t('subtitleRow.newText') });
    });
  }, [send, select, onError, t]);
  const commitText = React.useCallback(() => {
    const now = editing;
    setEditing(null);
    const file = vttRef.current;
    if (!now || !file) return;
    const cue = file.cues.find((c) => c.id === now.id);
    if (!cue || now.text.trim() === cuePlain(cue.text).trim()) return;
    void send(now.text.trim() ? setCueText(file, cue.id, now.text.trim()) : removeCues(file, new Set([cue.id])), 'captionTrack.stepText');
  }, [editing, send]);

  /* ── keys, while the row is the timeline's target ── */
  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (rowRef.current?.contains(el)) { targeted.current = true; return; }
      /* the inspector keeps the selection; another row of the timeline pressed takes it */
      if (el?.closest?.('[data-timeline] .tl-scroll, [data-timeline] [data-subtitle-row]')) { targeted.current = false; if (pickedRef.current.size) setCaptionSelection(null); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!targeted.current || isTypingTarget(e.target) || (e.target as Element | null)?.closest?.('[role="dialog"]')) return;
      const now = vttRef.current;
      if (!now) return;
      const take = () => { e.preventDefault(); e.stopPropagation(); };
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') { take(); select(now.cues.map((c) => c.id)); onPick(); return; }
      const action = keyAction(e);
      const ids = pickedRef.current;
      if (action === 'split') {
        take();
        if (e.repeat) return;
        const at = playheadMs();
        const cue = now.cues.find((c) => ids.has(c.id) && canSplit(c, at / 1000)) ?? now.cues.find((c) => c.start * 1000 <= at && at < c.end * 1000);
        if (cue) split(cue, at);
        return;
      }
      if (!ids.size) return;
      if (action === 'remove' || action === 'ripple-delete') { take(); remove(ids); return; }
      if (mod || e.altKey) return;
      if (e.key === 'Enter' && ids.size === 1) {
        const cue = now.cues.find((c) => ids.has(c.id));
        if (cue) { take(); setEditing({ id: cue.id, text: cuePlain(cue.text) }); }
        return;
      }
      if (e.key === 'Escape') setCaptionSelection(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [select, split, remove, playheadMs, onPick]);

  /* ── pressing a cue: select, then move or stretch ── */
  const press = (e: React.PointerEvent, cue: VttCue, how: 'start' | 'end' | 'move') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    targeted.current = true;
    const file = vttRef.current;
    if (!file) return;
    const ordered = file.cues;
    let ids = new Set(pickedRef.current);
    if (e.shiftKey && ids.size) {
      const at = ordered.findIndex((c) => c.id === cue.id);
      const anchors = ordered.map((c, i) => (ids.has(c.id) ? i : -1)).filter((i) => i >= 0);
      const near = anchors.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a));
      for (let i = Math.min(at, near); i <= Math.max(at, near); i++) ids.add(ordered[i]!.id);
    } else if (e.metaKey || e.ctrlKey) {
      if (ids.has(cue.id)) ids.delete(cue.id); else ids.add(cue.id);
      select(ids);
      onPick();
      return;
    } else if (!ids.has(cue.id) || how !== 'move') ids = new Set([cue.id]);
    select(ids);
    onPick();
    if (locked) return;
    const fromX = e.clientX;
    const grabMs = msAt(e.clientX);
    const others = ordered.filter((c) => !ids.has(c.id)).flatMap((c) => [{ ms: c.start * 1000, kind: 'edge' as const }, { ms: c.end * 1000, kind: 'edge' as const }]);
    const targets = [...snapTargets(), ...others];
    const snapped = (ms: number) => {
      if (!snap) return { ms: snapToFrame(ms), guide: null };
      const hit = snapMs(ms, targets, pxPerMs);
      return hit.target ? { ms: hit.ms, guide: hit.ms } : { ms: snapToFrame(ms), guide: null };
    };
    let moved = false;
    let last: Vtt | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - fromX) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const ms = msAt(ev.clientX);
      let next: Hand;
      if (how === 'move') {
        /* the grabbed cue's start or end snaps, whichever is nearer something; the others keep their distance */
        const startMs = cue.start * 1000 + (ms - grabMs);
        const a = snapped(startMs), b = snapped(startMs + (cue.end - cue.start) * 1000);
        const byEnd = !a.guide && b.guide != null;
        const to = byEnd ? b.ms - (cue.end - cue.start) * 1000 : a.ms;
        next = { vtt: moveCues(file, ids, (to - cue.start * 1000) / 1000), guideMs: byEnd ? b.guide : a.guide };
      } else {
        const s = snapped(ms);
        next = { vtt: retimeCue(file, cue.id, how, s.ms / 1000), guideMs: s.guide };
      }
      last = next.vtt;
      setHand(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setHand(null);
      if (moved && last) void send(last, how === 'move' ? 'captionTrack.stepMove' : 'captionTrack.stepTime');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /* ── pressing empty space: a box over the cues, or (a click) the playhead there ── */
  const pressEmpty = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    targeted.current = true;
    const fromX = e.clientX;
    const fromMs = msAt(e.clientX);
    const keep = e.shiftKey || e.metaKey || e.ctrlKey ? new Set(pickedRef.current) : new Set<string>();
    let boxing = false;
    const move = (ev: PointerEvent) => {
      if (!boxing && Math.abs(ev.clientX - fromX) < DRAG_THRESHOLD_PX) return;
      boxing = true;
      const toMs = msAt(ev.clientX);
      const lo = Math.min(fromMs, toMs), hi = Math.max(fromMs, toMs);
      setMarquee({ from: lo, to: hi });
      select([...keep, ...(vttRef.current?.cues ?? []).filter((c) => c.end * 1000 > lo && c.start * 1000 < hi).map((c) => c.id)]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setMarquee(null);
      if (boxing) { if (pickedRef.current.size) onPick(); return; }
      if (!keep.size) setCaptionSelection(null);
      onSeek(fromMs);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const openMenu = (e: React.MouseEvent, cue: VttCue | null) => {
    e.preventDefault();
    e.stopPropagation();
    targeted.current = true;
    const at = playheadMs();
    const file = vttRef.current;
    if (!file) return;
    if (!cue) {
      const here = msAt(e.clientX);
      setMenu({ x: e.clientX, y: e.clientY, items: [{ id: 'add', label: t('captionTrack.addHere'), icon: <Plus size={14} />, disabled: locked, onSelect: () => addAt(here) }] });
      return;
    }
    const ids = picked.has(cue.id) ? picked : new Set([cue.id]);
    if (!picked.has(cue.id)) select(ids);
    const list = file.cues;
    const mine = list.filter((c) => ids.has(c.id));
    const pair = mine.length === 2 ? mine : [cue, list[list.indexOf(cue) + 1]].filter((c): c is VttCue => Boolean(c));
    setMenu({
      x: e.clientX, y: e.clientY, items: [
        { id: 'split', label: t('subtitleRow.split'), icon: <Scissors size={14} />, shortcut: hintOf(currentKeymap(), 'split', MAC),
          disabled: locked || !canSplit(cue, at / 1000), hint: t('subtitleRow.splitWhere'), onSelect: () => split(cue, at) },
        { id: 'merge', label: t(mine.length === 2 ? 'captionTrack.mergeTwo' : 'subtitleRow.merge'), icon: <Combine size={14} />, disabled: locked || pair.length < 2, onSelect: () => merge(pair[0]!, pair[1]!) },
        { id: 'edit', label: t('subtitleRow.edit'), icon: <Pencil size={14} />, shortcut: '↵', disabled: locked || ids.size !== 1, onSelect: () => setEditing({ id: cue.id, text: cuePlain(cue.text) }) },
        { id: 'sep', separator: true },
        { id: 'delete', label: ids.size > 1 ? t('captionTrack.deleteN').replace('{n}', String(ids.size)) : t('subtitleRow.delete'), icon: <Trash2 size={14} />, danger: true,
          disabled: locked, shortcut: hintOf(currentKeymap(), 'remove', MAC), onSelect: () => remove(ids) },
      ],
    });
  };

  return (
    <div
      ref={rowRef}
      data-caption-lane={src}
      className="absolute inset-0 select-none"
      style={{ opacity: hidden ? 0.5 : 1 }}
      onPointerDown={pressEmpty}
      onDoubleClick={(e) => { if (!locked && e.target === e.currentTarget) addAt(msAt(e.clientX)); }}
      onContextMenu={(e) => openMenu(e, null)}
    >
      {cues.map((cue) => {
        const left = cue.start * 1000 * pxPerMs;
        const w = Math.max(2, (cue.end - cue.start) * 1000 * pxPerMs);
        const on = picked.has(cue.id);
        const edge = Math.min(EDGE_PX, w / 4);
        const words = cuePlain(cue.text);
        return (
          <div
            key={cue.id}
            data-caption-cue={cue.id}
            title={words}
            className="absolute top-[3px] bottom-[3px] cursor-grab overflow-hidden rounded-[3px] active:cursor-grabbing"
            style={{ left, width: w, background: 'var(--tl-caption)', boxShadow: on ? '0 0 0 1.5px var(--tl-select)' : undefined, zIndex: on ? 2 : 1 }}
            onPointerDown={(e) => press(e, cue, 'move')}
            onDoubleClick={(e) => { e.stopPropagation(); if (!locked) setEditing({ id: cue.id, text: words }); }}
            onContextMenu={(e) => openMenu(e, cue)}
          >
            <span className="pointer-events-none absolute inset-0 flex items-center truncate px-1.5 text-[10.5px] leading-none text-white/95">{w > 14 ? words : null}</span>
            {own.has(cue.id) && w > 10 ? <span aria-hidden data-caption-own="" className="pointer-events-none absolute right-[3px] top-[3px] h-[5px] w-[5px] rounded-full bg-[#ffd400]" /> : null}
            <span role="presentation" data-trim="start" className="absolute inset-y-0 left-0 z-[2] cursor-ew-resize" style={{ width: edge }} onPointerDown={(e) => press(e, cue, 'start')} />
            <span role="presentation" data-trim="end" className="absolute inset-y-0 right-0 z-[2] cursor-ew-resize" style={{ width: edge }} onPointerDown={(e) => press(e, cue, 'end')} />
          </div>
        );
      })}
      {editing ? (() => {
        const cue = cues.find((c) => c.id === editing.id);
        if (!cue) return null;
        return (
          <input
            autoFocus
            data-caption-edit=""
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
            className="absolute top-[3px] z-10 h-[calc(100%-6px)] rounded-[3px] bg-[var(--bg)] px-1.5 text-[11.5px] text-[var(--text)] outline-none ring-1 ring-[var(--tl-accent)]"
            style={{ left: cue.start * 1000 * pxPerMs, width: Math.max(180, (cue.end - cue.start) * 1000 * pxPerMs) }}
          />
        );
      })() : null}
      {marquee ? (
        <div aria-hidden className="pointer-events-none absolute inset-y-[2px] z-[4] rounded-[2px] border border-[var(--tl-select)] bg-[color-mix(in_srgb,var(--tl-select)_15%,transparent)]"
          style={{ left: marquee.from * pxPerMs, width: Math.max(1, (marquee.to - marquee.from) * pxPerMs) }} />
      ) : null}
      {hand?.guideMs != null ? <div aria-hidden className="pointer-events-none absolute inset-y-0 z-[3] w-px bg-[var(--tl-accent)]" style={{ left: hand.guideMs * pxPerMs }} /> : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
