/**
 * The editor's keys, as Premiere and CapCut have them: which key does what (`keyCommandOf`), the list Settings shows
 * (`SHORTCUTS`), J / K / L shuttle (`shuttleRate`) and looping a range (`loopBack`, `playStart`).
 *
 * Plain letters are read by the letter they type, so they follow the keyboard's layout; on a layout without Latin
 * letters (Korean, Russian…) by where the key is on a US keyboard.
 */

export type KeyCommand =
  | 'shuttle-back' | 'shuttle-stop' | 'shuttle-forward'
  | 'mark-in' | 'mark-out' | 'clear-range' | 'go-in' | 'go-out'
  | 'loop' | 'play-range'
  | 'split' | 'split-all' | 'cut' | 'duplicate'
  | 'prev-cut' | 'next-cut'
  | 'frame-back' | 'frame-forward' | 'second-back' | 'second-forward'
  | 'nudge-back' | 'nudge-forward'
  | 'start' | 'end'
  | 'zoom-fit' | 'toggle-snap' | 'toggle-magnet'
  | 'ripple-start' | 'ripple-end'
  | 'insert-source' | 'overwrite-source'
  | 'add-marker' | 'next-marker' | 'prev-marker';

export interface KeyPress {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The letter a key types (lower case), or where it is on a US keyboard when it types none. */
export function letterOf(e: Pick<KeyPress, 'key' | 'code'>): string {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (/^[a-z]$/.test(key)) return key;
  const code = /^Key([A-Z])$/.exec(e.code ?? '')?.[1];
  return code ? code.toLowerCase() : key;
}

/**
 * The command a key press is, or null. `mac`: ⌘ is the modifier there (Ctrl elsewhere). Arrows: ← / → a frame (⇧ a
 * second), ⌥ ← / → move the selected clips a frame, ↑ / ↓ the previous / next cut.
 */
export function keyCommandOf(e: KeyPress, mac: boolean): KeyCommand | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  /* the other platform's modifier (Ctrl on a Mac) is no shortcut here */
  const other = mac ? e.ctrlKey : e.metaKey;
  if (other) return null;
  const k = letterOf(e);
  if (mod) {
    if (e.altKey) return null;
    if (k === 'b') return e.shiftKey ? 'split-all' : 'split';
    if (k === 'k' && !e.shiftKey) return 'split-all';
    if (k === 'x' && !e.shiftKey) return 'cut';
    if (k === 'd' && !e.shiftKey) return 'duplicate';
    return null;
  }
  switch (e.key) {
    case 'ArrowLeft': return e.altKey ? (e.shiftKey ? null : 'nudge-back') : e.shiftKey ? 'second-back' : 'frame-back';
    case 'ArrowRight': return e.altKey ? (e.shiftKey ? null : 'nudge-forward') : e.shiftKey ? 'second-forward' : 'frame-forward';
    case 'ArrowUp': return e.altKey || e.shiftKey ? null : 'prev-cut';
    case 'ArrowDown': return e.altKey || e.shiftKey ? null : 'next-cut';
    case 'Home': return e.altKey ? null : 'start';
    case 'End': return e.altKey ? null : 'end';
    case ' ': return e.shiftKey && !e.altKey ? 'play-range' : null;
    case ',': return e.altKey || e.shiftKey ? null : 'insert-source';
    case '.': return e.altKey || e.shiftKey ? null : 'overwrite-source';
    default: break;
  }
  /* ⌥M: the marker before (on a Mac ⌥M types µ: read by where the key is) */
  if (e.altKey) return !e.shiftKey && k === 'm' ? 'prev-marker' : null;
  if (e.shiftKey) {
    switch (k) {
      case 'i': return 'go-in';
      case 'o': return 'go-out';
      case 'l': return 'loop';
      case 'z': return 'zoom-fit';
      case 'n': return 'toggle-magnet';
      case 'm': return 'next-marker';
      default: return null;
    }
  }
  switch (k) {
    case 'j': return 'shuttle-back';
    case 'k': return 'shuttle-stop';
    case 'l': return 'shuttle-forward';
    case 'i': return 'mark-in';
    case 'o': return 'mark-out';
    case 'x': return 'clear-range';
    case 'n': return 'toggle-snap';
    case 'q': return 'ripple-start';
    case 'w': return 'ripple-end';
    case 'm': return 'add-marker';
    default: return null;
  }
}

/**
 * Settings' list of keys, in groups: each row's words (a key of settings.shortcuts) and its keys, as `mod` (⌘ / Ctrl),
 * `shift` (⇧), `alt` (⌥) and the key. Kept here beside keyCommandOf, so the list says what the keys do.
 */
export type ShortcutKey = { key: string; mod?: boolean; shift?: boolean; alt?: boolean };
export type ShortcutRow = { label: string; keys: ShortcutKey[] };

const k = (key: string, mods: Omit<ShortcutKey, 'key'> = {}): ShortcutKey => ({ key, ...mods });

export const SHORTCUTS: { group: 'groupPlayback' | 'groupMarks' | 'groupEdit' | 'groupView'; rows: ShortcutRow[] }[] = [
  {
    group: 'groupPlayback',
    rows: [
      { label: 'playPause', keys: [k('Space')] },
      { label: 'shuttle', keys: [k('J'), k('K'), k('L')] },
      { label: 'shuttleFrame', keys: [k('K+J'), k('K+L')] },
      { label: 'frameStep', keys: [k('←'), k('→')] },
      { label: 'secondStep', keys: [k('←', { shift: true }), k('→', { shift: true })] },
      { label: 'cutStep', keys: [k('↑'), k('↓')] },
      { label: 'seekEnds', keys: [k('Home'), k('End')] },
    ],
  },
  {
    group: 'groupMarks',
    rows: [
      { label: 'markIn', keys: [k('I')] },
      { label: 'markOut', keys: [k('O')] },
      { label: 'clearMarks', keys: [k('X')] },
      { label: 'goInOut', keys: [k('I', { shift: true }), k('O', { shift: true })] },
      { label: 'playRange', keys: [k('Space', { shift: true })] },
      { label: 'loop', keys: [k('L', { shift: true })] },
      { label: 'insertSource', keys: [k(',')] },
      { label: 'overwriteSource', keys: [k('.')] },
      { label: 'addMedia', keys: [k('Enter')] },
      { label: 'addMarker', keys: [k('M')] },
      { label: 'markerStep', keys: [k('M', { shift: true }), k('M', { alt: true })] },
    ],
  },
  {
    group: 'groupEdit',
    rows: [
      { label: 'undo', keys: [k('Z', { mod: true })] },
      { label: 'redo', keys: [k('Z', { mod: true, shift: true })] },
      { label: 'split', keys: [k('B', { mod: true })] },
      { label: 'splitAll', keys: [k('B', { mod: true, shift: true }), k('K', { mod: true })] },
      { label: 'rippleStart', keys: [k('Q')] },
      { label: 'rippleEnd', keys: [k('W')] },
      { label: 'copy', keys: [k('C', { mod: true })] },
      { label: 'cut', keys: [k('X', { mod: true })] },
      { label: 'paste', keys: [k('V', { mod: true })] },
      { label: 'duplicate', keys: [k('D', { mod: true })] },
      { label: 'remove', keys: [k('⌫'), k('Delete')] },
      { label: 'rippleDelete', keys: [k('⌫', { shift: true }), k('Delete', { shift: true })] },
      { label: 'nudgeClip', keys: [k('←', { alt: true }), k('→', { alt: true })] },
      { label: 'selectAll', keys: [k('A', { mod: true })] },
      { label: 'deselect', keys: [k('Esc')] },
      { label: 'selectMode', keys: [k('A'), k('V')] },
      { label: 'splitMode', keys: [k('B')] },
      { label: 'toggleMagnet', keys: [k('N', { shift: true })] },
      { label: 'toggleSnap', keys: [k('N')] },
      { label: 'editModeSwap', keys: [k('', { alt: true })] },
      { label: 'slip', keys: [k('', { alt: true })] },
      { label: 'slide', keys: [k('', { alt: true, shift: true })] },
    ],
  },
  {
    group: 'groupView',
    rows: [
      { label: 'zoomIn', keys: [k('=', { mod: true }), k('+', { mod: true })] },
      { label: 'zoomOut', keys: [k('−', { mod: true })] },
      { label: 'zoomReset', keys: [k('0', { mod: true })] },
      { label: 'zoomFit', keys: [k('Z', { shift: true })] },
    ],
  },
];

/* ── J / K / L ── */

/** The fastest a shuttle goes, either way. */
export const SHUTTLE_MAX = 4;

/**
 * The rate after J, K or L, from `rate` (0: stopped; negative: backwards). L plays forward, and again doubles it
 * (1×, 2×, 4×); J the same backwards; K stops. From one direction the other key starts over at 1× that way.
 */
export function shuttleRate(rate: number, key: 'j' | 'k' | 'l'): number {
  if (key === 'k') return 0;
  if (key === 'l') return rate > 0 ? Math.min(SHUTTLE_MAX, rate * 2) : 1;
  return rate < 0 ? Math.max(-SHUTTLE_MAX, rate * 2) : -1;
}

/* ── looping a range ── */

type Range = { startMs: number; endMs: number } | null | undefined;

/** What loops: the range marked, else the whole film. */
function loopSpan(range: Range, totalMs: number): { startMs: number; endMs: number } {
  return range && range.endMs > range.startMs ? range : { startMs: 0, endMs: totalMs };
}

/** Where playback goes back to once it reaches the end of what loops; null: on it goes. */
export function loopBack(nowMs: number, range: Range, totalMs: number): number | null {
  const span = loopSpan(range, totalMs);
  return span.endMs > span.startMs && nowMs >= span.endMs - 1 ? span.startMs : null;
}

/** Where playback starts with loop on: where it is, inside what loops; else at its start. */
export function playStart(nowMs: number, range: Range, totalMs: number): number {
  const span = loopSpan(range, totalMs);
  return nowMs >= span.startMs && nowMs < span.endMs - 1 ? nowMs : span.startMs;
}
