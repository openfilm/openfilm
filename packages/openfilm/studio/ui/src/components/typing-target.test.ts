import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inHostPanel, isTypingTarget } from './typing-target.ts';

/** An element as the checks read it: its tag, what `closest` finds above it, whether it is editable. */
function element({ tag = 'DIV', type, above = [], editable = false }: { tag?: string; type?: string; above?: string[]; editable?: boolean } = {}) {
  const el = {
    nodeType: 1,
    tagName: tag,
    type,
    isContentEditable: editable,
    closest(selector: string) {
      const wanted = selector.split(',').map((s) => s.trim());
      const own = [tag.toLowerCase(), ...above];
      return wanted.some((s) => own.includes(s)) ? el : null;
    },
  };
  return el as unknown as EventTarget;
}

test('anything in an app\'s own panel is the app\'s: not a field, not editable, still not Studio\'s keys', () => {
  const panel = ['[data-studio-host-panel]'];
  assert.equal(inHostPanel(element({ above: panel })), true);
  assert.equal(isTypingTarget(element({ above: panel })), true);
  assert.equal(isTypingTarget(element({ tag: 'BUTTON', above: panel })), true);
  /* a text node inside it, as a key pressed with nothing focused but the panel reports */
  assert.equal(inHostPanel({ nodeType: 3, parentElement: element({ above: panel }) } as unknown as EventTarget), true);
});

test('the canvas\'s keys are its own: Delete removes what is on it, not a clip of the timeline', () => {
  const canvas = ['[data-studio-canvas]'];
  assert.equal(isTypingTarget(element({ above: canvas })), true);
  assert.equal(isTypingTarget(element({ tag: 'BUTTON', above: canvas })), true);
});

test('Studio\'s own page is not the panel', () => {
  assert.equal(inHostPanel(element()), false);
  assert.equal(inHostPanel(null), false);
  assert.equal(isTypingTarget(element()), false);
  assert.equal(isTypingTarget(element({ tag: 'BODY' })), false);
});

test('a text field or editable text types; a slider or checkbox does not', () => {
  assert.equal(isTypingTarget(element({ tag: 'INPUT', type: 'text' })), true);
  assert.equal(isTypingTarget(element({ tag: 'TEXTAREA' })), true);
  assert.equal(isTypingTarget(element({ editable: true })), true);
  assert.equal(isTypingTarget(element({ tag: 'INPUT', type: 'range' })), false);
  assert.equal(isTypingTarget(element({ tag: 'INPUT', type: 'checkbox' })), false);
});
