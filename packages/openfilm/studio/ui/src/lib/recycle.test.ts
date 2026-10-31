import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recycleRefusalOf, recycleRefusalWords } from './recycle.ts';
import { en } from '../i18n/en.ts';
import { zhCN } from '../i18n/zh-CN.ts';

const tOf = (words: Record<string, unknown>) => (path: string) => path.split('.').reduce<unknown>((at, key) => (at as Record<string, unknown>)?.[key], words) as string;

test('a 409 that is the Recycle Bin refusing is known from its body; any other 409 is not', () => {
  const body = { error: 'render.mp4 cannot go to the Recycle Bin: …', code: 'recycle', why: 'too-big', name: 'render.mp4', drive: 'D:', size: '12.4 GB', holds: '5 GB' };
  assert.deepEqual(recycleRefusalOf(body), { code: 'recycle', why: 'too-big', name: 'render.mp4', drive: 'D:', size: '12.4 GB', holds: '5 GB' });
  assert.deepEqual(recycleRefusalOf({ error: 'x', code: 'recycle', why: 'network', name: 'take.wav', drive: '\\\\nas\\films\\', size: null, holds: null })?.why, 'network');
  assert.equal(recycleRefusalOf({ error: 'name taken' }), null);
  assert.equal(recycleRefusalOf({ code: 'recycle', why: 'melted', name: 'a', drive: 'C:' }), null);
  assert.equal(recycleRefusalOf(null), null);
});

test('the refusal is said whole, in the language of the UI, with the item, the drive and the sizes', () => {
  const t = tOf(en);
  assert.match(recycleRefusalWords(t, { code: 'recycle', why: 'too-big', name: 'render.mp4', drive: 'D:', size: '12.4 GB', holds: '5 GB' }),
    /^“render\.mp4” stays where it is: it is 12\.4 GB, more than the Recycle Bin of drive D: holds \(5 GB\)\. (File Explorer|Finder|Files) can delete it for good\.$/);
  assert.match(recycleRefusalWords(t, { code: 'recycle', why: 'network', name: 'take.wav', drive: '\\\\nas\\films\\' }), /^“take\.wav” stays where it is: it is on a network drive, which has no Recycle Bin\. /);
  assert.match(recycleRefusalWords(t, { code: 'recycle', why: 'nuke', name: 'Trip', drive: 'E:' }), /the Recycle Bin of drive E: is set to delete files right away/);
  assert.match(recycleRefusalWords(t, { code: 'recycle', why: 'no-volume', name: 'Trip', drive: 'S:' }), /drive S:/);
  const zh = recycleRefusalWords(tOf(zhCN), { code: 'recycle', why: 'too-big', name: 'render.mp4', drive: 'D:', size: '12.4 GB', holds: '5 GB' });
  assert.match(zh, /render\.mp4/);
  assert.match(zh, /12\.4 GB/);
  assert.match(zh, /D:/);
  assert.doesNotMatch(zh, /\{/);
});
