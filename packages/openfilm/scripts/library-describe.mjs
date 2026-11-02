#!/usr/bin/env node
/**
 * What the library's sounds and music are like, for `openfilm get` (src/library-search.mjs) to search by: each one of
 * library/audio.json measured (scripts/audio-measure.mjs) and given its tags of library/tags.json — its moods, its
 * instruments, what it is for (src/library-words.mjs describeAudio) — and, measured, its energy (1 calm – 5 driving), its tempo (bpm, music with a clear
 * beat) and whether it loops. Written into audio.json, each thing's own fields left as they were. Run on the computer
 * that has the files (library/audio/, published apart from git), once, after audio.json changes:
 *
 *   node scripts/library-describe.mjs
 *
 * What it measures is kept in library/audio/measures.json (with the files, not in git), so a run after a change of
 * the words measures only what is new. Everything runs here, with ffmpeg: nothing is sent anywhere.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure } from './audio-measure.mjs';
import { describeAudio, vocabulary } from '../src/library-words.mjs';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'library');
const RATE = 11025;
/* music is measured in its first minute: enough for its tempo and energy */
const LONGEST = 60;

/** A file's samples, mono at RATE, decoded by ffmpeg. @param {string} file */
function decode(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-t', String(LONGEST), '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    /** @type {Buffer[]} */
    const parts = [];
    p.stdout.on('data', (b) => parts.push(b));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg could not read ${file}`));
      const all = Buffer.concat(parts);
      resolve(new Float32Array(all.buffer, all.byteOffset, Math.floor(all.length / 4)));
    });
  });
}

const catalogFile = join(LIB, 'audio.json');
const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
const keptFile = join(LIB, 'audio', 'measures.json');
/** @type {Record<string, ReturnType<typeof measure>>} */
const kept = existsSync(keptFile) ? JSON.parse(readFileSync(keptFile, 'utf8')) : {};
const todo = catalog.items.filter((/** @type {{ id: string }} */ item) => !kept[item.id] && existsSync(join(LIB, item.id)));
let done = 0;
async function worker() {
  for (let item = todo.shift(); item; item = todo.shift()) {
    kept[item.id] = measure(/** @type {Float32Array} */ (await decode(join(LIB, item.id))), RATE);
    if (++done % 200 === 0) {
      console.error(`measured ${done}`);
      writeFileSync(keptFile, JSON.stringify(kept));
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, cpus().length - 2) }, worker));
writeFileSync(keptFile, JSON.stringify(kept));

const missing = catalog.items.filter((/** @type {{ id: string }} */ item) => !kept[item.id]).length;
if (missing) console.error(`${missing} not here to measure: described by their names only`);
catalog.items = describeAudio(vocabulary(LIB), catalog.items, kept, catalog.groups);
writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 1)}\n`);
console.error(`described ${catalog.items.length}`);
