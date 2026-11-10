import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, ACTION_IDS, actionOf, assignKey, BUILT_IN_SCHEMES, comboCaps, comboOf, conflictOf, copyOf, CUSTOM_SLOTS, customKeymap,
  DEFAULT_KEY_PREFS, editable, hintOf, isCombo, KEY_TABS, keymapOf, keyPrefsOf, platformCombo, restoreDefaults, schemeKeymap,
  withKey, withoutKeys, type ActionId, type KeyPrefs, type Keymap,
} from './keymap.ts';
import type { KeyPress } from './timeline-keys.ts';
import { en } from '../i18n/en.ts';
import { es } from '../i18n/es.ts';
import { ja } from '../i18n/ja.ts';
import { ko } from '../i18n/ko.ts';
import { zhCN } from '../i18n/zh-CN.ts';

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
const OPENFILM_MAC = schemeKeymap('openfilm', true);
const OPENFILM_WIN = schemeKeymap('openfilm', false);
const mac = (key: string, mods: Partial<KeyPress> = {}) => actionOf(press(key, mods), OPENFILM_MAC, true);
const win = (key: string, mods: Partial<KeyPress> = {}) => actionOf(press(key, mods), OPENFILM_WIN, false);

/** Every combination a keymap uses, and whether any is used twice (on that platform). */
function twice(keymap: Keymap, isMac: boolean): string[] {
  const seen = new Map<string, ActionId>();
  const doubled: string[] = [];
  for (const id of ACTION_IDS) for (const combo of keymap[id]) {
    const at = platformCombo(combo, isMac);
    if (seen.has(at)) doubled.push(`${at}: ${seen.get(at)} and ${id}`);
    seen.set(at, id);
  }
  return doubled;
}

test('the action table: each action once, in a tab, with keys that are combinations', () => {
  assert.equal(new Set(ACTION_IDS).size, ACTIONS.length, 'no action twice');
  for (const tab of KEY_TABS) assert.ok(ACTIONS.some((a) => a.tab === tab), `${tab} has actions`);
  for (const a of ACTIONS) for (const combo of a.keys) assert.ok(isCombo(combo), `${a.id}: ${combo}`);
  assert.deepEqual(twice(OPENFILM_MAC, true), []);
  assert.deepEqual(twice(OPENFILM_WIN, false), []);
});

test('every action is named in the five languages', () => {
  for (const [lang, words] of Object.entries({ en, es, ja, ko, zhCN })) {
    const names = (words as { settings?: { shortcuts?: { actions?: Record<string, string> } } }).settings?.shortcuts?.actions ?? {};
    for (const id of ACTION_IDS) assert.ok(names[id]?.trim(), `${lang}: ${id}`);
  }
});

test('OpenFilm\'s keys are the keys Studio had', () => {
  assert.equal(mac(' '), 'play-pause');
  assert.equal(mac(' ', { shiftKey: true }), 'play-range');
  assert.equal(mac('j'), 'shuttle-back');
  assert.equal(mac('k'), 'shuttle-stop');
  assert.equal(mac('L'), 'shuttle-forward');
  assert.equal(mac('i'), 'mark-in');
  assert.equal(mac('o'), 'mark-out');
  assert.equal(mac('x'), 'clear-range');
  assert.equal(mac('I', { shiftKey: true }), 'go-in');
  assert.equal(mac('O', { shiftKey: true }), 'go-out');
  assert.equal(mac('L', { shiftKey: true }), 'loop');
  assert.equal(mac('b', { metaKey: true }), 'split');
  assert.equal(mac('b', { metaKey: true, shiftKey: true }), 'split-all');
  assert.equal(mac('k', { metaKey: true }), 'split-all');
  assert.equal(mac('x', { metaKey: true }), 'cut');
  assert.equal(mac('d', { metaKey: true }), 'duplicate');
  assert.equal(mac('c', { metaKey: true }), 'copy');
  assert.equal(mac('v', { metaKey: true }), 'paste');
  assert.equal(mac('z', { metaKey: true }), 'undo');
  assert.equal(mac('z', { metaKey: true, shiftKey: true }), 'redo');
  assert.equal(mac('a', { metaKey: true }), 'select-all');
  assert.equal(mac('l', { metaKey: true }), 'refer');
  assert.equal(mac('ArrowUp'), 'prev-cut');
  assert.equal(mac('ArrowDown'), 'next-cut');
  assert.equal(mac('ArrowLeft'), 'frame-back');
  assert.equal(mac('ArrowRight', { shiftKey: true }), 'jump-forward');
  assert.equal(mac('ArrowLeft', { altKey: true }), 'nudge-back');
  assert.equal(mac('ArrowRight', { altKey: true }), 'nudge-forward');
  assert.equal(mac('ArrowDown', { altKey: true }), 'overwrite-track-down');
  assert.equal(mac('Z', { shiftKey: true }), 'zoom-fit');
  assert.equal(mac('n'), 'toggle-snap');
  assert.equal(mac('N', { shiftKey: true }), 'toggle-magnet');
  assert.equal(mac('p'), 'toggle-magnet');
  assert.equal(mac('`'), 'toggle-linkage');
  assert.equal(mac('~', { shiftKey: true }), 'toggle-linkage');
  assert.equal(actionOf({ ...press('`'), code: 'Backquote' }, OPENFILM_MAC, true), 'toggle-linkage');
  assert.equal(mac('s'), null);
  assert.equal(win('s'), null);
  assert.equal(mac('S', { shiftKey: true, ctrlKey: true }), 'detach-audio');
  assert.equal(win('S', { shiftKey: true, ctrlKey: true }), 'detach-audio');
  assert.equal(mac('q'), 'ripple-start');
  assert.equal(mac('w'), 'ripple-end');
  assert.equal(mac(','), 'insert-source');
  assert.equal(mac('.'), 'overwrite-source');
  assert.equal(mac('Home'), 'start');
  assert.equal(mac('End'), 'end');
  assert.equal(mac('a'), 'select-mode');
  assert.equal(mac('v'), 'select-mode');
  assert.equal(mac('b'), 'split-mode');
  assert.equal(mac('Backspace'), 'remove');
  assert.equal(mac('Delete'), 'remove');
  assert.equal(mac('Backspace', { shiftKey: true }), 'ripple-delete');
  assert.equal(mac('X', { shiftKey: true }), 'range-clip');
  assert.equal(actionOf({ ...press('≈', { altKey: true }), code: 'KeyX' }, OPENFILM_MAC, true), 'clear-range', '⌥X types ≈ on a Mac');
  assert.equal(mac('r', { metaKey: true }), 'speed');
  assert.equal(mac('C', { metaKey: true, shiftKey: true }), 'copy-attrs');
  assert.equal(mac('V', { metaKey: true, shiftKey: true }), 'paste-attrs');
  assert.equal(actionOf({ ...press('['), code: 'BracketLeft' }, OPENFILM_MAC, true), 'select-left');
  assert.equal(actionOf({ ...press(']'), code: 'BracketRight' }, OPENFILM_MAC, true), 'select-right');
  /* zoom: ⌘= and ⌘+ (⇧= on a US keyboard, or the keypad's), ⌘-, ⌘0 */
  assert.equal(mac('=', { metaKey: true }), 'zoom-in');
  assert.equal(actionOf({ ...press('+', { metaKey: true, shiftKey: true }), code: 'Equal' }, OPENFILM_MAC, true), 'zoom-in');
  assert.equal(actionOf({ ...press('+', { ctrlKey: true }), code: 'NumpadAdd' }, OPENFILM_WIN, false), 'zoom-in');
  assert.equal(mac('-', { metaKey: true }), 'zoom-out');
  assert.equal(mac('0', { metaKey: true }), 'zoom-reset');
});

test('M adds a marker, ⇧M and ⌥M go to the next and the one before (⌥M types µ on a Mac)', () => {
  assert.equal(mac('m'), 'add-marker');
  assert.equal(mac('M', { shiftKey: true }), 'next-marker');
  assert.equal(actionOf({ ...press('µ', { altKey: true }), code: 'KeyM' }, OPENFILM_MAC, true), 'prev-marker');
  assert.equal(win('m', { altKey: true }), 'prev-marker');
  assert.equal(mac('m', { metaKey: true }), null);
  assert.equal(mac('m', { altKey: true, shiftKey: true }), 'prev-marker', '⌥⇧M too');
});

test('keys that are not the editor\'s stay the browser\'s, and Ctrl is the modifier off a Mac', () => {
  assert.equal(mac('b', { ctrlKey: true }), null, 'Ctrl+B on a Mac is not ⌘B');
  assert.equal(win('b', { ctrlKey: true }), 'split');
  assert.equal(win('b', { metaKey: true }), null, 'the Windows key is no shortcut');
  assert.equal(mac('j', { altKey: true }), null);
  assert.equal(mac('ArrowUp', { shiftKey: true }), null);
  assert.equal(mac('a', { ctrlKey: true }), null, 'Ctrl+A on a Mac moves the caret');
  assert.equal(mac('a', { metaKey: true, shiftKey: true }), null);
  assert.equal(mac('a', { metaKey: true, altKey: true }), null);
  assert.equal(mac('Shift', { shiftKey: true }), null, 'a modifier alone');
});

test('a letter is read by what it types, or where it sits when it types no Latin letter', () => {
  /* a French keyboard's A is where Q is on a US one: the letter it types counts */
  assert.equal(actionOf({ ...press('a'), code: 'KeyQ' }, OPENFILM_MAC, true), 'select-mode');
  /* Korean: ㅓ is on J */
  assert.equal(actionOf({ ...press('ㅓ'), code: 'KeyJ' }, OPENFILM_MAC, true), 'shuttle-back');
});

test('a key press as a combination, for recording a new key', () => {
  assert.equal(comboOf(press('B', { metaKey: true, shiftKey: true }), true), 'mod+shift+b');
  assert.equal(comboOf(press('b', { ctrlKey: true, shiftKey: true }), false), 'mod+shift+b', 'Ctrl is the modifier off a Mac');
  assert.equal(comboOf(press('s', { ctrlKey: true, shiftKey: true }), true), 'ctrl+shift+s', 'Control itself on a Mac');
  assert.equal(comboOf(press('k', { altKey: true, metaKey: true }), true), 'mod+alt+k');
  assert.equal(comboOf(press(' '), true), 'Space');
  assert.equal(comboOf(press('F5'), true), 'F5');
  assert.equal(comboOf({ ...press('!', { shiftKey: true }), code: 'Digit1' }, true), 'shift+1');
  assert.equal(comboOf(press('Meta', { metaKey: true }), true), null);
  assert.equal(comboOf(press('k', { metaKey: true }), false), null, 'the Windows key');
  for (const combo of ['mod+shift+b', 'ctrl+shift+s', 'mod+alt+k', 'Space', 'F5', 'shift+1']) assert.ok(isCombo(combo), combo);
  for (const combo of ['shift+mod+b', 'Mod+B', 'mod+', 'nope', '']) assert.ok(!isCombo(combo), combo);
});

test('hints and key caps follow the platform', () => {
  assert.equal(hintOf(OPENFILM_MAC, 'split', true), '⌘B');
  assert.equal(hintOf(OPENFILM_WIN, 'split', false), 'Ctrl+B');
  assert.equal(hintOf(OPENFILM_MAC, 'redo', true), '⌘⇧Z');
  assert.equal(hintOf(OPENFILM_WIN, 'redo', false), 'Ctrl+Shift+Z');
  assert.equal(hintOf(OPENFILM_MAC, 'zoom-in', true), '⌘+');
  assert.deepEqual(comboCaps('ctrl+shift+s', true), ['⌃', '⇧', 'S']);
  assert.deepEqual(comboCaps('ctrl+shift+s', false), ['Ctrl', 'Shift', 'S']);
  assert.deepEqual(comboCaps('Backspace', true), ['⌫']);
  assert.deepEqual(comboCaps('Backspace', false), ['Backspace']);
  assert.deepEqual(comboCaps('alt+', true), ['⌥'], 'a modifier held alone');
  assert.equal(hintOf({ ...OPENFILM_MAC, split: [] }, 'split', true), undefined, 'no key, no hint');
});

test('the built-in schemes: each app\'s keys where Studio has the action, OpenFilm\'s for the rest, no key twice', () => {
  for (const id of BUILT_IN_SCHEMES) for (const isMac of [true, false]) {
    const keymap = schemeKeymap(id, isMac);
    assert.deepEqual(twice(keymap, isMac), [], `${id} on ${isMac ? 'a Mac' : 'Windows'}`);
    for (const a of ACTION_IDS) for (const combo of keymap[a]) assert.ok(isCombo(combo), `${id}: ${a}: ${combo}`);
  }
  const premiere = schemeKeymap('premiere', true);
  assert.deepEqual(premiere.split, ['mod+k'], 'Add Edit');
  assert.deepEqual(premiere['split-all'], ['mod+shift+k']);
  assert.deepEqual(premiere['split-mode'], ['c'], 'the Razor tool');
  assert.deepEqual(premiere['toggle-snap'], ['s']);
  assert.deepEqual(premiere['toggle-magnet'], ['p', 'shift+n'], 'what the app has no key for keeps OpenFilm\'s');
  assert.deepEqual(premiere.refer, ['mod+l']);
  assert.deepEqual(premiere['nudge-back'], ['mod+ArrowLeft'], 'macOS');
  assert.deepEqual(schemeKeymap('premiere', false)['nudge-back'], ['alt+ArrowLeft'], 'Windows');
  assert.deepEqual(schemeKeymap('premiere', false)['clear-range'], ['mod+shift+x']);
  assert.equal(actionOf(press('k', { metaKey: true }), premiere, true), 'split');
  assert.equal(actionOf(press('\\'), premiere, true), 'zoom-fit');

  const fcp = schemeKeymap('fcp', true);
  assert.deepEqual(fcp.loop, ['mod+l']);
  assert.deepEqual(fcp.refer, [], '⌘L loops there');
  assert.deepEqual(fcp['ripple-delete'], ['Backspace', 'Delete'], 'Delete closes the gap');
  assert.deepEqual(fcp.remove, ['shift+Backspace', 'shift+Delete'], 'Replace with Gap');
  assert.deepEqual(fcp['insert-source'], ['w']);
  assert.deepEqual(fcp['ripple-end'], ['alt+]']);
  assert.equal(actionOf({ ...press('‘', { altKey: true }), code: 'BracketRight' }, fcp, true), 'ripple-end', '⌥] types ‘ on a Mac');
  assert.equal(actionOf(press("'", { ctrlKey: true }), fcp, true), 'next-marker');
  assert.equal(actionOf(press("'", { ctrlKey: true }), schemeKeymap('fcp', false), false), 'next-marker', 'Control is Ctrl on Windows');
});

test('a key that another action has is a conflict, and replacing takes it from that action', () => {
  assert.equal(conflictOf(OPENFILM_MAC, 'split', 'mod+k', true), 'split-all');
  assert.equal(conflictOf(OPENFILM_MAC, 'split', 'mod+b', true), null, 'its own key');
  assert.equal(conflictOf(OPENFILM_MAC, 'split', 'mod+shift+y', true), null);
  /* off a Mac, Control and the modifier are one key */
  assert.equal(conflictOf(OPENFILM_WIN, 'split', 'ctrl+shift+s', false), 'detach-audio');
  assert.equal(conflictOf(OPENFILM_MAC, 'split', 'mod+shift+s', true), null, 'on a Mac ⌘ is not ⌃');
  const next = assignKey(OPENFILM_MAC, 'split', 'mod+k', true);
  assert.deepEqual(next.split, ['mod+k']);
  assert.deepEqual(next['split-all'], ['mod+shift+b']);
  assert.deepEqual(OPENFILM_MAC['split-all'], ['mod+shift+b', 'mod+k'], 'the keymap given is left as it was');
});

test('changing a built-in scheme copies it into a free custom slot first; a full set of slots says so', () => {
  const start: KeyPrefs = { scheme: 'premiere', custom: {} };
  const first = editable(start, true);
  assert.ok(first);
  assert.equal(first.copiedTo, 'custom1');
  assert.equal(first.prefs.scheme, 'custom1');
  assert.equal(first.prefs.custom.custom1?.base, 'premiere');
  assert.deepEqual(customKeymap(first.prefs.custom.custom1!, true), schemeKeymap('premiere', true), 'the copy has the scheme\'s keys');
  const changed = withKey(first.prefs, 'custom1', 'split', 'mod+e', true);
  assert.deepEqual(keymapOf(changed, true).split, ['mod+e']);
  assert.deepEqual(schemeKeymap('premiere', true).split, ['mod+k'], 'the built-in scheme stays as it is');

  /* the next copy goes into the next slot; a custom scheme is changed itself */
  const again = editable({ ...changed, scheme: 'fcp' }, true);
  assert.equal(again?.copiedTo, 'custom2');
  assert.equal(editable(changed, true)?.copiedTo, null);
  const full: KeyPrefs = { scheme: 'openfilm', custom: Object.fromEntries(CUSTOM_SLOTS.map((slot) => [slot, copyOf(start, 'openfilm', true)])) };
  assert.equal(editable(full, true), null);

  /* keys taken away, then the scheme it came from restored */
  const bare = withoutKeys(changed, 'custom1', 'undo', true);
  assert.deepEqual(keymapOf(bare, true).undo, []);
  assert.equal(actionOf(press('z', { metaKey: true }), keymapOf(bare, true), true), null);
  const restored = restoreDefaults(bare, 'custom1', true);
  assert.deepEqual(keymapOf(restored, true), schemeKeymap('premiere', true));
});

test('an action added after a custom scheme was made takes its base\'s keys, unless they are used', () => {
  const keys = Object.fromEntries(ACTION_IDS.filter((id) => id !== 'refer' && id !== 'loop').map((id) => [id, [...OPENFILM_MAC[id]]]));
  keys.split = ['shift+l'];
  const keymap = customKeymap({ base: 'openfilm', keys }, true);
  assert.deepEqual(keymap.refer, ['mod+l']);
  assert.deepEqual(keymap.loop, [], '⇧L is split\'s now');
});

test('what is kept: the scheme and the custom ones, checked when read', () => {
  const prefs = withKey(editable({ scheme: 'fcp', custom: {} }, true)!.prefs, 'custom1', 'refer', 'mod+shift+l', true);
  const back = keyPrefsOf(JSON.parse(JSON.stringify(prefs)));
  assert.deepEqual(back, prefs, 'a round trip through JSON');
  assert.deepEqual(keymapOf(back, true).refer, ['mod+shift+l']);

  assert.deepEqual(keyPrefsOf(null), DEFAULT_KEY_PREFS);
  assert.deepEqual(keyPrefsOf({ scheme: 'nope' }), DEFAULT_KEY_PREFS);
  assert.equal(keyPrefsOf({ scheme: 'custom2', custom: {} }).scheme, 'openfilm', 'an empty slot is no scheme');
  const odd = keyPrefsOf({
    scheme: 'custom1',
    custom: { custom1: { base: 'someday', keys: { split: ['mod+e', 'Mod+E', 7], 'beam-me-up': ['x'] } }, custom9: { base: 'openfilm', keys: {} } },
  });
  assert.equal(odd.scheme, 'custom1');
  assert.equal(odd.custom.custom1?.base, 'openfilm', 'an unknown base is OpenFilm');
  assert.deepEqual(odd.custom.custom1?.keys, { split: ['mod+e'] }, 'unknown actions and keys that are none are left out');
  assert.deepEqual(Object.keys(odd.custom), ['custom1']);
  assert.deepEqual(keymapOf(odd, true).split, ['mod+e']);
  assert.deepEqual(keymapOf(odd, true)['split-all'], ['mod+shift+b', 'mod+k'], 'the rest from its base');
});
