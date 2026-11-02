/**
 * The Layers panel: what is on the picture at the playhead as layers, the top one first. Each picture clip shown is a
 * row; a page clip opens into its layers, each level in the order the page draws it. A row selects its layer on the
 * picture; ⌘-clicked (Ctrl) it adds it to what is selected there or takes it away, Shift-clicked it selects the rows
 * shown from the last one clicked to it (and the picture's selection opens the rows down to each layer of it). Rows
 * selected one after another are one block, and what a selected layer holds is tinted with it. Its eye hides it, its
 * lock keeps it from being moved and its bin deletes it (lib/layer-delete; Delete or Backspace does too, for the layer
 * in hand on the picture, which a row's click makes it); its right-click takes its layer (a clip's row: the clip) in
 * hand and opens the picture's own menu for it, so the two menus are one; dragged up or down its own level, or into the
 * level of a row around it (which then moves, with all it holds: CSS restacks only within a level), it is restacked
 * (z-index overrides, studio/server/stage.js `restack`). Nothing is kept here: the tree is read from the pages each
 * time they may have changed, and every change is an override of the page clip in film.html.
 */
import React from 'react';
import {
  ChevronRight, Eye, EyeOff, Film, Globe, Image as ImageIcon, Lock, LockOpen, Shapes, Square, SquareDashed, Trash2, Type, X,
} from 'lucide-react';
import { useT } from '@/i18n';
import {
  layerKey, layerLines, movedOrder, moverFor, openTo, rowsBetween, sameTree, selectionTones,
  type LayerClip, type LayerLine, type LayerRow, type LayerRowKind, type RowTone,
} from '@/lib/layers-tree';
import type { StageArrangeResult } from './stage-menu';
import { PANE_BAR, PANE_BTN, PANE_ICON, PANE_TITLE } from './dock-pane-bar';
import { Tooltip } from './Tooltip';

const ROW_H = 26;
const INDENT = 12;
/* how often the tree is read again while the film plays (layers come and go with the picture) */
const PLAYING_EVERY_MS = 400;

const KIND_ICON: Record<LayerRowKind, typeof Type> = { text: Type, image: ImageIcon, shape: Shapes, box: Square, group: SquareDashed };

export interface LayersPanelProps {
  /** Asks the picture's stage (studio/server/stage.js ops). */
  ask: <T>(op: string, args?: object) => Promise<T | null>;
  timeMs: number;
  playing: boolean;
  /** Changes with film.html: the pages may have new overrides. */
  filmKey: unknown;
  /** A clip by its film.html id: how the timeline names it, and its place. */
  clipOf: (clipId: string) => { label: string; kind: string; loc?: string } | null;
  /** The layers in hand on the picture: one, several selected together, or none. */
  selected: readonly { clipId?: string; loc: string | null }[];
  /** The clips selected (film.html places). */
  selectedClipLocs: readonly string[];
  /** Select these layers together; `toggle`: each added to what is selected, or taken away (a ⌘-click). */
  onSelectLayers: (layers: readonly { clipId: string; loc: string }[], toggle: boolean) => void;
  onSelectClip: (clipLoc: string) => void;
  /** The pointer is on a row (its layer outlined on the picture), or left them (null). */
  onPoint: (target: { clipId: string; loc: string } | null) => void;
  /** The eye or the lock of a row. */
  onToggle: (clipId: string, row: LayerRow, what: 'hidden' | 'locked') => void;
  /** A row's bin: its layer deleted. */
  onDelete: (clipId: string, row: LayerRow) => void;
  /** A row's right-click at `at` (client px): the picture's menu for its layer (no `loc`: its clip), taken in hand. */
  onMenu: (target: { clipId: string; loc?: string }, at: { x: number; y: number }) => void;
  /** A level restacked: the overrides to write in the clip, or why nothing was (a message). */
  onRestack: (clipId: string, edits: StageArrangeResult['edits']) => void;
  onNotify: (message: string) => void;
  width: number;
  onClose: () => void;
}

export function LayersPanel(p: LayersPanelProps) {
  const t = useT();
  const [clips, setClips] = React.useState<LayerClip[] | null>(null);
  const clipsRef = React.useRef(clips);
  clipsRef.current = clips;
  /* the lines the person opened or closed (lib/layers-tree: which start open) */
  const [toggled, setToggled] = React.useState<ReadonlySet<string>>(() => new Set());
  const askRef = React.useRef(p.ask);
  askRef.current = p.ask;

  /* the tree, read again when the picture may have changed: a seek, the film edited, a page that came on drawn (it
     is in the tree only then; the picture says so), and while it plays */
  const read = React.useCallback(async () => {
    const next = await askRef.current<LayerClip[]>('tree');
    if (next && !sameTree(clipsRef.current, next)) setClips(next);
    return next != null;
  }, []);
  React.useEffect(() => {
    let live = true;
    let timer = 0;
    const again = async () => {
      const ok = await read();
      /* the picture not ready yet: asked again soon */
      if (live && !ok) timer = window.setTimeout(() => void again(), 500);
    };
    timer = window.setTimeout(() => void again(), 60);
    return () => { live = false; window.clearTimeout(timer); };
  }, [read, p.timeMs, p.filmKey]);
  React.useEffect(() => {
    if (!p.playing) return undefined;
    const id = window.setInterval(() => void read(), PLAYING_EVERY_MS);
    return () => window.clearInterval(id);
  }, [read, p.playing]);

  /* the layers picked on the picture: the rows down to each opened, and the first scrolled to */
  const list = React.useRef<HTMLDivElement | null>(null);
  const picked = p.selected.flatMap((s) => (s.clipId && s.loc ? [layerKey(s.clipId, s.loc)] : []));
  const pickedKey = picked.join('\n');
  React.useEffect(() => {
    const keys = p.selected.flatMap((s) => (s.clipId && s.loc ? [{ clipId: s.clipId, loc: s.loc }] : []));
    if (!clips || !keys.length) return;
    setToggled((cur) => keys.reduce((open, s) => openTo(clips, open, s.clipId, s.loc), cur));
    requestAnimationFrame(() => {
      list.current?.querySelector(`[data-layer-key="${CSS.escape(layerKey(keys[0]!.clipId, keys[0]!.loc))}"]`)?.scrollIntoView({ block: 'nearest' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, pickedKey]);

  const lines = React.useMemo(() => (clips ? layerLines(clips, toggled) : []), [clips, toggled]);
  const toggleOpen = (line: LayerLine) => {
    setToggled((cur) => { const n = new Set(cur); if (n.has(line.key)) n.delete(line.key); else n.add(line.key); return n; });
  };

  /* ── dragging a row: up or down its own level, or into the level of a row around it (moverFor) ── */
  const [drag, setDragState] = React.useState<{ line: LayerLine; mover: LayerLine; to: number; y: number } | null>(null);
  /* kept in step at once: pointer events can come faster than renders, and the release must see the last move */
  const dragRef = React.useRef(drag);
  const setDrag = (next: typeof drag) => { dragRef.current = next; setDragState(next); };
  const press = React.useRef<{ line: LayerLine; x: number; y: number; id: number } | null>(null);
  /** Where a pointer at `y` (client px) drops the dragged row: the line that moves, the gap of its level, its line. */
  const dropAt = (dragged: LayerLine, y: number): { mover: LayerLine; to: number; y: number } | null => {
    const box = list.current;
    if (!box || !lines.length) return null;
    const top = box.getBoundingClientRect().top - box.scrollTop;
    const over = lines[Math.max(0, Math.min(lines.length - 1, Math.floor((y - top) / ROW_H)))]!;
    const mover = moverFor(lines, dragged, over);
    if (!mover) return null;
    const own = lines.filter((l) => l.parentKey === mover.parentKey && l.row);
    const rowTop = (l: LayerLine) => lines.indexOf(l) * ROW_H;
    let to = own.length;
    for (const [i, l] of own.entries()) {
      if (y < top + rowTop(l) + ROW_H / 2) { to = i; break; }
    }
    /* below the last row of the level: under everything inside it */
    const lastOf = (l: LayerLine) => {
      let j = lines.indexOf(l);
      while (j + 1 < lines.length && lines[j + 1]!.depth > l.depth) j += 1;
      return j;
    };
    const lineY = to < own.length ? rowTop(own[to]!) : (lastOf(own[own.length - 1]!) + 1) * ROW_H;
    return { mover, to, y: lineY };
  };
  const endDrag = (commit: boolean) => {
    const d = dragRef.current;
    setDrag(null);
    press.current = null;
    if (!commit || !d?.mover.row) return;
    const order = movedOrder(d.mover.siblings, d.mover.index, d.to);
    if (!order) return;
    const clipId = d.mover.clipId;
    void p.ask<StageArrangeResult>('restack', { order, moved: d.mover.row.branch }).then((r) => {
      if (!r) { p.onNotify(t('layers.restackFailed')); return; }
      if (!r.edits.length) { if (r.reason === 'blocked') p.onNotify(t('stageMenu.arrangeBlocked')); return; }
      p.onRestack(clipId, r.edits);
    });
  };
  /* dropped in an outer level, the row around it moves: said beside the line, with what moves */
  const groupMoved = drag && drag.mover !== drag.line ? drag.mover.row?.label ?? null : null;

  const isSelected = (line: LayerLine) => {
    if (!line.row) {
      const loc = p.clipOf(line.clipId)?.loc;
      return !p.selected.length && Boolean(loc && p.selectedClipLocs.includes(loc));
    }
    return picked.includes(layerKey(line.clipId, line.row.loc));
  };
  /* each line selected ('on'), inside one selected ('in': what it holds, tinted with it), or neither */
  const tones = selectionTones(lines, isSelected);

  /* the row a Shift-click selects from: the last one clicked, else the last layer selected (on the picture too) */
  const anchor = React.useRef<string | null>(null);
  const clickRow = (line: LayerLine, e: React.MouseEvent) => {
    if (!line.row) {
      const loc = p.clipOf(line.clipId)?.loc;
      if (loc) p.onSelectClip(loc);
      return;
    }
    const add = e.metaKey || e.ctrlKey;
    const from = e.shiftKey ? lines.find((l) => l.key === (anchor.current && picked.includes(anchor.current) ? anchor.current : picked[picked.length - 1])) : null;
    if (from) {
      /* the rows shown between the two (a closed group's are not), with ⌘ (Ctrl) added to what is selected */
      const range = rowsBetween(lines, from, line).map((l) => ({ clipId: l.clipId, loc: l.row!.loc }));
      const kept = add ? p.selected.flatMap((s) => (s.clipId && s.loc && !range.some((r) => r.clipId === s.clipId && r.loc === s.loc) ? [{ clipId: s.clipId, loc: s.loc }] : [])) : [];
      p.onSelectLayers([...kept, ...range], false);
      return;
    }
    anchor.current = line.key;
    p.onSelectLayers([{ clipId: line.clipId, loc: line.row.loc }], add || e.shiftKey);
  };

  return (
    <div data-layers-panel className="relative flex h-full min-h-0 flex-col" style={{ width: p.width }}
      onPointerLeave={() => p.onPoint(null)}>
      <div className={PANE_BAR}>
        <span className={`${PANE_TITLE} px-1`}>{t('layers.title')}</span>
        <span className="min-w-0 flex-1" />
        <Tooltip label={t('layers.hidePane')} side="bottom">
          <button type="button" onClick={p.onClose} aria-label={t('layers.hidePane')} className={PANE_BTN}>
            <X size={PANE_ICON} />
          </button>
        </Tooltip>
      </div>
      {clips && !clips.length ? (
        <p className="px-4 pt-6 text-center text-[12px] leading-relaxed text-[var(--text-muted)]">{t('layers.empty')}</p>
      ) : null}
      <div ref={list} role="tree" aria-label={t('layers.title')}
        className="relative min-h-0 flex-1 select-none overflow-y-auto overscroll-contain pb-4"
        onPointerMove={(e) => {
          const pr = press.current;
          if (!pr || pr.id !== e.pointerId) return;
          /* let go outside the panel before a drag began */
          if (!(e.buttons & 1)) { press.current = null; return; }
          const dragging = dragRef.current;
          if (!dragging) {
            if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < 4) return;
            /* held from here on (not at the press: a click must still reach its row) */
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          const drop = dropAt(pr.line, e.clientY);
          if (drop) setDrag({ line: pr.line, ...drop });
          else if (!dragging) setDrag({ line: pr.line, mover: pr.line, to: pr.line.index, y: lines.indexOf(pr.line) * ROW_H });
        }}
        onPointerUp={(e) => { if (press.current?.id === e.pointerId) endDrag(Boolean(dragRef.current)); }}
        onPointerCancel={() => endDrag(false)}>
        <div className="relative" style={{ height: lines.length * ROW_H }}>
          {lines.map((line, i) => (
            <LayerLineRow key={line.key} line={line} top={i * ROW_H} t={t} clipOf={p.clipOf}
              tone={tones[i]!} joinUp={Boolean(tones[i - 1])} joinDown={Boolean(tones[i + 1])}
              dragging={drag?.line.key === line.key || drag?.mover.key === line.key}
              onToggleOpen={() => toggleOpen(line)}
              onPress={(e) => {
                if (e.button !== 0 || !line.row) return;
                press.current = { line, x: e.clientX, y: e.clientY, id: e.pointerId };
              }}
              onClick={(e) => { if (!dragRef.current) clickRow(line, e); }}
              onPoint={() => p.onPoint(line.row ? { clipId: line.clipId, loc: line.row.loc } : null)}
              onToggle={(what) => { if (line.row) p.onToggle(line.clipId, line.row, what); }}
              onDelete={() => { if (line.row) p.onDelete(line.clipId, line.row); }}
              onMenu={(e) => {
                e.preventDefault();
                p.onMenu({ clipId: line.clipId, ...(line.row ? { loc: line.row.loc } : {}) }, { x: e.clientX, y: e.clientY });
              }} />
          ))}
          {drag ? (
            <div aria-hidden className="pointer-events-none absolute right-2 h-0.5 rounded-full bg-[var(--accent)]"
              style={{ top: drag.y - 1, left: 8 + drag.mover.depth * INDENT }}>
              {groupMoved ? (
                <span className="absolute right-0 top-1 max-w-[80%] truncate rounded bg-[var(--accent)] px-1.5 py-px text-[11px] text-[var(--bg)]">
                  {t('layers.movesGroup').replace('{name}', groupMoved)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LayerLineRow({ line, top, t, clipOf, tone, joinUp, joinDown, dragging, onToggleOpen, onPress, onClick, onPoint, onToggle, onDelete, onMenu }: {
  line: LayerLine;
  top: number;
  t: ReturnType<typeof useT>;
  clipOf: LayersPanelProps['clipOf'];
  /** Selected, inside a selected one, or neither. */
  tone: RowTone;
  /** The line above (below) is in the selection too: one block with it, rounded only at the block's ends. */
  joinUp: boolean;
  joinDown: boolean;
  dragging: boolean;
  onToggleOpen: () => void;
  onPress: (e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onPoint: () => void;
  onToggle: (what: 'hidden' | 'locked') => void;
  onDelete: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const row = line.row;
  const clip = row ? null : clipOf(line.clipId);
  const Icon = row ? KIND_ICON[row.kind] : clip?.kind === 'mg' ? Globe : clip?.kind === 'video' ? Film : ImageIcon;
  const label = row ? row.label : (clip?.label ?? line.clipId);
  /* not drawn now, or hidden by the person: the row is there, dimmed (it can be shown or picked from here) */
  const dim = Boolean(row && (row.off || row.hidden));
  const selected = tone === 'on';
  const fill = selected ? 'bg-[var(--layer-selected)] text-[var(--text)]'
    : tone === 'in' ? 'bg-[var(--layer-selected-in)] text-[var(--text)] hover:shadow-[inset_0_0_0_1px_var(--layer-hover-line)]'
      : 'text-[var(--text-dim)] hover:shadow-[inset_0_0_0_1px_var(--layer-hover-line)]';
  const corners = tone ? `${joinUp ? '' : 'rounded-t-[5px]'} ${joinDown ? '' : 'rounded-b-[5px]'}` : 'rounded-[5px]';
  const flag = (what: 'hidden' | 'locked', on: boolean, OnIcon: typeof Eye, OffIcon: typeof Eye, onLabel: string, offLabel: string) => (
    <Tooltip label={on ? onLabel : offLabel} side="bottom">
      <button type="button" aria-label={on ? onLabel : offLabel} aria-pressed={on}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggle(what); }}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${on ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}>
        {on ? <OnIcon size={12} /> : <OffIcon size={12} />}
      </button>
    </Tooltip>
  );
  return (
    <div role="treeitem" aria-level={line.depth + 1} aria-selected={selected} aria-expanded={line.canOpen ? line.open : undefined}
      data-layer-key={line.key}
      data-layer-tone={tone ?? undefined}
      className={`group absolute inset-x-1 flex items-center gap-1 pr-1 text-[12.5px] ${corners} ${fill} ${dragging ? 'opacity-50' : ''}`}
      style={{ top, height: ROW_H, paddingLeft: 4 + line.depth * INDENT }}
      title={row?.off && !row.hidden ? t('layers.notNow') : undefined}
      onPointerDown={onPress} onClick={onClick} onPointerEnter={onPoint} onContextMenu={onMenu}>
      {line.canOpen ? (
        <button type="button" aria-label={t(line.open ? 'layers.collapse' : 'layers.expand')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleOpen(); }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--text-faint)] hover:text-[var(--text)]">
          <ChevronRight size={12} className={`transition-transform ${line.open ? 'rotate-90' : ''}`} />
        </button>
      ) : <span className="w-4 shrink-0" />}
      <Icon size={13} className={`shrink-0 ${dim ? 'opacity-40' : tone ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`} aria-hidden />
      <span className={`min-w-0 flex-1 truncate ${row ? '' : 'font-medium text-[var(--text)]'} ${dim ? 'opacity-45' : ''}`}>{label}</span>
      {row && !row.locked ? (
        <Tooltip label={t('layers.delete')} side="bottom">
          <button type="button" aria-label={t('layers.delete')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-dim)] opacity-0 hover:bg-[var(--bg-hover)] hover:text-[var(--err)] focus-visible:opacity-100 group-hover:opacity-100">
            <Trash2 size={12} />
          </button>
        </Tooltip>
      ) : null}
      {row ? flag('locked', row.locked, Lock, LockOpen, t('layers.unlock'), t('layers.lock')) : null}
      {row ? flag('hidden', row.hidden, EyeOff, Eye, t('layers.show'), t('layers.hide')) : null}
    </div>
  );
}
