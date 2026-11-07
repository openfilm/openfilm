// @ts-check
/**
 * A Local model run in a process of its own (studio/server/providers/local.mjs), so its memory (a gigabyte or two) is
 * given back when it is done, and the Studio that asked goes on meanwhile. Prints what it made as one line of JSON, or
 * `{ error }`.
 *
 *   node src/local-run.mjs asr <model> <samples>          samples: 16 kHz mono 32-bit float, little-endian (ffmpeg f32le)
 *   node src/local-run.mjs cutout <model> <picture> <out.png>
 */
import { readFileSync } from 'node:fs';

const [verb, id, ...rest] = process.argv.slice(2);
try {
  if (verb === 'asr') {
    const { transcribe } = await import('./local-asr.mjs');
    const bytes = readFileSync(rest[0]);
    const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.length & ~3)));
    console.log(JSON.stringify(await transcribe(id, samples)));
  } else if (verb === 'cutout') {
    const { cutout } = await import('./local-cutout.mjs');
    console.log(JSON.stringify(await cutout(id, rest[0], rest[1])));
  } else throw new Error(`no such run: ${verb}`);
} catch (e) {
  console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exitCode = 1;
}
