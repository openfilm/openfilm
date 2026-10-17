import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { keepWindowOnClose } from './window-lifecycle.mjs';

class Window extends EventEmitter {
  visible = true;
  destroyed = false;
  hide() { this.visible = false; }
  show() { this.visible = true; }
  close() {
    let prevented = false;
    this.emit('close', { preventDefault() { prevented = true; } });
    if (!prevented) { this.destroyed = true; this.emit('closed'); }
  }
}

test('macOS close preserves the window and sessions for activation, but explicit quit still closes it', () => {
  const win = new Window();
  let quitting = false, saved = 0, closed = 0;
  win.on('closed', () => closed++);
  keepWindowOnClose(win, { mac: true, isQuitting: () => quitting, save: () => saved++ });
  win.close();
  assert.equal(win.visible, false);
  assert.equal(win.destroyed, false);
  assert.equal(closed, 0, 'the closed handler must not quit the app or discard its views');
  assert.equal(saved, 1);
  win.show();
  assert.equal(win.visible, true, 'Dock activation can show the retained window');
  win.close();
  assert.equal(win.destroyed, false, 'closing again after activation also keeps the window');
  quitting = true;
  win.close();
  assert.equal(win.destroyed, true, 'Quit must not be intercepted as another hide');
  assert.equal(closed, 1);
  assert.equal(saved, 3);
});

test('Windows and Linux window close still follows the existing quit path', () => {
  const win = new Window();
  let saved = 0;
  keepWindowOnClose(win, { mac: false, isQuitting: () => false, save: () => saved++ });
  win.close();
  assert.equal(win.destroyed, true);
  assert.equal(saved, 1);
});
