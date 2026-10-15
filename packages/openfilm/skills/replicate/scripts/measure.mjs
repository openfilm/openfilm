#!/usr/bin/env node
// @ts-check
/**
 * node measure.mjs <video>
 *
 * Prints the video's states and the changes between them (lib.mjs), draws its storyboard (<name>.storyboard-N.png,
 * a picture per state, numbered as printed) and keeps the measures as <name>.measure.json, all beside the video. A
 * transcript beside it (<name>.vtt) adds the words said during each state.
 */
import { writeFileSync } from 'node:fs';
import { describe, measure, storyboard } from './lib.mjs';

const file = process.argv[2];
if (!file) {
  console.error('node measure.mjs <video>');
  process.exit(2);
}
const base = file.replace(/\.[^.]+$/, '');
try {
  const m = measure(file);
  writeFileSync(`${base}.measure.json`, JSON.stringify(m));
  const pages = storyboard(m, `${base}.storyboard`);
  console.log([
    ...describe(m), '',
    ...pages.map((p) => `storyboard → ${p}`),
    `measures → ${base}.measure.json`,
    ...(m.words ? [] : [`No transcript beside it: for speech, \`npx openfilm get\` makes one (${base}.vtt); measure again after.`]),
  ].join('\n'));
} catch (e) {
  console.error(`measure: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
