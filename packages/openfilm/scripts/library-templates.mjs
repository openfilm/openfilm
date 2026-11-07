#!/usr/bin/env node
/**
 * The library's templates, by the definitions in library-templates.json: each a group of clips, as Saved keeps clips
 * saved together, made of the library's own things. Places for the person's pictures one after another, each its
 * example picture (files/example-<n>.jpg, made for that template and kept in its bundle; `data-slot`: which place, to
 * be replaced with their videos and photos), the transitions on their cuts, effects over all of them, and titles and
 * stickers each where it goes on any picture (`data-place`: its middle, and its height of the picture's, laid out as it
 * is put in). Its music is one of the library's, named in the catalog and put in with it. Put in, it plays as its
 * example until the person's own go in its places.
 * Writes each bundle under library/templates/<id>/ (saved.json and files/, every thing's files together) and
 * library/catalogs/templates.json.
 *
 *   node scripts/library-templates.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { libraryIndex } from '../studio/server/library.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'library');
const defs = JSON.parse(readFileSync(join(HERE, 'library-templates.json'), 'utf8'));
const items = new Map(/** @type {{ items: any[] }} */ (libraryIndex()).items.filter((i) => i.cat !== 'template').map((i) => [i.id, i]));
const round = (n) => Math.round(n * 1000) / 1000;
const need = (id) => { const item = items.get(id); if (!item) throw new Error(`no ${id} in the library`); return item; };
const savedOf = (id) => JSON.parse(readFileSync(join(LIB, id, 'saved.json'), 'utf8'));

/** Lanes for things in time: each on the first lane free at its time. */
function lanes(list) {
  const ends = [];
  return list.map((x) => {
    let lane = ends.findIndex((end) => end <= x.at + 0.001);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = x.at + x.len;
    return lane;
  });
}

const catalog = [];
for (const def of defs.templates) {
  const dir = join(LIB, 'templates', def.id);
  /* the bundle made again, its example pictures kept */
  const EXAMPLE = /^example-\d+\.jpg$/;
  mkdirSync(join(dir, 'files'), { recursive: true });
  for (const name of readdirSync(join(dir, 'files'))) if (!EXAMPLE.test(name)) rmSync(join(dir, 'files', name), { recursive: true, force: true });
  const used = new Set();
  /** whose each file in the bundle is, so two things never put different files in one place */
  const owner = new Map();
  /**
   * A thing of the library in the bundle, and its clip as saved. Its files go in files/ itself, not a folder of their
   * own: a project looks for pages three folders deep at most, and a template's are already two down in saved/.
   */
  const take = (id) => {
    const saved = savedOf(id);
    if (!used.has(id)) {
      const from = join(LIB, id, 'files');
      for (const rel of readdirSync(from, { recursive: true })) {
        const at = join(from, rel);
        if (statSync(at).isDirectory()) continue;
        const to = join(dir, 'files', rel);
        if (owner.has(rel) && !readFileSync(at).equals(readFileSync(to))) throw new Error(`${def.id}: ${id} and ${owner.get(rel)} both have a different ${rel}`);
        owner.set(rel, id);
        mkdirSync(dirname(to), { recursive: true });
        cpSync(at, to);
      }
      used.add(id);
    }
    return { ...saved.clip };
  };

  /* the pictures, one after another */
  const starts = [];
  let total = 0;
  for (const len of def.slots) { starts.push(round(total)); total = round(total + len); }
  const slots = def.slots.map((len, i) => {
    const example = `example-${i + 1}.jpg`;
    if (!existsSync(join(dir, 'files', example))) throw new Error(`${def.id}: no ${example} for its place ${i + 1}`);
    return { at: starts[i], clip: { src: example, time: [0, len], style: 'object-fit: cover', attrs: { 'data-slot': String(i + 1) } } };
  });

  /* a transition on each cut, its middle on it */
  const cuts = (def.cut ?? []).length ? starts.slice(1) : [];
  const transitions = cuts.map((cut, i) => {
    const id = def.cut[i % def.cut.length];
    const clip = take(id);
    const d = need(id).durationMs / 1000;
    return { at: round(Math.max(0, cut - d / 2)), clip: { ...clip, time: [0, d] } };
  });

  /* effects over the pictures, from `from` for `len` (all of it unless said) */
  const overs = (def.over ?? []).map((o) => {
    const from = o.at ?? 0;
    const len = o.len ?? total - from;
    return { at: round(from), clip: { ...take(o.item), time: [0, round(len)] } };
  });

  /* titles and stickers: their words, their variables, where they go */
  const marks = (def.marks ?? []).map((m) => {
    const item = need(m.item);
    const clip = take(m.item);
    /* the text component's looks and motions (their variables), then its own */
    const vars = { ...Object.assign({}, ...(m.looks ?? []).map((id) => need(id).vars)), ...m.vars };
    const overrides = [
      ...(Object.keys(vars).length ? [{ at: ':root', style: vars }] : []),
      ...Object.entries(m.words ?? {}).map(([at, text]) => ({ at, text })),
      ...(m.fade ? [{ fade: m.fade }] : []),
    ];
    const attrs = { ...(clip.attrs ?? {}), ...(item.w && item.h ? { 'data-place': JSON.stringify({ x: m.x ?? 0.5, y: m.y ?? 0.5, fit: m.fit ?? item.fit ?? 0.3 }) } : {}) };
    return {
      at: round(m.at ?? 0),
      len: m.len,
      clip: {
        ...clip, time: [0, round(m.len)],
        ...(item.w && item.h ? { size: { w: item.w, h: item.h } } : {}),
        ...(overrides.length ? { overrides } : {}),
        ...(Object.keys(attrs).length ? { attrs } : {}),
      },
    };
  });

  /* top to bottom: titles and stickers, transitions, effects, the pictures */
  const clips = [];
  const markLanes = lanes(marks);
  const nMarks = marks.length ? Math.max(...markLanes) + 1 : 0;
  marks.forEach((m, i) => clips.push({ track: markLanes[i], at: m.at, clip: m.clip }));
  let track = nMarks;
  if (transitions.length) { for (const x of transitions) clips.push({ track, ...x }); track += 1; }
  const overLanes = lanes(overs.map((o) => ({ at: o.at, len: o.clip.time[1] })));
  overs.forEach((o, i) => clips.push({ track: track + overLanes[i], ...o }));
  if (overs.length) track += Math.max(...overLanes) + 1;
  for (const s of slots) clips.push({ track, ...s });
  clips.sort((a, b) => a.track - b.track || a.at - b.at);

  const durationMs = Math.round(total * 1000);
  writeFileSync(join(dir, 'saved.json'), `${JSON.stringify({ version: 2, kind: 'group', clips, durationMs }, null, 1)}\n`);
  if (def.music) need(def.music);
  catalog.push({
    id: `templates/${def.id}`, cat: 'template', group: def.group, name: def.name, kind: 'group', durationMs,
    slots: def.slots.length, ...(def.music ? { music: def.music } : {}), ...(def.tags ? { tags: def.tags } : {}),
  });
  console.log(`→ library/templates/${def.id}: ${def.slots.length} pictures, ${total} s, ${used.size} things`);
}
/* what each says it is about and its tags (scripts/library-describe.mjs wrote them) stay as they were */
const before = existsSync(join(LIB, 'catalogs', 'templates.json')) ? JSON.parse(readFileSync(join(LIB, 'catalogs', 'templates.json'), 'utf8')).items : [];
for (const item of catalog) {
  const was = before.find((b) => b.id === item.id);
  if (was?.about) item.about = was.about;
  if (was?.tags && !item.tags) item.tags = was.tags;
}
writeFileSync(join(LIB, 'catalogs', 'templates.json'), `${JSON.stringify({ version: 1, groups: { template: defs.groups }, items: catalog }, null, 1)}\n`);
console.log(`${catalog.length} templates → library/catalogs/templates.json`);
