#!/usr/bin/env node
// @ts-check
/**
 * The library's published parts, ready to upload: its sounds and music (`library/audio/`), its voices' samples
 * (`library/voices/`), its emoji stickers (`library/stickers/emoji/`), the model semantic search runs and its runtime
 * (`library/models/`, listed with their checksums in library/models.json), each template's example with its music
 * (`library/examples/`), none of them in git or the npm package. OpenFilm
 * fetches each on first use from openfilm.dev/library/<its place> (studio/server/library.mjs fetchLibrary).
 *
 *   node scripts/library-publish.mjs
 *
 * Writes the list of each bundle's files (`files.json` beside its `saved.json`, what fetchLibrary reads to fetch a whole
 * sticker), then says how many files and bytes there are to upload. Uploading them, the folder as it is under
 * `library/` on the host, is the hosting's own step.
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { builtInRoot } from '../studio/server/library.mjs';

const PARTS = ['audio', 'voices', 'stickers/emoji', 'models', 'examples'];
const root = builtInRoot();
let files = 0;
let bytes = 0;
let bundles = 0;

/** Every file under a folder, by its place in it. @param {string} dir @returns {string[]} */
const filesIn = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => relative(dir, join(e.parentPath, e.name)).split('\\').join('/'));

for (const part of PARTS) {
  const dir = join(root, part);
  let names;
  try { names = filesIn(dir); } catch { console.log(`${part}/: not here, skipped`); continue; }
  /* a bundle is a folder with a saved.json: its files listed beside it */
  for (const name of names.filter((n) => n.endsWith('/saved.json') || n === 'saved.json')) {
    const bundle = join(dir, name.slice(0, -'saved.json'.length));
    writeFileSync(join(bundle, 'files.json'), `${JSON.stringify(filesIn(bundle).filter((f) => f !== 'files.json').sort())}\n`);
    bundles += 1;
  }
  for (const name of filesIn(dir)) {
    files += 1;
    bytes += statSync(join(dir, name)).size;
  }
}
console.log(`${files} files, ${(bytes / 1e6).toFixed(0)} MB, ${bundles} bundles listed: upload ${root}/{${PARTS.join(',')}} to the host's library/`);
