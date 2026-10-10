/**
 * Timecode: `00:00:47:29`, hours:minutes:seconds:frames, the way editors read a position.
 *
 * The film has no frames: time is milliseconds and the picture is drawn live in the browser. The last two digits are
 * a reading scale, not a unit of the document: people cut by frame ("second 47, frame 29"). The scale is the
 * project's frame rate (kept in `.film/settings.json`, see lib/project-settings), 30 until a project says otherwise.
 * It also sets the grid a click, a drag and the arrow keys land on.
 *
 * At 23.976, 29.97 and 59.94 the timecode is the clock's: the seconds are the film's own seconds, and the frames count
 * the frames that start within that second (29 or 30 of them at 29.97). It never drifts from the ruler, which a
 * non-drop SMPTE timecode does (3.6 s an hour), and it skips no numbers the way drop-frame timecode (`;`) does; the
 * price is that the last frame number of a second is missing about once a thousand frames.
 *
 * Fixed width (`00:` even under an hour): a timecode is read while it changes, and a changing width makes it jitter.
 */
import { useSyncExternalStore } from 'react';

/** The frame rate before a project says otherwise, and the grid the ruler's steps are counted in. */
export const DISPLAY_FPS = 30;

/** The rates a project can be set to, as editors name them. */
export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

/** A rate as it really is: the NTSC ones are 24000/1001, 30000/1001 and 60000/1001. */
export function exactRate(fps: number): number {
  if (!(fps > 0) || !Number.isFinite(fps)) return DISPLAY_FPS;
  const whole = Math.round(fps);
  /* 23.976, 29.97, 59.94: a whole rate slowed by 1000/1001 */
  if (Math.abs(fps - whole) > 0.001 && Math.abs(fps - (whole * 1000) / 1001) < 0.01) return (whole * 1000) / 1001;
  return fps;
}

/** The rate an editor names: a probed 29.97002997 is 29.97, 24.0 is 24; another rate is kept as it is. */
export function namedRate(fps: number): number {
  const named = FRAME_RATES.find((r) => Math.abs(r - fps) < 0.01);
  return named ?? Math.round(fps * 1000) / 1000;
}

/**
 * A project's rate before one is chosen: the first footage's that is a rate a project can have (in the order given:
 * the film's footage clips by time, then the project's other videos), else 30.
 */
export function footageFps(rates: readonly (number | null | undefined)[]): number {
  for (const r of rates) {
    if (r == null || !(r > 0)) continue;
    const named = namedRate(r);
    if ((FRAME_RATES as readonly number[]).includes(named)) return named;
  }
  return DISPLAY_FPS;
}

/** How many frames ⇧ + an arrow steps: a second's worth, whole. */
export function secondFrames(fps = currentFps): number {
  return Math.max(1, Math.round(fps));
}

/* ── the project's rate, for everything that shows or snaps to frames ── */

let currentFps: number = DISPLAY_FPS;
const listeners = new Set<() => void>();

/** The rate frames are counted in now (the project open). */
export function timecodeFps(): number {
  return currentFps;
}

/** Count frames at this rate from now on (a project opened, or its rate changed). */
export function setTimecodeFps(fps: number): void {
  const next = fps > 0 && Number.isFinite(fps) ? fps : DISPLAY_FPS;
  if (next === currentFps) return;
  currentFps = next;
  for (const fn of listeners) fn();
}

/** The rate, kept up to date: a component that shows frames renders again when the project's rate changes. */
export function useTimecodeFps(): number {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    timecodeFps,
    () => DISPLAY_FPS,
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The frame a time falls on, counted from 0. Rounded to the nearest: a frame at 30 lasts 33.33… ms, which no float or
 * whole millisecond holds exactly — rounded down, 500 ms (14.999… frames) read as frame 14 and a time written to the
 * millisecond (1033 ms) as the frame before its own.
 */
export function frameAt(ms: number, fps = currentFps): number {
  return Number.isFinite(ms) && ms > 0 ? Math.round((ms * exactRate(fps)) / 1000) : 0;
}

/** The time of a frame. */
export function frameMs(frame: number, fps = currentFps): number {
  return (frame * 1000) / exactRate(fps);
}

/**
 * The frame nearest `ms`, in ms. What an edit on the timeline writes: a drag lands between frames (a second is 1998 ms
 * of pointer travel), and film.html should hold the moments a person sees on the frame grid.
 */
export function snapToFrame(ms: number, fps = currentFps): number {
  return frameMs(frameAt(ms, fps), fps);
}

/**
 * `frames` frames on from `ms` (negative = back), landing exactly on a frame: stepping by adding 33.33… ms gathers
 * float error until one frame shows twice and the next is skipped.
 */
export function stepFrames(ms: number, frames: number, fps = currentFps): number {
  return frameMs(Math.max(0, frameAt(ms, fps) + frames), fps);
}

/** A frame as the clock reads it: the whole second it starts in, and which frame of that second it is. */
function clockOf(frame: number, fps: number): { secs: number; frames: number } {
  const rate = exactRate(fps);
  const secs = Math.floor(frame / rate + 1e-9);
  /* the first frame that starts in this second */
  const first = Math.ceil(secs * rate - 1e-9);
  return { secs, frames: frame - first };
}

export function formatTimecode(ms: number, opts?: { hours?: boolean; fps?: number }): string {
  const { secs, frames } = clockOf(frameAt(ms, opts?.fps), opts?.fps ?? currentFps);
  const tail = `${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}:${pad(frames)}`;
  /* `hours: false` drops the always-`00:` hour of a film under an hour; the caller decides once per film, so the
     width still never changes */
  if (opts?.hours === false && secs < 3600) return tail;
  return `${pad(Math.floor(secs / 3600))}:${tail}`;
}

/**
 * The short label on the ruler: `mm:ss` on whole seconds (with hours past an hour), `12f` in between — as OpenCut and
 * CapCut do. Full timecodes on every tick would be a wall of `00:00:47:29`.
 */
export function formatRulerLabel(ms: number, fps = currentFps): string {
  /* a tick is a place on the clock, not a frame: a whole second is labeled as one even where no frame starts on it */
  const secs = Math.max(0, Math.floor(ms / 1000 + 1e-6));
  const frames = frameAt(ms, fps) - Math.ceil(secs * exactRate(fps) - 1e-9);
  if (ms - secs * 1000 >= 0.5 && frames > 0) return `${frames}f`;
  const h = Math.floor(secs / 3600);
  const clock = `${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
  return h > 0 ? `${h}:${clock}` : clock;
}
