/**
 * The editor's keys, in one table: every action has an id, a tab in Settings › Keyboard shortcuts, and its default
 * keys. The key handlers (`actionOf`), Settings' list and the hints in menus and tooltips (`hintOf`) all read it.
 *
 * A scheme gives the actions their keys: OpenFilm's own (the defaults), Premiere Pro's and Final Cut Pro X's (from each
 * app's default keyboard shortcuts, mapped onto the actions Studio has), or one of three custom ones. A built-in scheme
 * is read-only; a custom one starts as a copy of a scheme and can change any key.
 *
 * A key combination is a string: its modifiers in a fixed order, then the key, joined by "+" (`mod+shift+b`). `mod` is
 * ⌘ on a Mac and Ctrl elsewhere; `ctrl` is the Control key itself, which off a Mac is the same key as `mod`. Letters
 * are read by the letter they type (so they follow the keyboard's layout), or by where they sit on a US keyboard on a
 * layout without Latin letters; digits and punctuation by where they sit.
 */
import { letterOf, type KeyPress } from './timeline-keys.ts';

export type KeyTab = 'timeline' | 'player' | 'basic' | 'other';
export const KEY_TABS: readonly KeyTab[] = ['timeline', 'player', 'basic', 'other'];

/** The actions, in the order Settings lists them. */
export const ACTIONS = [
  /* the timeline */
  { id: 'split', tab: 'timeline', keys: ['mod+b'] },
  { id: 'split-all', tab: 'timeline', keys: ['mod+shift+b', 'mod+k'] },
  { id: 'select-mode', tab: 'timeline', keys: ['a', 'v'] },
  { id: 'split-mode', tab: 'timeline', keys: ['b'] },
  { id: 'ripple-start', tab: 'timeline', keys: ['q'] },
  { id: 'ripple-end', tab: 'timeline', keys: ['w'] },
  { id: 'select-left', tab: 'timeline', keys: ['['] },
  { id: 'select-right', tab: 'timeline', keys: [']'] },
  { id: 'nudge-back', tab: 'timeline', keys: ['alt+ArrowLeft'] },
  { id: 'nudge-forward', tab: 'timeline', keys: ['alt+ArrowRight'] },
  { id: 'toggle-magnet', tab: 'timeline', keys: ['p', 'shift+n'] },
  { id: 'toggle-snap', tab: 'timeline', keys: ['n'] },
  { id: 'toggle-linkage', tab: 'timeline', keys: ['`', 'shift+`'] },
  { id: 'zoom-in', tab: 'timeline', keys: ['mod++', 'mod+='] },
  { id: 'zoom-out', tab: 'timeline', keys: ['mod+-'] },
  { id: 'zoom-reset', tab: 'timeline', keys: ['mod+0'] },
  { id: 'zoom-fit', tab: 'timeline', keys: ['shift+z'] },
  { id: 'add-marker', tab: 'timeline', keys: ['m'] },
  { id: 'next-marker', tab: 'timeline', keys: ['shift+m'] },
  { id: 'prev-marker', tab: 'timeline', keys: ['alt+m', 'alt+shift+m'] },
  { id: 'speed', tab: 'timeline', keys: ['mod+r'] },
  { id: 'detach-audio', tab: 'timeline', keys: ['ctrl+shift+s'] },
  { id: 'compound', tab: 'timeline', keys: ['alt+g'] },
  { id: 'uncompound', tab: 'timeline', keys: ['alt+shift+g'] },
  /* the player */
  { id: 'play-pause', tab: 'player', keys: ['Space'] },
  { id: 'play-range', tab: 'player', keys: ['shift+Space'] },
  { id: 'loop', tab: 'player', keys: ['shift+l'] },
  { id: 'shuttle-back', tab: 'player', keys: ['j'] },
  { id: 'shuttle-stop', tab: 'player', keys: ['k'] },
  { id: 'shuttle-forward', tab: 'player', keys: ['l'] },
  { id: 'frame-back', tab: 'player', keys: ['ArrowLeft'] },
  { id: 'frame-forward', tab: 'player', keys: ['ArrowRight'] },
  { id: 'jump-back', tab: 'player', keys: ['shift+ArrowLeft'] },
  { id: 'jump-forward', tab: 'player', keys: ['shift+ArrowRight'] },
  { id: 'prev-cut', tab: 'player', keys: ['ArrowUp'] },
  { id: 'next-cut', tab: 'player', keys: ['ArrowDown'] },
  { id: 'start', tab: 'player', keys: ['Home'] },
  { id: 'end', tab: 'player', keys: ['End'] },
  { id: 'mark-in', tab: 'player', keys: ['i'] },
  { id: 'mark-out', tab: 'player', keys: ['o'] },
  { id: 'clear-range', tab: 'player', keys: ['x', 'alt+x'] },
  { id: 'range-clip', tab: 'player', keys: ['shift+x'] },
  { id: 'go-in', tab: 'player', keys: ['shift+i'] },
  { id: 'go-out', tab: 'player', keys: ['shift+o'] },
  { id: 'insert-source', tab: 'player', keys: [','] },
  { id: 'overwrite-source', tab: 'player', keys: ['.'] },
  /* the basics */
  { id: 'undo', tab: 'basic', keys: ['mod+z'] },
  { id: 'redo', tab: 'basic', keys: ['mod+shift+z'] },
  { id: 'cut', tab: 'basic', keys: ['mod+x'] },
  { id: 'copy', tab: 'basic', keys: ['mod+c'] },
  { id: 'paste', tab: 'basic', keys: ['mod+v'] },
  { id: 'duplicate', tab: 'basic', keys: ['mod+d'] },
  { id: 'remove', tab: 'basic', keys: ['Backspace', 'Delete'] },
  { id: 'ripple-delete', tab: 'basic', keys: ['shift+Backspace', 'shift+Delete'] },
  { id: 'select-all', tab: 'basic', keys: ['mod+a'] },
  { id: 'copy-attrs', tab: 'basic', keys: ['mod+shift+c'] },
  { id: 'paste-attrs', tab: 'basic', keys: ['mod+shift+v'] },
  /* the rest */
  { id: 'refer', tab: 'other', keys: ['mod+l'] },
  { id: 'work-mode', tab: 'other', keys: ['mod+e'] },
] as const satisfies readonly { id: string; tab: KeyTab; keys: readonly string[] }[];

export type ActionId = (typeof ACTIONS)[number]['id'];
export type Action = { id: ActionId; tab: KeyTab; keys: readonly string[] };
export const ACTION_IDS: readonly ActionId[] = ACTIONS.map((a) => a.id);
const KNOWN = new Set<string>(ACTION_IDS);

/**
 * Keys that do one thing wherever they are and are not set by a scheme: listed under Other, as Settings has always
 * listed them. `keys` as combinations; a modifier held during a drag is the modifier alone (`alt+`).
 */
export const FIXED_KEYS: readonly { label: string; keys: readonly string[] }[] = [
  { label: 'deselect', keys: ['Escape'] },
  { label: 'addMedia', keys: ['Enter'] },
  { label: 'splitModeAll', keys: ['shift+'] },
  { label: 'editModeSwap', keys: ['alt+'] },
  { label: 'copyDrag', keys: ['alt+'] },
  { label: 'nudge', keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] },
  { label: 'nudgeFast', keys: ['shift+ArrowUp', 'shift+ArrowDown', 'shift+ArrowLeft', 'shift+ArrowRight'] },
  { label: 'editText', keys: ['Enter'] },
  { label: 'commitText', keys: ['mod+Enter'] },
  { label: 'cancelText', keys: ['Escape'] },
];

/* ── schemes ── */

export type BuiltInScheme = 'openfilm' | 'premiere' | 'fcp';
export type CustomSlot = 'custom1' | 'custom2' | 'custom3';
export type SchemeId = BuiltInScheme | CustomSlot;
export const BUILT_IN_SCHEMES: readonly BuiltInScheme[] = ['openfilm', 'premiere', 'fcp'];
export const CUSTOM_SLOTS: readonly CustomSlot[] = ['custom1', 'custom2', 'custom3'];
export const isBuiltIn = (id: SchemeId): id is BuiltInScheme => (BUILT_IN_SCHEMES as readonly string[]).includes(id);

/** An action's keys in a scheme: the same everywhere, or one list for a Mac and another for Windows and Linux. */
type Binding = readonly string[] | { mac: readonly string[]; other: readonly string[] };

/**
 * Premiere Pro's default keyboard shortcuts (Adobe's "Default keyboard shortcuts" list), where Studio has the action.
 * Where Windows and macOS differ, both are given.
 */
const PREMIERE: Partial<Record<ActionId, Binding>> = {
  'play-pause': ['Space'],
  /* Play In to Out */
  'play-range': { mac: ['alt+k'], other: ['mod+shift+Space'] },
  'shuttle-back': ['j'],
  'shuttle-stop': ['k'],
  'shuttle-forward': ['l'],
  'frame-back': ['ArrowLeft'],
  'frame-forward': ['ArrowRight'],
  'jump-back': ['shift+ArrowLeft'],
  'jump-forward': ['shift+ArrowRight'],
  /* Go to Previous / Next Edit Point */
  'prev-cut': ['ArrowUp'],
  'next-cut': ['ArrowDown'],
  start: ['Home'],
  end: ['End'],
  'mark-in': ['i'],
  'mark-out': ['o'],
  'clear-range': { mac: ['alt+x'], other: ['mod+shift+x'] },
  /* Mark Selection */
  'range-clip': ['/'],
  'go-in': ['shift+i'],
  'go-out': ['shift+o'],
  'insert-source': [','],
  'overwrite-source': ['.'],
  /* Add Edit, Add Edit to All Tracks */
  split: ['mod+k'],
  'split-all': ['mod+shift+k'],
  /* the Selection and Razor tools */
  'select-mode': ['v'],
  'split-mode': ['c'],
  /* Ripple Trim Previous / Next Edit to Playhead */
  'ripple-start': ['q'],
  'ripple-end': ['w'],
  /* Nudge Clip Selection Left / Right One Frame */
  'nudge-back': { mac: ['mod+ArrowLeft'], other: ['alt+ArrowLeft'] },
  'nudge-forward': { mac: ['mod+ArrowRight'], other: ['alt+ArrowRight'] },
  /* Snap in Timeline */
  'toggle-snap': ['s'],
  'zoom-in': ['='],
  'zoom-out': ['-'],
  /* Zoom to Sequence */
  'zoom-fit': ['\\'],
  'add-marker': ['m'],
  'next-marker': ['shift+m'],
  'prev-marker': ['mod+shift+m'],
  /* Speed/Duration */
  speed: ['mod+r'],
  undo: ['mod+z'],
  redo: ['mod+shift+z'],
  cut: ['mod+x'],
  copy: ['mod+c'],
  paste: ['mod+v'],
  duplicate: ['mod+shift+/'],
  /* Clear */
  remove: ['Backspace', 'Delete'],
  'ripple-delete': ['shift+Delete', 'alt+Backspace'],
  'select-all': ['mod+a'],
  'paste-attrs': ['mod+alt+v'],
};

/** Final Cut Pro's default keyboard shortcuts (Apple's "Keyboard shortcuts in Final Cut Pro"), where Studio has the action. */
const FINAL_CUT: Partial<Record<ActionId, Binding>> = {
  /* New Compound Clip, Break Apart Clip Items */
  compound: ['alt+g'],
  uncompound: ['mod+shift+g'],
  'play-pause': ['Space'],
  /* Play Selection */
  'play-range': ['/'],
  /* Loop Playback */
  loop: ['mod+l'],
  'shuttle-back': ['j'],
  'shuttle-stop': ['k'],
  'shuttle-forward': ['l'],
  'frame-back': ['ArrowLeft'],
  'frame-forward': ['ArrowRight'],
  'jump-back': ['shift+ArrowLeft'],
  'jump-forward': ['shift+ArrowRight'],
  /* Go to Previous / Next Edit */
  'prev-cut': ['ArrowUp', ';'],
  'next-cut': ['ArrowDown', "'"],
  start: ['Home'],
  end: ['End'],
  /* Set Range Start / End, Clear Selected Ranges, Select Clip Range, Go to Range Start / End */
  'mark-in': ['i'],
  'mark-out': ['o'],
  'clear-range': ['alt+x'],
  'range-clip': ['x'],
  'go-in': ['shift+i'],
  'go-out': ['shift+o'],
  'insert-source': ['w'],
  'overwrite-source': ['d'],
  /* Blade, Blade All */
  split: ['mod+b'],
  'split-all': ['mod+shift+b'],
  /* the Select and Blade tools */
  'select-mode': ['a'],
  'split-mode': ['b'],
  /* Trim Start, Trim End */
  'ripple-start': ['alt+['],
  'ripple-end': ['alt+]'],
  /* Nudge Left / Right */
  'nudge-back': [','],
  'nudge-forward': ['.'],
  /* Snapping */
  'toggle-snap': ['n'],
  'zoom-in': ['mod++', 'mod+='],
  'zoom-out': ['mod+-'],
  'zoom-fit': ['shift+z'],
  'add-marker': ['m'],
  'next-marker': ["ctrl+'"],
  'prev-marker': ['ctrl+;'],
  /* Show/Hide Retime Editor */
  speed: ['mod+r'],
  'detach-audio': ['ctrl+shift+s'],
  undo: ['mod+z'],
  redo: ['mod+shift+z'],
  cut: ['mod+x'],
  copy: ['mod+c'],
  paste: ['mod+v'],
  duplicate: ['mod+d'],
  /* Delete closes the gap; Replace with Gap leaves one */
  'ripple-delete': ['Backspace', 'Delete'],
  remove: ['shift+Backspace', 'shift+Delete'],
  'select-all': ['mod+a'],
  'paste-attrs': ['mod+shift+v'],
};

const SCHEMES: Record<BuiltInScheme, Partial<Record<ActionId, Binding>>> = { openfilm: {}, premiere: PREMIERE, fcp: FINAL_CUT };

/** Every action's keys. */
export type Keymap = Record<ActionId, readonly string[]>;

/* ── key combinations ── */

const MODIFIERS = ['ctrl', 'mod', 'alt', 'shift'] as const;
type Modifier = (typeof MODIFIERS)[number];

/** A combination's modifiers and key (`shift+` is ⇧ alone, held during a drag); null when it is not one. */
export function parseCombo(combo: string): { mods: Set<Modifier>; key: string } | null {
  const m = /^((?:(?:ctrl|mod|alt|shift)\+)*)(.*)$/.exec(combo);
  if (!m) return null;
  const mods = new Set(m[1]!.split('+').filter(Boolean) as Modifier[]);
  return { mods, key: m[2]! };
}

const comboOfParts = (mods: Set<Modifier>, key: string): string => [...MODIFIERS.filter((x) => mods.has(x)), key].join('+');

/** A combination as this platform presses it: off a Mac, Control is the modifier, so `ctrl` is `mod`. */
export function platformCombo(combo: string, mac: boolean): string {
  const parsed = parseCombo(combo);
  if (!parsed) return combo;
  if (!mac && parsed.mods.delete('ctrl')) parsed.mods.add('mod');
  return comboOfParts(parsed.mods, parsed.key);
}

const NAMED = /^(?:Arrow(?:Left|Right|Up|Down)|Home|End|PageUp|PageDown|Backspace|Delete|Enter|Escape|Tab|Space|Insert|F(?:[1-9]|1[0-9]))$/;

/** A combination a key can be set to: modifiers in order, then a single character or a named key. */
export function isCombo(combo: unknown): combo is string {
  if (typeof combo !== 'string' || combo.length > 40) return false;
  const parsed = parseCombo(combo);
  if (!parsed || comboOfParts(parsed.mods, parsed.key) !== combo) return false;
  return (parsed.key.length === 1 && parsed.key !== ' ' && parsed.key === parsed.key.toLowerCase()) || NAMED.test(parsed.key);
}

/* punctuation read by where it sits (US keyboard), and what its key types with ⇧ */
const CODE_KEYS: Record<string, string> = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/',
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
};
const PUNCTUATION = new Set(Object.values(CODE_KEYS).filter((k) => !/\d/.test(k)));
const SHIFTED: Record<string, string> = {
  '~': '`', _: '-', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
  '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
};
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS', 'Fn', 'Hyper', 'Super', 'AltGraph']);

/** The key of a press, as combinations name it. */
function keyName(e: Pick<KeyPress, 'key' | 'code' | 'shiftKey' | 'altKey'>): string {
  if (e.key === ' ' || e.code === 'Space') return 'Space';
  const letter = letterOf(e);
  if (/^[a-z]$/.test(letter)) return letter;
  if (e.key === '+') return '+';
  /* punctuation the layout types where it is, unshifted: read as typed */
  if (e.key.length === 1 && !e.shiftKey && !e.altKey && PUNCTUATION.has(e.key)) return e.key;
  const byCode = CODE_KEYS[e.code ?? ''];
  if (byCode) return byCode;
  if (e.key.length === 1) return SHIFTED[e.key] ?? e.key.toLowerCase();
  return e.key === 'Esc' ? 'Escape' : e.key;
}

/**
 * The combination a key press is, or null (a modifier alone, or the other platform's modifier: the Windows key is no
 * shortcut off a Mac). `+` is the same with or without ⇧ (⌘+ is ⌘⇧= on a US keyboard).
 */
export function comboOf(e: KeyPress, mac: boolean): string | null {
  if (MODIFIER_KEYS.has(e.key) || e.key === 'Dead' || e.key === 'Unidentified' || !e.key) return null;
  if (!mac && e.metaKey) return null;
  const key = keyName(e);
  const mods = new Set<Modifier>();
  if (mac && e.ctrlKey) mods.add('ctrl');
  if (mac ? e.metaKey : e.ctrlKey) mods.add('mod');
  if (e.altKey) mods.add('alt');
  if (e.shiftKey && key !== '+') mods.add('shift');
  return comboOfParts(mods, key);
}

/* ── keymaps ── */

const bindingFor = (b: Binding, mac: boolean): readonly string[] => ('mac' in b ? (mac ? b.mac : b.other) : b);

/**
 * Every action's keys under `base`, then `own` (an action's keys; missing: base's). An action without its own keys
 * keeps base's, less any key the actions given their own already use: no key does two things.
 */
function layered(base: (id: ActionId) => readonly string[], own: Partial<Record<ActionId, readonly string[]>>, mac: boolean): Keymap {
  const map = {} as Record<ActionId, readonly string[]>;
  const taken = new Set<string>();
  for (const id of ACTION_IDS) {
    const keys = own[id];
    if (!keys) continue;
    map[id] = keys;
    for (const combo of keys) taken.add(platformCombo(combo, mac));
  }
  for (const id of ACTION_IDS) {
    if (map[id]) continue;
    const keys = base(id).filter((combo) => !taken.has(platformCombo(combo, mac)));
    map[id] = keys;
    for (const combo of keys) taken.add(platformCombo(combo, mac));
  }
  return map;
}

const DEFAULTS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.keys])) as unknown as Keymap;

/**
 * A built-in scheme's keys on this platform. Actions the scheme's app has take its keys; the rest keep OpenFilm's,
 * unless the app uses that key for another of Studio's actions.
 */
export function schemeKeymap(id: BuiltInScheme, mac: boolean): Keymap {
  const own = SCHEMES[id];
  const keys = Object.fromEntries(Object.entries(own).map(([action, b]) => [action, bindingFor(b, mac)])) as Partial<Record<ActionId, readonly string[]>>;
  return layered((action) => DEFAULTS[action], keys, mac);
}

/** A custom scheme: the scheme it was copied from (whose keys fill in actions it has no word on), and its keys. */
export interface CustomScheme { base: BuiltInScheme; keys: Partial<Record<ActionId, readonly string[]>> }

/** A custom scheme's keys. An action added after it was made takes its base's keys, unless one of them is used. */
export function customKeymap(custom: CustomScheme, mac: boolean): Keymap {
  const base = schemeKeymap(custom.base, mac);
  return layered((id) => base[id], custom.keys, mac);
}

/* ── finding, showing and changing keys ── */

const indexes = new WeakMap<Keymap, Map<string, ActionId>>();
const indexOf = (keymap: Keymap, mac: boolean): Map<string, ActionId> => {
  let index = indexes.get(keymap);
  if (!index) {
    index = new Map();
    for (const id of ACTION_IDS) for (const combo of keymap[id]) {
      const at = platformCombo(combo, mac);
      if (!index.has(at)) index.set(at, id);
    }
    indexes.set(keymap, index);
  }
  return index;
};

/** The action a key press is in `keymap`, or null. */
export function actionOf(e: KeyPress, keymap: Keymap, mac: boolean): ActionId | null {
  const combo = comboOf(e, mac);
  return combo ? indexOf(keymap, mac).get(combo) ?? null : null;
}

/** Whether a press is one of an action's keys. */
export const pressIs = (e: KeyPress, id: ActionId, keymap: Keymap, mac: boolean): boolean => actionOf(e, keymap, mac) === id;

/** The other action `combo` already does in `keymap` (not `id` itself), or null. */
export function conflictOf(keymap: Keymap, id: ActionId, combo: string, mac: boolean): ActionId | null {
  const at = platformCombo(combo, mac);
  for (const other of ACTION_IDS) {
    if (other !== id && keymap[other].some((c) => platformCombo(c, mac) === at)) return other;
  }
  return null;
}

/** `id` set to `combo` alone; any other action that had it loses it. */
export function assignKey(keymap: Keymap, id: ActionId, combo: string, mac: boolean): Keymap {
  const at = platformCombo(combo, mac);
  const next = { ...keymap } as Record<ActionId, readonly string[]>;
  for (const other of ACTION_IDS) {
    if (other !== id && next[other].some((c) => platformCombo(c, mac) === at)) next[other] = next[other].filter((c) => platformCombo(c, mac) !== at);
  }
  next[id] = [combo];
  return next;
}

const KEY_LABELS: Record<string, [mac: string, other: string]> = {
  ArrowLeft: ['←', '←'], ArrowRight: ['→', '→'], ArrowUp: ['↑', '↑'], ArrowDown: ['↓', '↓'],
  Backspace: ['⌫', 'Backspace'], Delete: ['⌦', 'Delete'], Escape: ['Esc', 'Esc'], Enter: ['Enter', 'Enter'],
  Space: ['Space', 'Space'], PageUp: ['Page Up', 'Page Up'], PageDown: ['Page Down', 'Page Down'], Tab: ['Tab', 'Tab'],
  '-': ['−', '−'], '`': ['~', '~'],
};
const MOD_LABELS: Record<Modifier, [mac: string, other: string]> = { ctrl: ['⌃', 'Ctrl'], mod: ['⌘', 'Ctrl'], alt: ['⌥', 'Alt'], shift: ['⇧', 'Shift'] };

/** A combination as key caps on this platform: its modifiers, then its key (none for a modifier held alone). */
export function comboCaps(combo: string, mac: boolean): string[] {
  const parsed = parseCombo(platformCombo(combo, mac));
  if (!parsed) return [combo];
  const pick = (labels: [string, string]) => labels[mac ? 0 : 1];
  const mods = MODIFIERS.filter((m) => parsed.mods.has(m)).map((m) => pick(MOD_LABELS[m]));
  if (!parsed.key) return mods;
  const known = KEY_LABELS[parsed.key];
  return [...mods, known ? pick(known) : parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key];
}

/** A combination as one hint: ⌘⇧B on a Mac, Ctrl+Shift+B elsewhere (as lib/shortcut-hint writes them). */
export const comboText = (combo: string, mac: boolean): string => comboCaps(combo, mac).join(mac ? '' : '+');

/** An action's first key as a hint, or undefined when it has none. */
export function hintOf(keymap: Keymap, id: ActionId, mac: boolean): string | undefined {
  const combo = keymap[id][0];
  return combo ? comboText(combo, mac) : undefined;
}

/* ── what is kept ── */

/** The scheme in use and the custom ones, as Studio's prefs keep them (`keys`). */
export interface KeyPrefs { scheme: SchemeId; custom: Partial<Record<CustomSlot, CustomScheme>> }
export const DEFAULT_KEY_PREFS: KeyPrefs = { scheme: 'openfilm', custom: {} };

/** What is kept, each part checked: an unknown scheme is OpenFilm's; unknown actions and keys that are none are left out. */
export function keyPrefsOf(raw: unknown): KeyPrefs {
  const p = raw && typeof raw === 'object' ? raw as { scheme?: unknown; custom?: unknown } : {};
  const custom: KeyPrefs['custom'] = {};
  const given = p.custom && typeof p.custom === 'object' ? p.custom as Record<string, unknown> : {};
  for (const slot of CUSTOM_SLOTS) {
    const one = given[slot] as { base?: unknown; keys?: unknown } | undefined;
    if (!one || typeof one !== 'object') continue;
    const base = (BUILT_IN_SCHEMES as readonly unknown[]).includes(one.base) ? one.base as BuiltInScheme : 'openfilm';
    const keys: CustomScheme['keys'] = {};
    if (one.keys && typeof one.keys === 'object') {
      for (const [id, list] of Object.entries(one.keys as Record<string, unknown>)) {
        if (KNOWN.has(id) && Array.isArray(list)) keys[id as ActionId] = list.filter(isCombo).slice(0, 8);
      }
    }
    custom[slot] = { base, keys };
  }
  const scheme = ([...BUILT_IN_SCHEMES, ...CUSTOM_SLOTS] as readonly unknown[]).includes(p.scheme) ? p.scheme as SchemeId : 'openfilm';
  return { scheme: isBuiltIn(scheme) || custom[scheme] ? scheme : 'openfilm', custom };
}

/** The keys of a scheme (an empty custom slot: OpenFilm's). */
export function keymapFor(prefs: KeyPrefs, id: SchemeId, mac: boolean): Keymap {
  if (isBuiltIn(id)) return schemeKeymap(id, mac);
  const custom = prefs.custom[id];
  return custom ? customKeymap(custom, mac) : schemeKeymap('openfilm', mac);
}

/** The keys in use. */
export const keymapOf = (prefs: KeyPrefs, mac: boolean): Keymap => keymapFor(prefs, prefs.scheme, mac);

/** A copy of scheme `from`, as a custom scheme: all its keys, and the built-in scheme it comes from. */
export function copyOf(prefs: KeyPrefs, from: SchemeId, mac: boolean): CustomScheme {
  const keymap = keymapFor(prefs, from, mac);
  const base = isBuiltIn(from) ? from : prefs.custom[from]?.base ?? 'openfilm';
  return { base, keys: Object.fromEntries(ACTION_IDS.map((id) => [id, [...keymap[id]]])) };
}

/** The first custom slot nothing is kept in, or null. */
export const freeSlot = (prefs: KeyPrefs): CustomSlot | null => CUSTOM_SLOTS.find((slot) => !prefs.custom[slot]) ?? null;

/**
 * Ready to change a key: a custom scheme is changed itself; a built-in one is first copied into a free custom slot,
 * which becomes the scheme (`copiedTo` says which). Null: every custom slot is taken, so there is none to copy into.
 */
export function editable(prefs: KeyPrefs, mac: boolean): { prefs: KeyPrefs; slot: CustomSlot; copiedTo: CustomSlot | null } | null {
  if (!isBuiltIn(prefs.scheme)) {
    const slot = prefs.scheme;
    if (prefs.custom[slot]) return { prefs, slot, copiedTo: null };
    return { prefs: { ...prefs, custom: { ...prefs.custom, [slot]: copyOf(prefs, 'openfilm', mac) } }, slot, copiedTo: null };
  }
  const slot = freeSlot(prefs);
  if (!slot) return null;
  return { prefs: { scheme: slot, custom: { ...prefs.custom, [slot]: copyOf(prefs, prefs.scheme, mac) } }, slot, copiedTo: slot };
}

/** A custom scheme set back to the keys of the scheme it was copied from. */
export function restoreDefaults(prefs: KeyPrefs, slot: CustomSlot, mac: boolean): KeyPrefs {
  const base = prefs.custom[slot]?.base ?? 'openfilm';
  return { ...prefs, custom: { ...prefs.custom, [slot]: copyOf(prefs, base, mac) } };
}

/** A custom scheme with one action's keys changed (`combo` alone; whatever had it loses it). */
export function withKey(prefs: KeyPrefs, slot: CustomSlot, id: ActionId, combo: string, mac: boolean): KeyPrefs {
  const custom = prefs.custom[slot] ?? copyOf(prefs, 'openfilm', mac);
  const keys = assignKey(customKeymap(custom, mac), id, combo, mac);
  return { ...prefs, custom: { ...prefs.custom, [slot]: { base: custom.base, keys: Object.fromEntries(ACTION_IDS.map((a) => [a, [...keys[a]]])) } } };
}

/** A custom scheme with one action's keys taken away. */
export function withoutKeys(prefs: KeyPrefs, slot: CustomSlot, id: ActionId, mac: boolean): KeyPrefs {
  const custom = prefs.custom[slot] ?? copyOf(prefs, 'openfilm', mac);
  const keys = { ...customKeymap(custom, mac), [id]: [] };
  return { ...prefs, custom: { ...prefs.custom, [slot]: { base: custom.base, keys: Object.fromEntries(ACTION_IDS.map((a) => [a, [...keys[a]]])) } } };
}
