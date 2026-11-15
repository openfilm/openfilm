#!/usr/bin/env node
// Compare decoded media on the original frame grid, reconstructing cropped and split draft layers.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { draftRasterFilter } from './draft-bench-frames.mjs';
const exec = promisify(execFile);
const [referencePath, draftPath, outputPath, mappingPath] = process.argv.slice(2);
if (!referencePath || !draftPath || !outputPath) throw Error('verify-draft-export.mjs REFERENCE_JSON DRAFT_FOLDER RESULT_JSON');
const reference = JSON.parse(await readFile(resolve(referencePath), 'utf8'));
const mapping = mappingPath ? JSON.parse(await readFile(resolve(mappingPath), 'utf8')) : {};
const root = resolve(draftPath), media = join(root, 'media');
const info = JSON.parse(await readFile(join(root, 'draft_info.json'), 'utf8'));
const names = await readdir(media);
const pixels = async (file, filter) => (await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '2', '-i', file,
  '-map', '0:v:0', '-vf', `fps=${info.fps},${filter},scale=iw:ih:flags=accurate_rnd+full_chroma_int,format=rgba`, '-f', 'framemd5', '-'], { maxBuffer: 32 << 20 })).stdout
  .split('\n').filter((s) => s && !s.startsWith('#')).map((s) => s.split(',').at(-1).trim());
const results = [];
for (const ref of reference) {
  const name = mapping[ref.name] ?? (ref.name.startsWith('captions-') ? names.find((n) => /^captions-.*\.mov$/.test(n)) : ref.name);
  if (!name || !names.includes(name)) { results.push({ name: ref.name, error: 'missing media' }); continue; }
  const stem = name.replace(/\.mov$/, '');
  const parts = names.filter((n) => n === name || (n.startsWith(stem + '.part-') && /\.part-\d+\.mov$/.test(n)))
    .sort((a, b) => (Number(/\.part-(\d+)/.exec(a)?.[1] ?? 0) - Number(/\.part-(\d+)/.exec(b)?.[1] ?? 0)));
  const hashes = [];
  for (const part of parts) {
    const material = info.materials.videos.find((m) => basename(m.path) === part);
    const segment = material && info.tracks.filter((t) => t.type === 'video').flatMap((t) => t.segments).find((s) => s.material_id === material.id);
    const restore = segment && (material.width !== info.canvas_config.width || material.height !== info.canvas_config.height)
      ? draftRasterFilter(info, segment) : 'null';
    hashes.push(...await pixels(join(media, part), restore));
  }
  const expected = ref.frames.map((s) => s.split(',').at(-1).trim());
  const differences = [];
  for (let i = 0; i < Math.max(hashes.length, expected.length); i++) if (hashes[i] !== expected[i]) differences.push(i);
  let audioMatches;
  if (ref.audioHash) {
    const { stdout } = await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', join(media, name), '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-']);
    audioMatches = stdout.trim() === ref.audioHash.trim();
  }
  const row = { name: ref.name, parts, expectedFrames: expected.length, actualFrames: hashes.length, differentFrames: differences.length,
    firstDifferences: differences.slice(0, 12), ...(audioMatches == null ? {} : { audioMatches }) };
  results.push(row); console.log(JSON.stringify(row));
}
await writeFile(resolve(outputPath), JSON.stringify({ fps: info.fps, canvas: info.canvas_config, results }, null, 2));
if (results.some((r) => r.error || r.differentFrames || r.audioMatches === false)) process.exitCode = 1;
