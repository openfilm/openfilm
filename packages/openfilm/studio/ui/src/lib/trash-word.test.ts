import { test } from 'node:test';
import assert from 'node:assert/strict';

/** A dictionary's words as a system shows them: its module read afresh, with that system's `navigator.platform`. */
async function wordsOn(platform: string, file: string, name: string): Promise<string> {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { platform }, configurable: true });
  try {
    const module = await import(`../i18n/${file}?${platform}`);
    /* the Recycle Bin's refusals (recycle.*) come only from a Windows server, whatever shows them: they name it as it is */
    const { recycle, ...words } = module[name];
    return JSON.stringify(words);
  } finally {
    if (before) Object.defineProperty(globalThis, 'navigator', before);
  }
}

test('the trash is named as the system names it: the Recycle Bin on Windows, the Trash on a Mac', async () => {
  const zhWin = await wordsOn('Win32', 'zh-CN.ts', 'zhCN');
  assert.ok(zhWin.includes('移到回收站') && !zhWin.includes('废纸篓'));
  const zhMac = await wordsOn('MacIntel', 'zh-CN.ts', 'zhCN');
  assert.ok(zhMac.includes('移到废纸篓') && !zhMac.includes('回收站'));
  const enWin = await wordsOn('Win32', 'en.ts', 'en');
  assert.ok(enWin.includes('moves to the Recycle Bin') && !/trash/i.test(enWin));
  assert.ok((await wordsOn('MacIntel', 'en.ts', 'en')).includes('moves to the Trash'));
  assert.ok((await wordsOn('Win32', 'ja.ts', 'ja')).includes('ごみ箱'));
  assert.ok((await wordsOn('Win32', 'es.ts', 'es')).includes('la Papelera de reciclaje'));
});
