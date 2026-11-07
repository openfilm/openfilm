/**
 * Copy and paste of layers inside pages (⌘C / ⌘V and the menus, on the picture and in the Layers panel), as a design
 * tool does it: a pasted layer is a new element written into a page (lib/layer-paste), independent of the one copied.
 *
 * Where it goes (pasteGoals): into the page in hand (the layer or clip selected), else into a page of the copied
 * layer's under the playhead, else into the top page there; with no page under the playhead, into the page it was
 * copied from, at its own place. Its own page gets the copied element itself, right after it; another page gets it as
 * it looks (lib/layer-paste pastedElsewhere). Layers copied from several clips each go back into their own page. Each
 * paste at the same spot goes a little lower and to the right of the one before.
 *
 * The clipboard is the timeline's or this one's, whichever was copied last; it is kept in the browser's storage, so
 * another window and another project of the same Studio paste it too (lib: no React, no DOM, so `node --test` runs it).
 */
import type { PasteLayer } from './layer-paste.ts';

/** The layers copied from one page clip. */
export interface CopiedLayers {
  /** The clip's id. */
  from: string;
  /** Its page (its src): a paste into a clip of it is a paste into its own page. */
  src: string;
  layers: PasteLayer[];
}

export interface LayerClipboard {
  /** The project copied from: another one's files are brought in first. */
  project: string;
  /** The film's time copied at. */
  atMs: number;
  clips: CopiedLayers[];
  /** The pastes made at one spot so far (each one further off), the spot, and the last one's copies (their ids). */
  pasted?: { spot: string; n: number; ats?: string[] };
}

/** How far each paste at the same spot goes, right and down (px of the page). */
export const PASTE_OFFSET = 24;

/** A page clip as a paste sees it. */
export interface PageClip { id: string; src: string; locked?: boolean }

/** Where copied layers are written: into clip `clip`'s page, as themselves (`own`) or as they look (`other`). */
export interface PasteGoal { kind: 'own' | 'other'; clip: string; layers: PasteLayer[] }

/**
 * Where a paste of `board` goes (see the top), in project `project`: `held` the page clip in hand, `under` the page
 * clips under the playhead (the top one first), `clips` every page clip of the film. Empty when there is nowhere.
 */
export function pasteGoals(
  board: LayerClipboard, project: string, held: PageClip | null, under: readonly PageClip[], clips: readonly PageClip[],
): PasteGoal[] {
  const open = (c: PageClip | null | undefined): c is PageClip => Boolean(c && !c.locked);
  const all = board.clips.flatMap((c) => c.layers);
  if (board.project !== project) {
    const into = open(held) ? held : under.find(open);
    return into ? [{ kind: 'other', clip: into.id, layers: all }] : [];
  }
  if (board.clips.length > 1) {
    return board.clips.flatMap((c) => {
      const own = clips.find((x) => x.id === c.from);
      return open(own) ? [{ kind: 'own' as const, clip: own.id, layers: c.layers }] : [];
    });
  }
  const c = board.clips[0];
  if (!c) return [];
  const mine = (x: PageClip) => x.id === c.from || x.src === c.src;
  if (open(held)) return [{ kind: mine(held) ? 'own' : 'other', clip: held.id, layers: c.layers }];
  const here = under.filter(open);
  const ownHere = here.find((x) => x.id === c.from) ?? here.find(mine);
  if (ownHere) return [{ kind: 'own', clip: ownHere.id, layers: c.layers }];
  if (here[0]) return [{ kind: 'other', clip: here[0].id, layers: c.layers }];
  const own = clips.find((x) => x.id === c.from);
  return open(own) ? [{ kind: 'own', clip: own.id, layers: c.layers }] : [];
}

/** Why a paste of `board` goes nowhere (pasteGoals said so): its own page is on a locked track, or there is no page. */
export function whyNowhere(board: LayerClipboard, project: string, clips: readonly PageClip[]): 'locked' | 'no-page' {
  return board.project === project && board.clips.some((c) => clips.find((x) => x.id === c.from)?.locked) ? 'locked' : 'no-page';
}

/** How far a paste into these goals goes: further each time at the same spot; into its own page, off from the start. */
export function pasteOffset(board: LayerClipboard, goals: readonly PasteGoal[]): { spot: string; n: number } {
  const spot = goals.map((g) => `${g.kind}:${g.clip}:${g.layers.map((l) => l.at).join('|')}`).join(';');
  const first = goals.some((g) => g.kind === 'own') ? 1 : 0;
  return { spot, n: board.pasted?.spot === spot ? board.pasted.n + 1 : first };
}

/* ── kept in the browser, for every window and project of this Studio ── */

const KEY = 'openfilm.layer-clipboard';

export function readLayerClipboard(): LayerClipboard | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const v = raw ? JSON.parse(raw) as LayerClipboard : null;
    return v && typeof v.project === 'string' && Array.isArray(v.clips) && v.clips.length && v.clips.every((c) => Array.isArray(c.layers)) ? v : null;
  } catch {
    return null;
  }
}

/** Kept, or (null) emptied: the timeline's clipboard was copied to since. */
export function writeLayerClipboard(board: LayerClipboard | null): void {
  try {
    if (board) globalThis.localStorage?.setItem(KEY, JSON.stringify(board));
    else globalThis.localStorage?.removeItem(KEY);
  } catch { /* storage refused (a private window): the clipboard lives in this window only */ }
}

/** Whether a storage event is this clipboard's (another window copied or emptied it). */
export const isLayerClipboardKey = (key: string | null) => key === KEY || key === null;
