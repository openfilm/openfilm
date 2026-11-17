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

test('OpenFilm’s recycle bin has one name on every system', async () => {
  for (const platform of ['Win32', 'MacIntel', 'Linux x86_64']) {
    const zh = await wordsOn(platform, 'zh-CN.ts', 'zhCN');
    assert.ok(zh.includes('移到回收站') && !zh.includes('废纸篓'), platform);
    const en = await wordsOn(platform, 'en.ts', 'en');
    assert.ok(en.includes('moves to the Recycle Bin') && !/trash/i.test(en), platform);
    assert.ok((await wordsOn(platform, 'ja.ts', 'ja')).includes('ごみ箱'), platform);
    assert.ok((await wordsOn(platform, 'es.ts', 'es')).includes('la Papelera de reciclaje'), platform);
  }
});
