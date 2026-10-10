/**
 * The stage's context menus (FilmStageSelect asks for one on a right-click): as in Figma, what was hit decides the
 * list. A layer inside a page, a whole clip (the same actions as its block on the timeline), several layers boxed
 * together; and after them on every menu, Show… / Unlock… for the layers that cannot be clicked any more. Items that
 * cannot run stay, grayed, with the reason.
 *
 * Layer changes are overrides (the editor writes film.html); the clip's actions are the editor's, passed in.
 */
import {
  BringToFront, ClipboardPaste, Copy as CopyIcon, CopyPlus, CornerLeftUp, Download, Eye, EyeOff, Layers, Lock,
  RotateCcw, Scissors, SendToBack, Trash2, Type as TypeIcon, Unlock,
} from 'lucide-react';

import type { ContextMenuEntry } from '@/components/ContextMenu';
import type { FilmDoc } from '@/lib/film';
import type { OverrideGeometry } from '@/lib/film-overrides';
import { shortcutHint } from '@/lib/shortcut-hint';
import type { AlignEdge } from '@/lib/stage-gesture';
import { recoverableLayers, type RecoverableLayer } from '@/lib/stage-layers';
import type { StageElement } from '@/lib/stage-types';

/** What the stage itself does for its menu, and where it was opened. */
/**
 * Bringing a layer to the front of what it overlaps or sending it to the back (studio/server/stage.js `arrange`),
 * worked out when asked: the overrides to write (a target in the page and its style), or why there is nothing to do.
 */
export interface StageArrangeResult {
  edits: Array<{ target: { at: string; n?: number }; style: Record<string, string | number> }>;
  reason: 'alone' | 'already' | 'blocked' | null;
}
export type StageArrange = (to: 'front' | 'back') => Promise<StageArrangeResult | null>;

export interface StageMenuContext {
  /** Type the line in place; only for a layer with words. */
  editText?: () => void;
  /** Bring the layer to the front of what it overlaps / send it to the back (see StageArrange); null when it cannot be. */
  arrange: StageArrange | null;
  /** Where the menu was opened (stage overlay px). */
  at: { x: number; y: number };
  /** The layers boxed or Shift-clicked together (two or more). */
  multi?: readonly StageElement[];
  /** Line them up with an edge / middle of their union box (one save). */
  align?: (edge: AlignEdge) => void;
  /** The layer (or a layer around it) is locked. */
  locked?: boolean;
}

/** A whole clip's actions: the editor's (the timeline runs the same ones), for the clip at `clipLoc`. */
export interface StageClipActions {
  /** Whether the clip's track is locked: nothing that changes the clip runs, as on the timeline. */
  isLocked(clipLoc: string): boolean;
  /** Whether the playhead is over the clip (Split cuts there). */
  canSplit(clipLoc: string): boolean;
  split(clipLoc: string): void;
  copy(clipLoc: string): void;
  /** Whether anything was copied. */
  canPaste(): boolean;
  /** Paste at the playhead on the clip's track. */
  paste(clipLoc: string): void;
  /** A copy right after it on the same track. */
  duplicate(clipLoc: string): void;
  /** Its track to the top / bottom of the stack. */
  bringToFront(clipLoc: string): void;
  sendToBack(clipLoc: string): void;
  /** Back to where it lands by default (its box removed). */
  resetTransform(clipLoc: string): void;
  exportClip?(clipId: string): void;
  remove(clipLoc: string): void;
}

export interface StageMenuActions {
  /** A layer's override changed (`null` removes it: reset). */
  editOverride(element: StageElement, patch: OverrideGeometry | null): void;
  /** Several layers' overrides at once: one save, one undo step. */
  editOverrides(list: ReadonlyArray<{ element: StageElement; patch: OverrideGeometry | null }>): void;
  /** Select the layer at `loc` in the clip at `clipLoc` (a parent). */
  selectParent(loc: string, clipLoc?: string): void;
  /** Select the whole clip (as on the timeline). */
  selectClip(clipLoc: string): void;
  /** Say something short to the person (why an action did nothing). */
  notify?(message: string): void;
  /** The whole clip's actions; without them a clip's menu is empty. */
  clip?: StageClipActions;
}

type T = (path: string) => string;

/** Entries with separators only between groups (never first, last or twice). */
function list() {
  const out: ContextMenuEntry[] = [];
  let n = 0;
  return {
    out,
    push: (entry: ContextMenuEntry) => out.push(entry),
    sep: () => { if (out.length && !('separator' in out[out.length - 1]!)) out.push({ id: `sep-${n++}`, separator: true }); },
    done: () => { while (out.length && 'separator' in out[out.length - 1]!) out.pop(); return out; },
  };
}

export function stageMenu(el: StageElement, ctx: StageMenuContext, actions: StageMenuActions, t: T): readonly ContextMenuEntry[] {
  const m = list();
  const lockKeys = shortcutHint('L', { mod: true, shift: true });
  const hideKeys = shortcutHint('H', { mod: true, shift: true });

  /* several layers together (boxed, Shift-clicked) */
  if (ctx.multi && ctx.multi.length > 1) {
    const many = ctx.multi;
    const allHidden = many.every((x) => x.override?.style?.visibility === 'hidden');
    const allLocked = many.every((x) => x.override?.lock);
    if (ctx.align) {
      const align = ctx.align;
      m.push({
        id: 'align', label: t('stageMenu.align'), icon: <Layers size={14} />,
        submenu: ([
          ['left', 'inspector.alignLeft'], ['hcenter', 'inspector.alignHCenter'], ['right', 'inspector.alignRight'],
          ['top', 'inspector.alignTop'], ['vcenter', 'inspector.alignVCenter'], ['bottom', 'inspector.alignBottom'],
        ] as const).map(([edge, key]) => ({ id: `align-${edge}`, label: t(key), onSelect: () => align(edge) })),
      });
    }
    m.push({
      id: 'hide', label: allHidden ? t('stageMenu.showAll') : t('stageMenu.hideAll'), icon: allHidden ? <Eye size={14} /> : <EyeOff size={14} />, shortcut: hideKeys,
      onSelect: () => actions.editOverrides(many.map((x) => ({ element: x, patch: { style: { visibility: allHidden ? null : 'hidden' } } }))),
    });
    m.push({
      id: 'lock', label: allLocked ? t('stageMenu.unlock') : t('stageMenu.lock'), icon: allLocked ? <Unlock size={14} /> : <Lock size={14} />, shortcut: lockKeys,
      onSelect: () => actions.editOverrides(many.map((x) => ({ element: x, patch: { lock: !allLocked } }))),
    });
    return m.done();
  }

  /* a whole clip */
  if (el.kind === 'clip' || el.isMgOuter) {
    const clipLoc = el.clipLoc;
    const clip = actions.clip;
    if (!clip || !clipLoc) return [];
    /* a locked track's clips can be copied and exported, nothing else (the timeline's own rule) */
    const trackLocked = clip.isLocked(clipLoc);
    const lockedHint = t('timeline.trackLocked');
    m.push({
      id: 'split', label: t('timeline.menuSplitHere'), icon: <Scissors size={14} />, disabled: trackLocked || !clip.canSplit(clipLoc),
      hint: trackLocked ? lockedHint : t('timeline.menuSplitOutside'),
      onSelect: () => clip.split(clipLoc),
    });
    m.push({ id: 'copy', label: t('timeline.menuCopy'), icon: <CopyIcon size={14} />, onSelect: () => clip.copy(clipLoc) });
    m.push({
      id: 'paste', label: t('timeline.menuPaste'), icon: <ClipboardPaste size={14} />, disabled: trackLocked || !clip.canPaste(),
      hint: trackLocked ? lockedHint : t('timeline.menuPasteEmpty'),
      onSelect: () => clip.paste(clipLoc),
    });
    m.push({ id: 'duplicate', label: t('stageMenu.duplicate'), icon: <CopyPlus size={14} />, disabled: trackLocked, hint: lockedHint, onSelect: () => clip.duplicate(clipLoc) });
    m.sep();
    m.push({ id: 'front', label: t('stageMenu.front'), icon: <BringToFront size={14} />, disabled: trackLocked, hint: lockedHint, onSelect: () => clip.bringToFront(clipLoc) });
    m.push({ id: 'back', label: t('stageMenu.back'), icon: <SendToBack size={14} />, disabled: trackLocked, hint: lockedHint, onSelect: () => clip.sendToBack(clipLoc) });
    m.push({ id: 'reset', label: t('stageMenu.resetTransform'), icon: <RotateCcw size={14} />, disabled: trackLocked, hint: lockedHint, onSelect: () => clip.resetTransform(clipLoc) });
    const exportClip = clip.exportClip;
    if (exportClip && el.clipId) {
      const id = el.clipId;
      m.push({ id: 'export', label: t('timeline.menuExportClip'), icon: <Download size={14} />, onSelect: () => exportClip(id) });
    }
    m.sep();
    m.push({ id: 'delete', label: t('timeline.removeBlock'), icon: <Trash2 size={14} />, danger: true, shortcut: '⌫', disabled: trackLocked, hint: lockedHint, onSelect: () => clip.remove(clipLoc) });
    return m.done();
  }

  /* a layer */
  const hidden = el.override?.style?.visibility === 'hidden';
  const locked = Boolean(ctx.locked || el.override?.lock);
  const o = el.override;
  const adjusted = Boolean(o && (o.t || o.s != null || o.r || o.text != null || (o.style && Object.keys(o.style).length)));
  if (ctx.editText) {
    m.push({ id: 'edit-text', label: t('stageMenu.editText'), icon: <TypeIcon size={14} />, shortcut: '↵', disabled: locked, hint: t('stageMenu.lockedHint'), onSelect: ctx.editText });
  }
  m.sep();
  /* restacking writes z-index overrides where the layer meets what it overlaps (stage.js arrange), in one write; the
     page stays as written. When there is nothing to do, it says why instead of doing nothing silently */
  const arrange = ctx.arrange;
  const reorder = (to: 'front' | 'back') => {
    if (!arrange) return;
    void arrange(to).then((r) => {
      if (!r) return;
      if (!r.edits.length) {
        const key = r.reason === 'alone' ? 'stageMenu.arrangeAlone' : r.reason === 'blocked' ? 'stageMenu.arrangeBlocked'
          : to === 'front' ? 'stageMenu.arrangeFrontAlready' : 'stageMenu.arrangeBackAlready';
        actions.notify?.(t(key));
        return;
      }
      actions.editOverrides(r.edits.map(({ target, style }) => ({
        element: { ...el, loc: target.n ? `${target.at}#${target.n}` : target.at, instance: target.n } as StageElement,
        patch: { style },
      })));
    });
  };
  m.push({ id: 'front', label: t('stageMenu.front'), icon: <BringToFront size={14} />, shortcut: ']', disabled: !arrange, hint: t('stageMenu.arrangeHint'), onSelect: () => reorder('front') });
  m.push({ id: 'back', label: t('stageMenu.back'), icon: <SendToBack size={14} />, shortcut: '[', disabled: !arrange, hint: t('stageMenu.arrangeHint'), onSelect: () => reorder('back') });
  m.push({
    id: 'hide', label: hidden ? t('stageMenu.show') : t('stageMenu.hide'), icon: hidden ? <Eye size={14} /> : <EyeOff size={14} />, shortcut: hideKeys,
    onSelect: () => actions.editOverride(el, { style: { visibility: hidden ? null : 'hidden' } }),
  });
  m.push({
    id: 'lock', label: locked ? t('stageMenu.unlock') : t('stageMenu.lock'), icon: locked ? <Unlock size={14} /> : <Lock size={14} />, shortcut: lockKeys,
    onSelect: () => actions.editOverride(el, { lock: !locked }),
  });
  m.push({
    id: 'reset', label: t('stageMenu.reset'), icon: <RotateCcw size={14} />, disabled: !adjusted || locked, hint: locked ? t('stageMenu.lockedHint') : t('stageMenu.resetNone'),
    onSelect: () => actions.editOverride(el, null),
  });
  m.sep();
  /* the nearest layer around it (parents are nearest first) */
  const parentLayer = el.parents?.[0];
  if (parentLayer?.loc) m.push({ id: 'parent', label: t('stageMenu.selectParent'), icon: <CornerLeftUp size={14} />, onSelect: () => actions.selectParent(parentLayer.loc, el.clipLoc) });
  const clipLoc = el.clipLoc;
  if (clipLoc) m.push({ id: 'clip', label: t('stageMenu.selectClip'), icon: <Layers size={14} />, onSelect: () => actions.selectClip(clipLoc) });
  const words = el.text?.value;
  if (words) m.push({ id: 'copy-text', label: t('stageMenu.copyText'), icon: <CopyIcon size={14} />, onSelect: () => { void navigator.clipboard?.writeText(words).catch(() => {}); } });
  return m.done();
}

/**
 * Show… and Unlock…: the hidden and the locked layers of the film, by name, each a click from coming back. Empty when
 * there are none.
 */
export function stageRecoveryMenu(
  doc: FilmDoc | null | undefined,
  recover: (layer: RecoverableLayer, action: 'show' | 'unlock') => void,
  t: T,
): readonly ContextMenuEntry[] {
  const layers = recoverableLayers(doc);
  return (['show', 'unlock'] as const).flatMap((action) => {
    const affected = layers.filter((layer) => (action === 'show' ? layer.hidden : layer.locked));
    return affected.length ? [{
      id: `recover-${action}`,
      label: `${t(`stageMenu.${action}`)}…`,
      icon: action === 'show' ? <Eye size={14} /> : <Unlock size={14} />,
      submenu: affected.map((layer, i) => ({ id: `${action}-${i}`, label: layer.label, onSelect: () => recover(layer, action) })),
    }] : [];
  });
}
