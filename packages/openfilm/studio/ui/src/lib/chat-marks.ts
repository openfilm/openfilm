/**
 * What the app's chat points at in Studio (lib/host.ts StudioCommand `highlight` and `draft-refs`): the thing a pill
 * hovered there stands for, lit while it is hovered, and the things the message being written references, numbered
 * as the agent will read them ([1], [2], …). Pure, so `node --test` runs it (chat-marks.test.ts).
 */
import type { StageBox, StudioRef } from './host';
import type { FilmRange } from './studio-refs';

/** A clip as the timeline has it: its film.html id and its place (`film.html#<track>.<clip>`). */
export interface ClipKey { clipId?: string | null; loc?: string | null }

/** A box on the picture at its moment of the film (ms). */
export interface BoxAt { timeMs: number; box: StageBox }

/** A box is on the picture shown when it was pointed at within this much of the playhead (about a frame). */
export const BOX_AT_MS = 20;

/** The same clip: by film.html id when both have one (a clip keeps its id when tracks move), else by place. */
export function sameClip(a: ClipKey, b: ClipKey): boolean {
  if (a.clipId && b.clipId) return a.clipId === b.clipId;
  return Boolean(a.loc && a.loc === b.loc);
}

/**
 * What a hovered pill lights: a clip's block (a layer's too: the clip it is in), a box on the picture (a layer where
 * it was measured, a region), a span on the ruler (a range, a subtitle line, a moment as a span of none), a track's
 * head, a file of the media pane.
 */
export interface ChatPoint {
  clip: ClipKey | null;
  box: BoxAt | null;
  span: FilmRange | null;
  track: number | null;
  file: string | null;
}

const ms = (s: number) => Math.round(s * 1000);
const NOTHING: ChatPoint = { clip: null, box: null, span: null, track: null, file: null };

export function chatPointOf(ref: StudioRef | null | undefined): ChatPoint | null {
  if (!ref) return null;
  switch (ref.kind) {
    case 'clip': return ref.id || ref.loc ? { ...NOTHING, clip: { clipId: ref.id, loc: ref.loc } } : null;
    case 'layer': return {
      ...NOTHING,
      clip: ref.clipId ? { clipId: ref.clipId } : null,
      box: ref.box && typeof ref.time === 'number' ? { timeMs: ms(ref.time), box: ref.box } : null,
    };
    case 'region': return { ...NOTHING, box: { timeMs: ms(ref.time), box: ref.box } };
    case 'time': return { ...NOTHING, span: { startMs: ms(ref.time), endMs: ms(ref.time) } };
    case 'range':
    case 'subtitle': return { ...NOTHING, span: { startMs: ms(Math.min(ref.start, ref.end)), endMs: ms(Math.max(ref.start, ref.end)) } };
    case 'track': return { ...NOTHING, track: ref.track };
    case 'file': return { ...NOTHING, file: ref.path };
  }
  return null;
}

/** The box, when the picture shows the moment it was pointed at; null otherwise. */
export function boxNow(at: BoxAt | null | undefined, nowMs: number): StageBox | null {
  return at && Math.abs(at.timeMs - nowMs) <= BOX_AT_MS ? at.box : null;
}

/**
 * The message being written, as marks: its clips' blocks and its layers' and regions' boxes, each with its number
 * (its place among the references, from 1). Other kinds take their number and show nowhere.
 */
export interface DraftMarks {
  clips: ReadonlyArray<{ n: number; clip: ClipKey }>;
  boxes: ReadonlyArray<{ n: number } & BoxAt>;
}

export const NO_DRAFT: DraftMarks = { clips: [], boxes: [] };

export function draftMarksOf(refs: readonly StudioRef[]): DraftMarks {
  if (!refs.length) return NO_DRAFT;
  const clips: Array<{ n: number; clip: ClipKey }> = [];
  const boxes: Array<{ n: number } & BoxAt> = [];
  refs.forEach((ref, i) => {
    const n = i + 1;
    if (ref.kind === 'clip' && (ref.id || ref.loc)) clips.push({ n, clip: { clipId: ref.id, loc: ref.loc } });
    else if (ref.kind === 'layer' && ref.box && typeof ref.time === 'number') boxes.push({ n, timeMs: ms(ref.time), box: ref.box });
    else if (ref.kind === 'region') boxes.push({ n, timeMs: ms(ref.time), box: ref.box });
  });
  return { clips, boxes };
}

/** A block's numbers in the message being written (none: it is not referenced). */
export function draftNumbersOf(marks: DraftMarks, clip: ClipKey): number[] {
  return marks.clips.filter((m) => sameClip(m.clip, clip)).map((m) => m.n);
}

/** The boxes of the message being written that are on the picture shown now. */
export function draftBoxesAt(marks: DraftMarks, nowMs: number): Array<{ n: number; box: StageBox }> {
  return marks.boxes.filter((m) => boxNow(m, nowMs)).map(({ n, box }) => ({ n, box }));
}

/** What the picture draws for the chat: the hovered pill's clip (by place) or box, and the numbered boxes. */
export interface PictureMarks {
  clipLoc: string | null;
  box: StageBox | null;
  numbered: ReadonlyArray<{ n: number; box: StageBox }>;
}

const sameBox = (a: StageBox | null | undefined, b: StageBox | null | undefined) =>
  a === b || Boolean(a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** By content: the picture is memoized, and these are made anew as the playhead moves. */
export function samePictureMarks(a: PictureMarks | null | undefined, b: PictureMarks | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return !(a?.clipLoc || a?.box || a?.numbered.length || b?.clipLoc || b?.box || b?.numbered.length);
  return a.clipLoc === b.clipLoc && sameBox(a.box, b.box)
    && a.numbered.length === b.numbered.length && a.numbered.every((m, i) => m.n === b.numbered[i]!.n && sameBox(m.box, b.numbered[i]!.box));
}
