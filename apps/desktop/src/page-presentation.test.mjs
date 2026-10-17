import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPagePresentation, nextClosePage, revealPage } from './page-presentation.mjs';
import { createTabs } from './tabs.mjs';

function fixture() {
  const events = [], loads = new Map();
  const pages = createPagePresentation({
    prepare(id) {
      events.push(`prepare:${id}`);
      let resolve, reject;
      const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
      loads.set(id, { resolve, reject });
      return { view: id, ready };
    },
    present: (id) => events.push(`present:${id}`),
    discard: (id) => events.push(`discard:${id}`),
    onError: () => events.push('error'),
  });
  async function show(id) { const showing = pages.show(id); loads.get(id).resolve(); assert.equal(await showing, true); }
  return { pages, events, loads, show };
}

test('closing a page retains its frame until the cold replacement is ready', async () => {
  const f = fixture();
  await f.show('front');
  f.pages.retire('front');
  const next = f.pages.show('next');
  assert.equal(f.pages.currentId(), 'front');
  assert.ok(!f.events.includes('discard:front'));
  f.loads.get('next').resolve();
  assert.equal(await next, true);
  assert.deepEqual(f.events.slice(-2), ['present:next', 'discard:front']);
});

test('warming never focuses a page; an already ready page is presented synchronously', async () => {
  const f = fixture();
  await f.show('front');
  const warming = f.pages.warm('back');
  f.loads.get('back').resolve(); await warming;
  assert.equal(f.pages.currentId(), 'front');
  assert.ok(!f.events.includes('present:back'));
  f.pages.retire('front');
  const shown = f.pages.show('back');
  assert.equal(f.pages.currentId(), 'back', 'no asynchronous gap for a painted background page');
  assert.deepEqual(f.events.slice(-2), ['present:back', 'discard:front']);
  assert.equal(await shown, true);
});

test('rapid closes cannot reveal a retired or superseded replacement', async () => {
  const f = fixture();
  await f.show('a');
  f.pages.retire('a');
  const b = f.pages.show('b');
  f.pages.retire('b');
  const c = f.pages.show('c');
  f.loads.get('b').resolve();
  assert.equal(await b, false);
  assert.equal(f.pages.currentId(), 'a');
  f.loads.get('c').resolve();
  assert.equal(await c, true);
  assert.ok(!f.events.includes('present:b'));
  assert.deepEqual(f.events.slice(-2), ['present:c', 'discard:a']);
});

test('a load failure leaves the last frame in place and can be retried', async () => {
  const f = fixture();
  await f.show('a'); f.pages.retire('a');
  const failed = f.pages.show('b');
  f.loads.get('b').reject(new Error('offline'));
  assert.equal(await failed, false);
  assert.equal(f.pages.currentId(), 'a');
  assert.ok(!f.events.includes('discard:a'));
  await f.show('b');
  assert.equal(f.pages.currentId(), 'b');
});

test('idle cleanup never drops the visible frame or a requested replacement', async () => {
  const f = fixture();
  await f.show('a');
  const b = f.pages.show('b');
  assert.equal(f.pages.drop('a'), false);
  assert.equal(f.pages.drop('b'), false);
  f.loads.get('b').resolve(); await b;
  assert.equal(f.pages.drop('a'), true);
});

test('the native replacement is shown and raised before the outgoing page is hidden', () => {
  const events = [];
  let oldVisible = true, newVisible = false;
  const old = { setVisible: (visible) => { oldVisible = visible; assert.ok(newVisible); events.push('hide-old'); } };
  const target = { setVisible: (visible) => { newVisible = visible; assert.ok(oldVisible); events.push('show-new'); }, webContents: { focus: () => events.push('focus-new') } };
  revealPage({ addChildView: () => { assert.ok(newVisible && oldVisible); events.push('raise-new'); } }, target, [old, target]);
  assert.deepEqual(events, ['show-new', 'raise-new', 'hide-old', 'focus-new']);
});

test('preloads the same neighbor that tab close will select, or the projects page for the last tab', () => {
  const tabs = createTabs();
  const a = tabs.open({ projectId: 'a' }), b = tabs.open({ projectId: 'b' }), c = tabs.open({ projectId: 'c' });
  tabs.activate(b.id);
  assert.equal(nextClosePage(tabs), c.id);
  assert.equal(tabs.close(b.id).id, c.id);
  assert.equal(nextClosePage(tabs), a.id);
  tabs.close(c.id);
  assert.equal(nextClosePage(tabs), 'home');
});
