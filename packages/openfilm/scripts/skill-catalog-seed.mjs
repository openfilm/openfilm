#!/usr/bin/env node
/** Refresh the offline official catalog from reviewed, pinned index entries. Downloads data only; never runs skills. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { INDEX_URL, indexEntries } from '../studio/server/skill-catalog.mjs';

const input = process.argv[2];
const index = input ? JSON.parse(await readFile(input, 'utf8')) : await (async () => {
  const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`The index answered ${response.status}.`);
  return response.json();
})();
const entries = indexEntries(index).filter((e) => new URL(e.repo).pathname.startsWith('/openfilm/'));
if (!entries.length) throw new Error('The index has no official skills.');
const skills = [], licenses = [];
for (const entry of entries) {
  if (!entry.files) throw new Error(`Pin ${entry.name} with its file manifest first.`);
  const root = `https://raw.githubusercontent.com/${new URL(entry.repo).pathname.slice(1)}/${entry.commit}`;
  const get = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`); return Buffer.from(await r.arrayBuffer()); };
  const files = await Promise.all(entry.files.map(async (file) => {
    const bytes = await get(`${root}/${entry.path}/${file.path}`);
    if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Invalid pinned file: ${entry.name}/${file.path}`);
    return { ...file, data: bytes.toString('base64') };
  }));
  licenses.push({ repo: entry.repo, commit: entry.commit, text: (await get(`${root}/LICENSE`)).toString('utf8') });
  skills.push({ ...entry, files });
}
await writeFile(new URL('../skill-catalog-seed.json', import.meta.url), `${JSON.stringify({ version: 1, read: new Date().toISOString(), skills, licenses })}\n`);
console.log(`Prepared ${skills.length} official skills for offline discovery; no skills executed.`);
