import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchStudioVersion } from './studio-version.ts';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

/** A Studio whose answers are `versions`, one per ask (the last one repeats). */
function studio(...versions: (string | null)[]) {
  let i = 0;
  return () => Promise.resolve(versions[Math.min(i++, versions.length - 1)]);
}

test('back as the same version: the page stays', async () => {
  let reloads = 0;
  const watch = watchStudioVersion({ version: studio('0.1.2', '0.1.2'), idle: () => true, reload: () => reloads++, storage: memory() });
  assert.equal(await watch.back(), false);
  assert.equal(reloads, 0);
});

test('back as another version: the page reloads, once for that version', async () => {
  let reloads = 0;
  const storage = memory();
  const watch = watchStudioVersion({ version: studio('0.1.2', '0.1.3'), idle: () => true, reload: () => reloads++, storage });
  assert.equal(await watch.back(), true);
  assert.equal(reloads, 1);
  /* the reloaded page still disagrees (a stale copy): no loop */
  const again = watchStudioVersion({ version: studio('0.1.2', '0.1.3'), idle: () => true, reload: () => reloads++, storage });
  assert.equal(await again.back(), false);
  assert.equal(reloads, 1);
});

test('an edit being written is let through before the reload', async () => {
  const order: string[] = [];
  let writing = 3;
  const watch = watchStudioVersion({
    version: studio('0.1.2', '0.1.3'),
    idle: () => writing === 0,
    reload: () => order.push('reload'),
    storage: memory(),
    wait: async () => { writing -= 1; order.push('wait'); },
  });
  assert.equal(await watch.back(), true);
  assert.deepEqual(order, ['wait', 'wait', 'wait', 'reload']);
});

test('no answer, or nowhere to remember the reload: the page stays', async () => {
  let reloads = 0;
  const reload = () => reloads++;
  assert.equal(await watchStudioVersion({ version: studio(null, '0.1.3'), idle: () => true, reload, storage: memory() }).back(), false);
  assert.equal(await watchStudioVersion({ version: studio('0.1.2', null), idle: () => true, reload, storage: memory() }).back(), false);
  assert.equal(await watchStudioVersion({ version: studio('0.1.2', '0.1.3'), idle: () => true, reload, storage: null }).back(), false);
  const failing = () => Promise.reject(new Error('offline'));
  assert.equal(await watchStudioVersion({ version: failing, idle: () => true, reload, storage: memory() }).back(), false);
  assert.equal(reloads, 0);
});
