// @ts-check
/**
 * The words the library is searched by (library/tags.json): each tag a mood, a genre, an instrument, a sound, a look, a
 * motion or a use, named in each language Studio speaks, with the other words that say it (any language); and the
 * plain words that ask for nothing in particular. A text says
 * a tag when it holds one of its words: a word of letters as a whole word (`calm piano` says calm and piano; `rising`
 * and `rise` alike), one of CJK characters anywhere in it (`适合早晨的钢琴` says morning and piano).
 *
 * The things of the library carry their tags (`tags`, written once: scripts/library-describe.mjs for the sounds and
 * music, by hand for the rest); a thing's names say more of them, found as it is searched (src/library-search.mjs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {{ id: string, kind: string, name: Record<string, string>, words: string[] }} Tag */

/** CJK characters: Han, kana and Hangul. */
export const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

/** Lower case, without accents: `Canción` reads as `cancion` (and Hangul as it was written). @param {string} text */
export const fold = (text) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase();

/* words that only look plural */
const WHOLE = new Set(['news', 'bass', 'lens', 'chaos', 'series', 'canvas', 'christmas', 'xmas', 'bonus', 'status', 'cute']);

/**
 * A word as it is compared: its plural and its -ing, -ed and final e taken off, so `pads` is `pad`, and `rising`,
 * `rises` and `rise` are all `ris`.
 * @param {string} word
 */
export function stem(word) {
  if (WHOLE.has(word)) return word;
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ss|x|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** A text's words of letters and digits, folded and stemmed, in order. @param {string} text */
export const wordsOf = (text) => (fold(text).match(/[a-z0-9]+/g) ?? []).map(stem);

/**
 * The vocabulary, read once: the tags, and each one's words as they are looked for (a run of stemmed words, or CJK
 * text), the runs by their first word.
 * @param {string} root the library's folder
 */
export function vocabulary(root) {
  /** @type {{ plain: string[], tags: Tag[] }} */
  const file = JSON.parse(readFileSync(join(root, 'tags.json'), 'utf8'));
  /** @type {Map<string, { tag: string, run: string[] }[]>} */
  const runs = new Map();
  /** @type {{ tag: string, text: string }[]} */
  const cjk = [];
  for (const tag of file.tags) {
    for (const word of new Set([...Object.values(tag.name), ...tag.words])) {
      if (CJK.test(word)) { cjk.push({ tag: tag.id, text: fold(word) }); continue; }
      const run = wordsOf(word);
      if (!run.length) continue;
      const list = runs.get(run[0]) ?? [];
      list.push({ tag: tag.id, run });
      runs.set(run[0], list);
    }
  }
  /* the longest first, so `film grain` is taken before `film` */
  for (const list of runs.values()) list.sort((a, b) => b.run.length - a.run.length);
  cjk.sort((a, b) => b.text.length - a.text.length);
  /* the words that ask for nothing in particular (`for a`, `的`), left out of what is asked */
  const plain = new Set(file.plain.filter((w) => !CJK.test(w)).flatMap(wordsOf));
  const plainCjk = file.plain.filter((w) => CJK.test(w)).map(fold);
  return { tags: file.tags, byId: new Map(file.tags.map((t) => [t.id, t])), runs, cjk, plain, plainCjk };
}

/** @typedef {ReturnType<typeof vocabulary>} Vocabulary */

/**
 * The tags `text` says, and what is left of it: its words no tag took, and its CJK text with the tags' words taken out.
 * A word of one CJK character (`雪`) says its tag in what is asked, not in a name (`雪花屏`, TV static, is no snow).
 * @param {Vocabulary} vocab @param {string} text @param {{ asked?: boolean }} [o]
 */
export function readText(vocab, text, o = {}) {
  /** @type {Set<string>} */
  const tags = new Set();
  const words = wordsOf(text);
  /** @type {string[]} */
  const rest = [];
  for (let i = 0; i < words.length;) {
    /* the longest run that is there, and every tag it is a word of (`pop` the music and the sound) */
    const hits = (vocab.runs.get(words[i]) ?? []).filter((r) => r.run.every((w, k) => words[i + k] === w));
    const longest = hits[0]?.run.length ?? 0;
    for (const hit of hits) if (hit.run.length === longest) tags.add(hit.tag);
    if (longest) i += longest; else rest.push(words[i++]);
  }
  let han = (fold(text).match(new RegExp(`${CJK.source}+`, 'g')) ?? []).join(' ');
  /* the longest words first, each taken out once every tag of it has it: `古风` is no wind, `雨` is rain and weather */
  /** @type {string[]} */
  let taken = [];
  let size = 0;
  for (const { tag, text: w } of vocab.cjk) {
    if (w.length !== size) { for (const t of taken) han = han.replaceAll(t, ' '); taken = []; size = w.length; }
    if (!han.includes(w) || (w.length === 1 && !o.asked)) continue;
    tags.add(tag);
    taken.push(w);
  }
  for (const t of taken) han = han.replaceAll(t, ' ');
  return { tags, words: rest, cjk: han.trim() };
}

/** The tags a text says. @param {Vocabulary} vocab @param {string} text */
export const tagsIn = (vocab, text) => readText(vocab, text).tags;

/* how lively each kind of music is, before it is measured (library/audio.json's groups) */
const GROUP_ENERGY = /** @type {Record<string, number>} */ ({ calm: 1.5, warm: 2.5, emotional: 2.5, lofi: 2.5, corporate: 3, playful: 3, cinematic: 3, tense: 3, electronic: 4, upbeat: 4, festive: 4 });

/**
 * The sounds and music of library/audio.json described: each one's tags (from its names, its group and what it was
 * measured to be), its energy (1 calm – 5 driving, measured against the others of its kind), its tempo (`bpm`, music
 * with a clear beat) and whether it loops (`loop`). What was not measured is described by its names alone.
 * @param {Vocabulary} vocab
 * @param {{ id: string, cat: string, group: string, name: Record<string, string>, durationMs?: number, [k: string]: unknown }[]} items
 * @param {Record<string, { db: number, flux: number, centroid: number, bpm: number | null, steady: number, seam: number }>} measured
 * @param {Record<string, { id: string, name: Record<string, string> }[]>} groups the catalog's groups by category
 */
export function describeAudio(vocab, items, measured, groups) {
  /** each thing's place among the others of its category in how lively it sounds, 0–1 */
  const lively = new Map();
  for (const cat of ['music', 'sound']) {
    const own = items.filter((i) => i.cat === cat && measured[i.id]);
    if (!own.length) continue;
    const bpms = own.map((i) => measured[i.id].bpm).filter((b) => b != null).sort((a, b) => a - b);
    const mid = bpms[Math.floor(bpms.length / 2)] ?? 100;
    /** @param {(m: typeof measured[string]) => number} f */
    const z = (f) => {
      const v = own.map((i) => f(measured[i.id]));
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length) || 1;
      return v.map((x) => (x - mean) / sd);
    };
    const parts = [z((m) => m.db), z((m) => m.flux), z((m) => Math.log(Math.max(m.centroid, 50))), z((m) => m.bpm ?? mid)];
    const raw = own.map((_, k) => parts[0][k] + parts[1][k] + 0.5 * parts[2][k] + (cat === 'music' ? 0.5 * parts[3][k] : 0));
    const order = raw.map((r, k) => [r, k]).sort((a, b) => a[0] - b[0]);
    order.forEach(([, k], rank) => lively.set(own[k].id, rank / Math.max(1, order.length - 1)));
  }
  const order = new Map(vocab.tags.map((t, i) => [t.id, i]));
  return items.map((item) => {
    const m = measured[item.id];
    const group = groups[item.cat]?.find((g) => g.id === item.group);
    const said = tagsIn(vocab, `${item.name.en} ${item.id.split('/').pop()?.replace(/-[0-9a-f]{6}\.\w+$/, '').replaceAll('-', ' ')} ${group?.name.en ?? ''}`);
    const has = (/** @type {string[]} */ ...ids) => ids.some((id) => said.has(id));
    /* energy: as it sounds, and for music as its kind is; its name may say softer or harder */
    let energy = lively.has(item.id) ? 1 + 4 * lively.get(item.id) : (GROUP_ENERGY[item.group] ?? 3);
    if (item.cat === 'music' && lively.has(item.id)) energy = 0.6 * energy + 0.4 * (GROUP_ENERGY[item.group] ?? 3);
    if (has('soft')) energy -= 0.75;
    if (has('intense')) energy += 0.75;
    energy = Math.max(1, Math.min(5, Math.round(energy)));
    /* what a sound is like, not a picture (`warm` the mood, not the tone) */
    const tags = new Set([...said].filter((t) => !['energy', 'look', 'motion'].includes(vocab.byId.get(t)?.kind ?? '')));
    if (item.cat === 'music') {
      /* a morning: gentle and bright, on an acoustic instrument */
      const gentle = has('calm', 'warm', 'uplifting', 'happy') && !has('dark', 'tense', 'scary', 'sad', 'night', 'mysterious');
      if (gentle && energy >= 2 && energy <= 3 && has('piano', 'guitar', 'ukulele', 'mallets', 'woodwinds', 'plucked')) tags.add('morning');
      if (energy <= 3 && ['calm', 'warm', 'corporate', 'lofi'].includes(item.group)) tags.add('background');
      if (item.group === 'corporate' || has('tech')) tags.add('explainer');
      if (energy >= 3 && ['upbeat', 'warm', 'lofi', 'playful'].includes(item.group)) tags.add('vlog');
      if ((item.group === 'cinematic' || has('epic')) && energy >= 4) tags.add('trailer');
      if (has('playful') && has('bells', 'mallets', 'plucked', 'ukulele')) tags.add('kids');
      if (has('playful') && has('plucked')) tags.add('comedy');
      if (item.group === 'lofi') tags.add('focused');
      if (item.group === 'calm' && energy === 1 && has('ambient', 'bells', 'mallets')) tags.add('meditation');
      if (energy === 5 && ['electronic', 'cinematic', 'upbeat', 'tense'].includes(item.group)) tags.add('action');
    }
    const loop = Boolean(m && m.seam >= 0.8 && m.steady >= 0.6 && (item.durationMs ?? 0) >= 4000) || /\bloop\b/i.test(item.name.en);
    /** @type {Record<string, unknown> & typeof item} */
    const described = { ...item, tags: [...tags].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)), energy };
    delete described.bpm;
    delete described.loop;
    if (item.cat === 'music' && m?.bpm) described.bpm = m.bpm;
    if (loop) described.loop = true;
    return described;
  });
}
