import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { en } from '../i18n/en.ts';

const src = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : sources(at);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [at] : [];
  });
}

const phrase = (path: string) => path.split('.').reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), en);

/* a path in no table comes back as itself (i18n/index.ts), so a typo would show on screen as `timeline.menuDelete` */
test('every path the UI looks up by name is a phrase in English', () => {
  const missing: string[] = [];
  for (const file of sources(src)) {
    /* t('a.b'), and each branch of t(x ? 'a.b' : 'c.d') */
    for (const [, args] of readFileSync(file, 'utf8').matchAll(/\bt\(([^()]*)\)/g)) {
      for (const [, path] of args.matchAll(/(?:^|[?:])\s*['"]([a-zA-Z]\w*(?:\.\w+)+)['"]/g)) {
        if (!path.startsWith('plugin.') && typeof phrase(path) !== 'string') missing.push(`${relative(src, file)}: ${path}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
