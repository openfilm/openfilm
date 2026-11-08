import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPagePresentation, paintPage, preparePage, revealPage, syncPagePointer, waitForPageFrame } from './page-presentation.mjs';
import { createTabs } from './tabs.mjs';
import { runInNewContext } from 'node:vm';

function fixture({ resume } = {}) {
  const events = [], loads = new Map();
  const pages = createPagePresentation({
    fallback: 'home',
    resume,
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

test('resuming a page refreshes the hover target in content coordinates, including displays left of the main screen', () => {
  const events = [];
  const contents = { sendInputEvent: event => events.push(event) };
  const bounds = { x: -1600, y: 40, width: 1200, height: 800 };
  syncPagePointer(contents, { x: -1250, y: 56 }, bounds);
  assert.deepEqual(events[0], { type: 'mouseMove', x: 350, y: 16, globalX: -1250, globalY: 56 });
  syncPagePointer(contents, { x: -1601, y: 56 }, bounds);
  assert.equal(events[1].type, 'mouseLeave', 'a cursor outside the window clears the old hover target');
  syncPagePointer(contents, { x: -400, y: 56 }, bounds);
  assert.equal(events[2].type, 'mouseLeave', 'the right edge belongs outside the content');
});

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
  const warming = f.pages.warm('home');
  f.loads.get('home').resolve(); await warming;
  assert.equal(f.pages.currentId(), 'front');
  assert.ok(!f.events.includes('present:home'));
  f.pages.retire('front');
  const shown = f.pages.show('home');
  assert.equal(f.pages.currentId(), 'home', 'no asynchronous gap for a painted background page');
  assert.deepEqual(f.events.slice(-2), ['present:home', 'discard:front']);
  assert.equal(await shown, true);
});

test('switching to a cached native page retains the outgoing frame until its compositor resumes', async () => {
  let finish;
  const f = fixture({ resume: () => new Promise(resolve => { finish = resolve; }) });
  await f.show('a'); await f.show('b');
  const before = f.events.length;
  const switching = f.pages.show('a');
  await Promise.resolve();
  assert.equal(f.pages.currentId(), 'b', 'a loaded document is not yet a restored native frame');
  assert.deepEqual(f.events.slice(before), [], 'the outgoing view stays in front');
  finish();
  assert.equal(await switching, true);
  assert.equal(f.pages.currentId(), 'a');
});

test('rapid cached-page switches expose only the latest refreshed frame', async () => {
  const frames = new Map();
  const f = fixture({ resume: id => new Promise(resolve => frames.set(id, resolve)) });
  await f.show('a'); await f.show('b'); await f.show('c');
  const before = f.events.length;
  const a = f.pages.show('a'); const b = f.pages.show('b');
  await Promise.resolve();
  frames.get('a')();
  assert.equal(await a, false);
  assert.equal(f.pages.currentId(), 'c');
  frames.get('b')();
  assert.equal(await b, true);
  assert.deepEqual(f.events.slice(before), ['present:b']);
});

test('returning to the current page cancels an in-flight cached switch without repainting the current view', async () => {
  let finish, resumes = 0;
  const f = fixture({ resume: () => { resumes++; return new Promise(resolve => { finish = resolve; }); } });
  await f.show('b'); await f.show('a');
  const b = f.pages.show('b'); const again = f.pages.show('b');
  await Promise.resolve();
  assert.equal(resumes, 1, 'repeated clicks share the same frame refresh');
  assert.equal(await f.pages.show('a'), true);
  finish();
  assert.equal(await b, false); assert.equal(await again, false);
  assert.equal(resumes, 1);
  assert.equal(f.pages.currentId(), 'a');
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

test('a failed replacement falls back to HOME before discarding the closed page', async () => {
  const f = fixture();
  await f.show('a'); f.pages.retire('a');
  const failed = f.pages.show('b');
  f.loads.get('b').reject(new Error('offline'));
  // Allow the failed load to request its fallback.
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.pages.currentId(), 'a');
  assert.ok(!f.events.includes('discard:a'));
  assert.equal(f.pages.wantedId(), 'home');
  f.loads.get('home').resolve();
  assert.equal(await failed, false);
  assert.equal(f.pages.currentId(), 'home');
  assert.deepEqual(f.events.slice(-2), ['present:home', 'discard:a']);
  assert.equal(f.events.filter((event) => event === 'error').length, 1);
});

test('an obsolete load rejection neither logs an error nor steals the latest destination', async () => {
  const f = fixture();
  await f.show('a'); f.pages.retire('a');
  const b = f.pages.show('b');
  f.pages.retire('b');
  const c = f.pages.show('c');
  f.loads.get('b').reject(new Error('view destroyed'));
  assert.equal(await b, false);
  assert.equal(f.pages.wantedId(), 'c');
  assert.ok(!f.events.includes('error'));
  assert.ok(!f.events.includes('prepare:home'));
  f.loads.get('c').resolve();
  assert.equal(await c, true);
  assert.equal(f.pages.currentId(), 'c');
});

test('a new request supersedes a pending HOME fallback', async () => {
  const f = fixture();
  await f.show('a'); f.pages.retire('a');
  const b = f.pages.show('b');
  f.loads.get('b').reject(new Error('offline'));
  await Promise.resolve(); await Promise.resolve();
  const c = f.pages.show('c');
  f.loads.get('home').resolve();
  assert.equal(await b, false);
  assert.equal(f.pages.currentId(), 'a');
  f.loads.get('c').resolve();
  assert.equal(await c, true);
  assert.equal(f.pages.currentId(), 'c');
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

test('idle neighbors are evicted even when they are the next close destination', async () => {
  const f = fixture();
  let clock = 0;
  const tabs = createTabs({ now: () => clock });
  const a = tabs.open({ projectId: 'a' });
  await f.show(a.id);
  const b = tabs.open({ projectId: 'b' });
  await f.show(b.id);
  clock = 10_000;
  for (const id of tabs.idle(5_000)) f.pages.drop(id);
  assert.ok(f.events.includes(`discard:${a.id}`));
  assert.equal(f.pages.currentId(), b.id);
});

test('a hung page load fails without presenting unloaded contents', async () => {
  const events = [];
  const contents = {
    loadURL: () => new Promise(() => {}),
    isDestroyed: () => false,
    stop: () => events.push('stop'),
    executeJavaScript: () => events.push('paint'),
  };
  await assert.rejects(preparePage(contents, 'https://studio.invalid/', { loadTimeoutMs: 5 }), /timed out/);
  assert.deepEqual(events, ['stop']);
});

test('a rejected load never waits for or presents a frame', async () => {
  const contents = {
    loadURL: () => Promise.reject(new Error('offline')),
    executeJavaScript: () => assert.fail('failed load must not paint'),
  };
  await assert.rejects(preparePage(contents, 'https://studio.invalid/'), /offline/);
});

test('a successful load requests bounded paint readiness', async () => {
  const events = [];
  const contents = {
    async loadURL() { events.push('load'); },
    isDestroyed: () => false,
    async executeJavaScript(script) {
      events.push('paint');
      await runInNewContext(script, {
        setTimeout, clearTimeout,
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
      });
    },
  };
  await preparePage(contents, 'https://studio.invalid/', { paintTimeoutMs: 5 });
  assert.deepEqual(events, ['load', 'paint']);
});

test('two painted frames clear their fallback timer; timeout cancels the pending frame', async () => {
  function paintFixture() {
    let timeout, frame;
    const events = [];
    const promise = runInNewContext(`(${waitForPageFrame.toString()})(500)`, {
      setTimeout: (fn) => { timeout = fn; return 'timer'; },
      clearTimeout: (id) => events.push(`clear:${id}`),
      requestAnimationFrame: (fn) => { frame = fn; return 'frame'; },
      cancelAnimationFrame: (id) => events.push(`cancel:${id}`),
    });
    return { promise, events, tickFrame: () => frame(), tickTimeout: () => timeout() };
  }
  const painted = paintFixture();
  painted.tickFrame(); painted.tickFrame(); await painted.promise;
  assert.deepEqual(painted.events, ['clear:timer', 'cancel:frame']);
  const throttled = paintFixture();
  throttled.tickTimeout(); await throttled.promise;
  assert.deepEqual(throttled.events, ['clear:timer', 'cancel:frame']);
});

test('frame readiness waits for the destination tab strip before counting paint frames', async () => {
  let frame, ready = false;
  const promise = runInNewContext(`(${waitForPageFrame.toString()})(500, '[data-project-tab="next"]')`, {
    setTimeout, clearTimeout,
    requestAnimationFrame: callback => { frame = callback; return 1; },
    cancelAnimationFrame: () => {},
    document: { querySelector: () => ready ? {} : null },
  });
  let done = false;
  void promise.then(() => { done = true; });
  frame(); frame(); await Promise.resolve();
  assert.equal(done, false, 'initial loading frames must not replace the outgoing editor');
  ready = true;
  frame(); await Promise.resolve(); assert.equal(done, false);
  frame(); assert.equal(await promise, true);
});

test('native readiness includes a submitted compositor surface, with a bounded tiny capture', async () => {
  let submitted;
  const contents = {
    isDestroyed: () => false,
    async executeJavaScript() { return true; },
    capturePage(rect, options) {
      assert.deepEqual(rect, { x: 0, y: 0, width: 1, height: 1 });
      assert.equal(options.stayHidden, true);
      return new Promise(resolve => { submitted = resolve; });
    },
  };
  let done = false;
  const ready = paintPage(contents, { readySelector: '[data-titlebar]' }).then(() => { done = true; });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(done, false);
  submitted(); await ready; assert.equal(done, true);
  await paintPage({ ...contents, capturePage: () => new Promise(() => {}) }, { paintTimeoutMs: 5 });
});

test('an editor that never mounts is not presented as a ready destination', async () => {
  await assert.rejects(paintPage({
    isDestroyed: () => false,
    executeJavaScript: () => new Promise(() => {}),
    capturePage: () => assert.fail('an unready editor must not be exposed'),
  }, { readySelector: '[data-titlebar]', readyTimeoutMs: 5 }), /did not become ready/);
});

test('a loaded but unresponsive renderer cannot leave the host waiting for frames forever', async () => {
  const contents = {
    async loadURL() {},
    isDestroyed: () => false,
    executeJavaScript: () => new Promise(() => {}),
  };
  await preparePage(contents, 'https://studio.invalid/', { paintTimeoutMs: 5 });
});

test('closing the last tab keeps its frame until cold HOME is ready', async () => {
  const f = fixture();
  await f.show('last');
  f.pages.retire('last');
  const home = f.pages.show('home');
  assert.equal(f.pages.currentId(), 'last');
  assert.ok(!f.events.includes('discard:last'));
  f.loads.get('home').resolve();
  assert.equal(await home, true);
  assert.deepEqual(f.events.slice(-2), ['present:home', 'discard:last']);
});
