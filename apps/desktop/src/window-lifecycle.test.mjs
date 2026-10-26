import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { closeTabOrWindow, keepWindowOnClose, quitAfterStudio } from './window-lifecycle.mjs';

class Window extends EventEmitter {
  visible = true;
  destroyed = false;
  fullScreen = false;
  fullScreenRequests = [];
  hide() { this.visible = false; }
  show() { this.visible = true; }
  isDestroyed() { return this.destroyed; }
  isFullScreen() { return this.fullScreen; }
  setFullScreen(value) { this.fullScreenRequests.push(value); }
  leaveFullScreen() { this.fullScreen = false; this.emit('leave-full-screen'); }
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

test('macOS full-screen close leaves its Space before hiding, even when close is pressed twice', () => {
  const win = new Window();
  win.fullScreen = true;
  keepWindowOnClose(win, { mac: true, isQuitting: () => false, save: () => {} });
  win.close();
  win.close();
  assert.equal(win.visible, true, 'keep drawing the window throughout the native full-screen transition');
  assert.equal(win.destroyed, false);
  assert.deepEqual(win.fullScreenRequests, [false]);
  win.leaveFullScreen();
  assert.equal(win.visible, false);
  assert.equal(win.destroyed, false, 'its pages and agent sessions remain available for Dock activation');
});

test('Dock activation during a full-screen close keeps the window visible after the transition', () => {
  const win = new Window();
  win.fullScreen = true;
  const cancelClose = keepWindowOnClose(win, { mac: true, isQuitting: () => false, save: () => {} });
  win.close();
  cancelClose();
  win.show();
  win.leaveFullScreen();
  assert.equal(win.visible, true);
  assert.equal(win.listenerCount('leave-full-screen'), 0);
  win.close();
  assert.equal(win.visible, false, 'a later close still works');
});

test('explicit Quit during a pending full-screen close proceeds without a late hide', () => {
  const win = new Window();
  win.fullScreen = true;
  let quitting = false;
  keepWindowOnClose(win, { mac: true, isQuitting: () => quitting, save: () => {} });
  win.close();
  quitting = true;
  win.close();
  assert.equal(win.destroyed, true);
  assert.equal(win.listenerCount('leave-full-screen'), 0);
  win.leaveFullScreen();
  assert.equal(win.visible, true, 'the deferred close must not act on the destroyed window');
});

test('Windows and Linux window close still follows the existing quit path', () => {
  const win = new Window();
  let saved = 0;
  keepWindowOnClose(win, { mac: false, isQuitting: () => false, save: () => saved++ });
  win.close();
  assert.equal(win.destroyed, true);
  assert.equal(saved, 1);
});

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`Close Tab on ${platform} closes a project, and only macOS closes an empty window`, () => {
    const win = new Window(), closed = [];
    const mac = platform === 'darwin';
    keepWindowOnClose(win, { mac, isQuitting: () => false, save: () => {} });
    closeTabOrWindow(win, { mac, activeId: 'project', closeTab: (id) => closed.push(id) });
    assert.deepEqual(closed, ['project']);
    assert.equal(win.visible, true);
    closeTabOrWindow(win, { mac, activeId: null, closeTab: (id) => closed.push(id) });
    assert.equal(win.visible, !mac);
    assert.equal(win.destroyed, false, 'Ctrl-W must not exit Windows/Linux from the projects page');
    assert.deepEqual(closed, ['project']);
  });
}

for (const phase of ['Studio starting', 'Studio startup failed']) {
  test(`explicit Quit closes macOS window while ${phase}`, () => {
    const win = new Window();
    let quitting = false, agentsClosed = 0;
    keepWindowOnClose(win, { mac: true, isQuitting: () => quitting, save: () => {} });
    quitAfterStudio({ preventDefault() { assert.fail('without Studio, Quit must proceed'); } }, {
      quitting, markQuitting: () => { quitting = true; }, studio: null,
      closeAgents: () => agentsClosed++, quit: () => assert.fail('no second Quit needed'),
    });
    win.close();
    assert.equal(quitting, true);
    assert.equal(win.destroyed, true);
    assert.equal(agentsClosed, 1);
  });
}

for (const fail of [false, true]) {
  test(`Quit waits for Studio then re-enters without another shutdown, failure=${fail}`, async () => {
    const win = new Window();
    let quitting = false, stopped = 0, resolve, reject;
    const done = new Promise((yes, no) => { resolve = yes; reject = no; });
    const studio = { quit: () => { stopped++; return done; } };
    keepWindowOnClose(win, { mac: true, isQuitting: () => quitting, save: () => {} });
    let prevented = false;
    const options = () => ({
      quitting, markQuitting: () => { quitting = true; }, studio, closeAgents: () => {},
      quit: () => {
        quitAfterStudio({ preventDefault() { assert.fail('second Quit must proceed'); } }, options());
        win.close();
      },
    });
    quitAfterStudio({ preventDefault() { prevented = true; } }, options());
    assert.equal(prevented, true);
    assert.equal(quitting, true);
    assert.equal(win.destroyed, false);
    if (fail) reject(new Error('Studio already stopped')); else resolve();
    await done.catch(() => {});
    assert.equal(win.destroyed, true);
    assert.equal(stopped, 1);
  });
}
