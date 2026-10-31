#!/usr/bin/env node
/**
 * The library's emoji stickers, from Microsoft's Fluent Emoji (MIT, github.com/microsoft/fluentui-emoji): each emoji's
 * 3D picture as a sticker (library/stickers/emoji.html beside it, coming in with a pop), named in five languages from
 * Unicode's CLDR annotations, grouped as Fluent groups them. Writes library/stickers.json (the server shows its things
 * with the library's own) and a bundle per emoji under library/stickers/emoji/ (published with the library, not kept
 * in git).
 *
 *   node scripts/library-stickers.mjs <fluent folder: one folder per emoji with 3d.png and metadata.json> <cldr folder: cldr-<lang>.json>
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'library');
const [fluent, cldr] = process.argv.slice(2);
if (!fluent || !cldr) throw new Error('usage: library-stickers.mjs <fluent folder> <cldr folder>');

const LANGS = { en: 'en', 'zh-CN': 'zh', ja: 'ja', ko: 'ko', es: 'es' };
const names = Object.fromEntries(Object.entries(LANGS).map(([lang, file]) => [lang, JSON.parse(readFileSync(join(cldr, `cldr-${file}.json`), 'utf8')).annotations.annotations]));
/* Fluent's groups as the library's, in the order the side bar lists them, named in five languages (library-sticker-groups.json) */
const GROUPS = JSON.parse(readFileSync(join(HERE, 'library-sticker-groups.json'), 'utf8')).map((g) => [g.fluent, g.id, g.name]);
const groupOf = Object.fromEntries(GROUPS.map(([fluentGroup, id]) => [fluentGroup, id]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/* a name: CLDR's for the glyph (without the variation selector), else Fluent's own words */
const nameOf = (glyph, fallback) => {
  const bare = glyph.replace(/️/g, '');
  return Object.fromEntries(Object.keys(LANGS).map((lang) => {
    const a = names[lang][glyph] ?? names[lang][bare];
    return [lang, a?.tts?.[0] ?? (lang === 'en' ? fallback : names.en[glyph]?.tts?.[0] ?? fallback)];
  }));
};

const items = [];
for (const folder of readdirSync(fluent).sort()) {
  const png = join(fluent, folder, '3d.png');
  const metaFile = join(fluent, folder, 'metadata.json');
  if (!existsSync(png) || !existsSync(metaFile)) continue;
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const group = groupOf[meta.group];
  if (!group) continue;
  const id = `stickers/emoji/${slug(folder)}`;
  const dir = join(LIB, id);
  mkdirSync(join(dir, 'files'), { recursive: true });
  copyFileSync(join(LIB, 'stickers', 'emoji.html'), join(dir, 'files', 'emoji.html'));
  copyFileSync(png, join(dir, 'files', 'emoji.png'));
  writeFileSync(join(dir, 'saved.json'), `${JSON.stringify({ version: 2, kind: 'clip', clip: { src: 'emoji.html', time: [0, 3] }, durationMs: 3000 })}\n`);
  items.push({
    id, cat: 'sticker', group, name: nameOf(meta.glyph, meta.cldr), kind: 'page', durationMs: 3000, src: 'emoji.html',
    w: 256, h: 256, fit: 0.3, poster: `${id}/files/emoji.png`, still: true,
    tags: (meta.keywords ?? []).slice(0, 8),
  });
}
const order = GROUPS.map(([, id]) => id);
items.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
writeFileSync(join(LIB, 'stickers.json'), `${JSON.stringify({ version: 1, groups: { sticker: GROUPS.map(([, id, name]) => ({ id, name })) }, items }, null, 1)}\n`);
console.log(`${items.length} emoji stickers → library/stickers.json`);
