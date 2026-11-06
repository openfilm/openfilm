// @ts-check
/**
 * The library's verbs of `openfilm get` (LIBRARY_VERBS: music-search, sfx-search, transition, effect, filter, sticker,
 * text, template): OpenFilm's own library (studio/server/library.mjs) searched, so a film uses a sound, a music bed, a
 * transition, an effect, a filter, a sticker, a text or a template that is already there, free, where it fits; and the
 * one chosen taken into the project, as Studio's assets drawer takes it.
 *
 * The keyword search runs here, offline: what was asked is read for the library's tags (src/library-words.mjs) and
 * its other words, and each thing of the kind asked is scored by what it shares with it — a tag its names say counts
 * most, then a tag it carries, a word of its names, a word of what it is about — each the more the fewer things have
 * it. Music and sounds are also matched on how lively they are (`calm`, `soft`, `energetic` against their energy), a
 * tempo asked (`120 bpm`) and the length asked (--sec). Online, what is meant counts too (library-semantic.mjs).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { BUILT_IN, builtInRoot, catalogFiles, fetchLibrary, libraryIndex, refreshCommunity } from '../studio/server/library.mjs';
import { CJK, fold, readText, stem, tagsIn, vocabulary, wordsOf } from './library-words.mjs';

/** What can be looked for, and the library's category of each. */
export const KINDS = /** @type {const} */ ({ music: 'music', sound: 'sound', transition: 'transition', effect: 'effect', filter: 'filter', sticker: 'sticker', text: 'text', template: 'template' });

/** @typedef {{ id: string, cat: string, group: string, kind: string, name: Record<string, string>, durationMs?: number, tags?: string[], about?: string, energy?: number, bpm?: number, loop?: boolean, place?: string, poster?: string, sample?: string, [k: string]: unknown }} Item */


/**
 * The library as it is searched: its things by id, the rows of what they are searched by, and each thing's Doc made
 * from its row when it is first searched (a music search makes none for the 5,400 sounds).
 * @typedef {{ index: unknown, vocab: ReturnType<typeof vocabulary>, items: Map<string, Item>, rows: Map<string, Row>, docs: Map<string, Doc> }} Searched
 */
/** @type {Searched | null} */
let kept = null;

/** @typedef {{ item: Item, tags: Set<string>, named: Set<string>, nameWords: Set<string>, words: Set<string>, cjk: string, title: string[] }} Doc */

/**
 * What a thing is searched by, as library/search.json keeps it: its id, its tags, the tags its names say, the words of
 * its names, its other words (each tab-separated: an emoji's tag may have a space), its CJK names, and its names as asked for (one a line).
 * @typedef {[string, string, string, string, string, string, string]} Row
 */

/**
 * The row of each thing of the library (`index`), worked out from its names, group, tags and what it is about.
 * scripts/library-search-index.mjs writes them to library/search.json when the library changes, so a search reads them
 * rather than works them out (a few hundred milliseconds).
 * @param {{ items: Item[], groups: Record<string, { id: string, name: Record<string, string> }[]> }} index
 * @param {ReturnType<typeof vocabulary>} vocab @returns {Row[]}
 */
export function searchRows(index, vocab) {
  return index.items.map((item) => {
    const group = index.groups[item.cat]?.find((g) => g.id === item.group);
    const slug = (item.id.split('/').pop() ?? '').replace(/(-[0-9a-f]{6})?\.\w+$/, '').replaceAll('-', ' ');
    const names = `${item.name.en} ${item.name.es ?? ''} ${slug}`;
    /* a sound is what it sounds like, not a picture's look (`warm` the mood, not the tone) */
    const fits = (/** @type {string} */ t) => item.kind !== 'sound' || !['look', 'motion'].includes(vocab.byId.get(t)?.kind ?? '');
    const named = new Set([...tagsIn(vocab, `${names} ${['zh-CN', 'ja', 'ko'].map((l) => item.name[l] ?? '').join(' ')}`)].filter(fits));
    const grouped = [...tagsIn(vocab, Object.values(group?.name ?? {}).join(' '))].filter(fits);
    const set = (/** @type {Iterable<string>} */ list) => [...new Set(list)].join('\t');
    return [item.id, set([...named, ...(item.tags ?? []), ...grouped]), set(named), set(wordsOf(names)),
      set(wordsOf(`${item.about ?? ''} ${group?.name.en ?? ''} ${(item.tags ?? []).join(' ')}`)),
      fold(['zh-CN', 'ja', 'ko'].map((l) => `${item.name[l] ?? ''} ${group?.name[l] ?? ''}`).join(' ')),
      [wordsOf(item.name.en).join(' '), ...['zh-CN', 'ja', 'ko'].map((l) => fold(item.name[l] ?? ''))].join('\n')];
  });
}

/**
 * library/search.json for the library as it is: the digest of its inputs, then a row a line.
 * @param {{ items: Item[], groups: Record<string, { id: string, name: Record<string, string> }[]> }} index
 */
export const searchFile = (index) => `{"version": 1, "inputs": ${JSON.stringify(searchInputs())}, "rows": [\n${searchRows(index, vocabulary(builtInRoot())).map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;

/** What the rows are worked out from: the library's catalogs and its tags, as they are now (a digest of them). */
export function searchInputs() {
  const hash = createHash('sha256');
  for (const name of ['index.json', 'tags.json', ...catalogFiles()]) {
    try { hash.update(readFileSync(join(builtInRoot(), name))); } catch { hash.update(`no ${name}`); }
  }
  return hash.digest('hex').slice(0, 16);
}

/** What each thing is searched by, made once for the library as it is: library/search.json's rows when they are of it. @returns {Searched} */
function library() {
  const index = libraryIndex();
  if (kept && kept.index === index) return kept;
  const vocab = vocabulary(builtInRoot());
  const library = /** @type {{ items: Item[], groups: Record<string, { id: string, name: Record<string, string> }[]> }} */ (index);
  /** @type {Row[] | null} */
  let rows = null;
  try {
    const file = JSON.parse(readFileSync(join(builtInRoot(), 'search.json'), 'utf8'));
    if (file.inputs === searchInputs()) rows = file.rows;
  } catch { /* none: worked out here */ }
  if (rows) rows = [...rows, ...searchRows({ ...library, items: library.items.filter((item) => item.id.startsWith('community/')) }, vocab)];
  else rows = searchRows(library, vocab);
  const made = { index, vocab, items: new Map(library.items.map((item) => [item.id, item])), rows: new Map(rows.map((r) => [r[0], r])), docs: new Map() };
  kept = made;
  return made;
}

/** What a thing is searched by (null: no such thing), made from its row once. @param {Searched} at @param {string} id */
function docOf(at, id) {
  const was = at.docs.get(id);
  if (was) return was;
  const item = at.items.get(id);
  const row = at.rows.get(id);
  if (!item || !row) return null;
  const [, tags, named, nameWords, other, cjk, title] = row;
  const words = (/** @type {string} */ s) => new Set(s ? s.split('\t') : []);
  /** @type {Doc} */
  const doc = { item, tags: words(tags), named: words(named), nameWords: words(nameWords), words: words(other), cjk, title: title.split('\n') };
  at.docs.set(id, doc);
  return doc;
}

/** How rare a thing is among `n`, `count` having it: the rarer, the more it says. */
const rarity = (/** @type {number} */ n, /** @type {number} */ count) => Math.log(1 + n / (1 + count));

/**
 * What a query asks for, as the keyword search reads it: the library's tags it names (a mood's energy apart), its
 * other words, the words a tag took (still looked for in names), CJK left over in pairs of characters, the energy a
 * mood asks for, a tempo.
 * @param {ReturnType<typeof vocabulary>} vocab @param {string} query
 */
function askedIn(vocab, query) {
  const asked = readText(vocab, query, { asked: true });
  const bpm = Number(/(\d{2,3})\s*bpm/i.exec(query)?.[1]) || null;
  const words = asked.words.filter((w) => !vocab.plain.has(w) && !/^\d+$/.test(w) && w !== 'bpm');
  /* the words a tag took, still looked for in names: `snow` is weather, and Snow is the one asked */
  const tagged = wordsOf(query).filter((w) => !vocab.plain.has(w) && !words.includes(w));
  /* CJK left over, in pairs of characters: matched in the things' names */
  const pairs = [];
  for (const run of vocab.plainCjk.reduce((text, w) => text.replaceAll(w, ' '), asked.cjk).split(/\s+/).filter(Boolean)) {
    if (run.length === 1) pairs.push(run);
    for (let i = 0; i + 1 < run.length; i++) pairs.push(run.slice(i, i + 2));
  }
  const lively = [...asked.tags].filter((t) => vocab.byId.get(t)?.kind === 'energy');
  const tags = [...asked.tags].filter((t) => !lively.includes(t));
  /* a mood asks for its energy too */
  const wants = lively.includes('intense') ? 5 : lively.includes('soft') || tags.some((t) => ['calm', 'meditation', 'dreamy'].includes(t)) ? 1 : null;
  return { bpm, words, tagged, pairs, tags, wants };
}

/**
 * The things of the library of `kind` (all kinds when null) that fit `query` best, the best first.
 * @param {keyof typeof KINDS | null} kind @param {string} query
 * @param {{ duration?: number, limit?: number }} [o] duration: the seconds it is wanted for
 * @returns {Found[]}
 */
export function findInLibrary(kind, query, o = {}) {
  const at = library();
  const { vocab } = at;
  const all = [...at.items.values()].filter((item) => !kind || item.cat === KINDS[kind]).map((item) => docOf(at, item.id)).filter((d) => d !== null);
  const { bpm, words, tagged, pairs, tags, wants } = askedIn(vocab, query);
  const said = wordsOf(query).filter((w) => !vocab.plain.has(w)).join(' ');
  const folded = fold(query);
  const n = all.length;
  const count = (/** @type {(d: Doc) => boolean} */ f) => all.reduce((s, d) => s + (f(d) ? 1 : 0), 0);
  const tagRarity = new Map(tags.map((t) => [t, rarity(n, count((d) => d.tags.has(t)))]));
  const wordRarity = new Map(words.map((w) => [w, rarity(n, count((d) => d.nameWords.has(w) || d.words.has(w)))]));
  const taggedRarity = new Map(tagged.map((w) => [w, rarity(n, count((d) => d.nameWords.has(w)))]));
  const pairRarity = new Map(pairs.map((p) => [p, rarity(n, count((d) => d.cjk.includes(p)))]));
  const asks = tags.length + words.length + (pairs.length ? 1 : 0) + (wants ? 1 : 0) + (bpm ? 1 : 0);
  const top = Math.max(1, ...tagRarity.values(), ...wordRarity.values());
  const results = [];
  for (const d of all) {
    let score = 0;
    let met = 0;
    for (const t of tags) {
      if (!d.tags.has(t)) continue;
      score += (d.named.has(t) ? 3 : 2) * /** @type {number} */ (tagRarity.get(t));
      met++;
    }
    for (const w of words) {
      const r = /** @type {number} */ (wordRarity.get(w));
      if (d.nameWords.has(w)) { score += 3 * r; met++; } else if (d.words.has(w)) { score += r; met++; }
    }
    for (const w of tagged) if (d.nameWords.has(w)) score += /** @type {number} */ (taggedRarity.get(w));
    let paired = 0;
    for (const p of pairs) if (d.cjk.includes(p)) { score += 1.5 * /** @type {number} */ (pairRarity.get(p)); paired++; }
    if (paired) met += paired / pairs.length;
    if (wants && d.item.energy) {
      const near = 1 - Math.abs(wants - d.item.energy) / 4;
      score += 1.5 * top * (near - 0.5);
      if (near >= 0.75) met++;
    } else if (wants) {
      const t = wants === 5 ? 'intense' : 'soft';
      if (d.tags.has(t)) { score += 2 * top; met++; }
    }
    if (bpm && d.item.bpm) {
      const off = Math.abs(d.item.bpm - bpm);
      if (off <= 8) { score += 2 * top * (1 - off / 16); met++; }
    }
    /* asked for by its name */
    const named = d.title.some((t) => t && (t === said || (CJK.test(t) && t.length > 1 && folded.includes(t))));
    if (named) score += 2 * top;
    if (score <= 0 || !met) continue;
    /* the more of what was asked it has, the better */
    score *= 0.4 + 0.6 * Math.min(1, met / Math.max(1, asks));
    if (o.duration && d.item.durationMs) {
      const secs = d.item.durationMs / 1000;
      if (d.item.cat !== 'music') score /= 1 + Math.abs(Math.log(secs / o.duration));
    } else if (d.item.cat === 'music' && d.item.durationMs) {
      /* music for a scene rather than a sting, when no length is asked */
      score *= Math.min(1, 0.8 + (0.2 * d.item.durationMs) / 30000);
    }
    results.push({ item: d.item, score, tags: [...d.tags], named, short: tooShort(d.item, o.duration) });
  }
  results.sort(inOrder((r) => r.score));
  return results.slice(0, o.limit ?? 8);
}

/** @typedef {{ item: Item, score: number, tags: string[], named: boolean, short: boolean }} Found */

/**
 * What of a query a thing has and what it has not, word by word as it was asked (a tempo as one): a word it has when
 * its names or what it is about say it, or it carries a tag the word names; a word of energy (`fast`, `gentle`) when
 * it is about that lively; CJK in runs, between the words that ask for nothing. So whoever chooses sees how well it fits.
 * @param {Item} item @param {string} query
 * @returns {{ has: string[], lacks: string[] }}
 */
export function fitOf(item, query) {
  const at = library();
  const { vocab } = at;
  const d = docOf(at, item.id);
  /** @type {{ has: string[], lacks: string[] }} */
  const fit = { has: [], lacks: [] };
  if (!d) return fit;
  const carries = (/** @type {string} */ text) => [...readText(vocab, text, { asked: true }).tags].some((t) => {
    if (vocab.byId.get(t)?.kind !== 'energy') return d.tags.has(t);
    return item.energy ? Math.abs((t === 'intense' ? 5 : 1) - item.energy) <= 1 : d.tags.has(t);
  });
  const bpm = /(\d{2,3})\s*bpm/i.exec(query);
  if (bpm) (item.bpm && Math.abs(item.bpm - Number(bpm[1])) <= 8 ? fit.has : fit.lacks).push(`${bpm[1]} bpm`);
  const rest = bpm ? query.replace(bpm[0], ' ') : query;
  for (const word of new Set(fold(rest).match(/[a-z0-9]+/g) ?? [])) {
    const w = stem(word);
    if (vocab.plain.has(w) || /^\d+$/.test(w)) continue;
    (d.nameWords.has(w) || d.words.has(w) || carries(word) ? fit.has : fit.lacks).push(word);
  }
  const cjk = (fold(rest).match(new RegExp(`${CJK.source}+`, 'gu')) ?? []).join(' ');
  for (const run of vocab.plainCjk.reduce((text, w) => text.replaceAll(w, ' '), cjk).split(/\s+/).filter(Boolean)) {
    const pairs = run.length === 1 ? [run] : Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2));
    (carries(run) || pairs.filter((x) => d.cjk.includes(x)).length * 2 >= pairs.length ? fit.has : fit.lacks).push(run);
  }
  return fit;
}

/** Music shorter than asked, and no loop: after all that is long enough. @param {Item} item @param {number} [duration] */
const tooShort = (item, duration) => Boolean(duration && item.cat === 'music' && item.durationMs && item.durationMs / 1000 < duration && !item.loop);

/** The order results are given in: what is long enough first, then what was asked for by its name, then `by`. */
const inOrder = (/** @type {(r: Found) => number} */ by) => (/** @type {Found} */ a, /** @type {Found} */ b) =>
  Number(a.short) - Number(b.short) || Number(b.named) - Number(a.named) || by(b) - by(a) || a.item.id.localeCompare(b.item.id);

/* how far down a list a place still counts in the merge, and how much the first places count more (reciprocal rank) */
const DEPTH = 50;
const RRF_K = 60;

/**
 * The keyword search's results and the semantic search's nearest things (library-semantic.mjs) as one list, each
 * thing scored by its places in both (reciprocal rank fusion): a thing high in either comes up, one high in both
 * first. The keyword search alone when the model is not ready here. A vector is near something whatever is asked
 * (`qwzxv` is as near some music as `sad goodbye at a train station`), so `worded` says whether any words matched.
 * @param {keyof typeof KINDS} kind @param {string} query @param {{ duration?: number, limit?: number }} [o]
 * @returns {Promise<{ found: Found[], worded: boolean }>}
 */
export async function searchLibrary(kind, query, o = {}) {
  await refreshCommunity();
  const words = findInLibrary(kind, query, { ...o, limit: DEPTH });
  const at = library();
  const { nearest } = await import('./library-semantic.mjs');
  /* what the service has that this catalog has not (a newer library's) is left out */
  const near = (await nearest(query, KINDS[kind], DEPTH))?.filter(([id]) => at.items.get(id)?.cat === KINDS[kind]);
  if (!near) return { found: words.slice(0, o.limit ?? 8), worded: words.length > 0 };
  /** @type {Map<string, Found & { fused: number }>} */
  const all = new Map(words.map((r, i) => [r.item.id, { ...r, fused: 1 / (RRF_K + i) }]));
  near.forEach(([id], i) => {
    const was = all.get(id);
    if (was) { was.fused += 1 / (RRF_K + i); return; }
    const d = docOf(at, id);
    if (!d) return;
    all.set(id, { item: d.item, score: 0, tags: [...d.tags], named: false, short: tooShort(d.item, o.duration), fused: 1 / (RRF_K + i) });
  });
  return { found: [...all.values()].sort(inOrder((r) => /** @type {Found & { fused: number }} */ (r).fused)).slice(0, o.limit ?? 8), worded: words.length > 0 };
}

/** The language a query is written in, when its script says (CJK); else English. @param {string} text */
export function languageOf(text) {
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  return CJK.test(text) ? 'zh-CN' : 'en';
}

/** `m:ss`. @param {number} ms */
const clock = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Where a thing can be seen or heard on this computer, or null when its file is not here. @param {Item} item */
export function previewOf(item) {
  const root = builtInRoot();
  const rel = item.kind === 'sound' ? item.id : item.poster ?? item.sample
    ?? (['page', 'motion', 'group'].includes(item.kind) ? `${item.id}/preview.mp4` : null);
  return rel && existsSync(join(root, rel)) ? join(root, rel) : null;
}

/** The project `from` is in (it, or a folder above it), if any. @param {string} from */
export function projectAround(from) {
  for (let up = resolve(from); up !== dirname(up); up = dirname(up)) if (existsSync(join(up, 'film.html'))) return up;
  return null;
}

/** An option of a library verb, as `openfilm get` lists options. */
const PROMPT = { value: 'text' };
const TAKE = { value: 'id' };
const LIMIT = { value: 'n', min: 1, max: 50, default: 8, alias: 'n' };
const SEC = { value: 'seconds' };

/**
 * The library's verbs of `openfilm get`: free and offline. `music-search` and `sfx-search` sit beside `music` and
 * `sfx` (what is there, or one made to the prompt: the agent chooses), as `image-search` sits beside `image`; what only the library has is a verb
 * of its own name. Each searches with --prompt, and takes one into the project with --take.
 * @type {Record<string, { kind: keyof typeof KINDS, makes?: string, help: string, options: Record<string, object> }>}
 */
export const LIBRARY_VERBS = {
  'music-search': { kind: 'music', makes: 'music', options: { prompt: PROMPT, sec: SEC, limit: LIMIT, take: TAKE },
    help: 'Free and offline: OpenFilm\'s own music (CC0), searched in any words and language. Returns the best matches: id, name, length, tempo, energy 1–5, whether it loops, what of the prompt it has and lacks, a file to hear it; --sec puts what is at least that long first. --take <id> copies one into assets/. Music of the film\'s own, made to the prompt and length: `get music`.' },
  'sfx-search': { kind: 'sound', makes: 'sfx', options: { prompt: PROMPT, sec: SEC, limit: LIMIT, take: TAKE },
    help: 'Free and offline: OpenFilm\'s own sound effects (CC0), about 5,400, searched in any words and language. Returns the best matches: id, name, length, what of the prompt it has and lacks, a file to hear it; --sec puts those near that long first. --take <id> copies one into assets/. A sound of the film\'s own, made to the prompt and length: `get sfx`.' },
  transition: { kind: 'transition', options: { prompt: PROMPT, limit: LIMIT, take: TAKE },
    help: 'Free and offline: OpenFilm\'s transitions over a cut (light, glitch, shapes, film, ink, wipes, camera moves). Search them before writing one. --take <id> copies it into the project and says where it goes in film.html.' },
  effect: { kind: 'effect', options: { prompt: PROMPT, limit: LIMIT, take: TAKE },
    help: 'Free and offline: OpenFilm\'s effects over a clip (grain, light leaks, snow, confetti, frames) and motions in and out. Search them before writing one. --take <id> copies it into the project and says how to use it.' },
  filter: { kind: 'filter', options: { prompt: PROMPT, limit: LIMIT, take: TAKE },
    help: 'Free and offline: OpenFilm\'s color grades (film, cinema, portrait, vintage, black and white…). The person puts one on a clip in Studio.' },
  sticker: { kind: 'sticker', options: { prompt: PROMPT, limit: LIMIT, take: TAKE },
    help: 'Free and offline: OpenFilm\'s stickers: 1,587 emoji, and arrows, marks, buttons and badges that move. --take <id> copies one into the project.' },
  text: { kind: 'text', options: { prompt: PROMPT, limit: LIMIT, take: TAKE },
    help: 'Free and offline: OpenFilm\'s text templates (titles, name cards, callouts, chapters, endings) and text looks and motions. --take <id> copies a template into the project.' },
  template: { kind: 'template', options: { prompt: PROMPT, limit: LIMIT, take: TAKE },
    help: 'Free and offline: OpenFilm\'s templates, short films with places for the film\'s own videos and photos, titles, effects and music on them. --take <id> copies one into the project.' },
};

/** The library's verbs as `openfilm get` lists them (`only`: that one). @param {string} [only] */
export const libraryVerbs = (only) => Object.entries(LIBRARY_VERBS).filter(([verb]) => !only || verb === only)
  .map(([verb, v]) => ({ verb, help: v.help, options: v.options }));

/**
 * `openfilm get <library verb> --prompt <what>`: the best matches, each with its id, name, length, what it is like and
 * where to see or hear it; `--take <id>`: that one into the project (takeOne). `code` as `openfilm get` has it: 0 done,
 * 1 it did not run, 2 a wrong command.
 * @param {string} verb @param {Record<string, string | true | (string | true)[]>} flags
 * @returns {Promise<{ code: number, lines: string[] }>}
 */
export async function libraryGet(verb, flags) {
  const spec = LIBRARY_VERBS[verb];
  const wrong = (/** @type {string} */ text) => ({ code: 2, lines: [`openfilm get ${verb}: ${text}`] });
  const { n, ...given } = flags;
  if (n !== undefined && given.limit === undefined) given.limit = n;
  const unknown = Object.keys(given).find((name) => !(name in spec.options));
  if (unknown) return wrong(`there is no --${unknown}; it takes ${Object.keys(spec.options).map((o) => `--${o}`).join(', ')}`);
  for (const [name, value] of Object.entries(given)) if (typeof value !== 'string') return wrong(`--${name} takes a value, once`);
  const { prompt, sec, limit, take } = /** @type {Record<string, string | undefined>} */ (given);
  if (take !== undefined) {
    if (take.startsWith('community/') || take.startsWith(`${BUILT_IN}/community/`)) await refreshCommunity();
    return takeOne(verb, take);
  }
  if (!prompt?.trim()) return wrong(`what to look for, please: \`openfilm get ${verb} --prompt "${EXAMPLES[verb]}"\``);
  const seconds = sec === undefined ? undefined : Number(sec);
  if (seconds !== undefined && !(seconds > 0 && seconds <= 3600)) return wrong(`--sec is seconds, from 0 to 3600, not ${sec}`);
  const count = limit === undefined ? 8 : Number(limit);
  if (!(Number.isInteger(count) && count >= 1 && count <= 50)) return wrong(`--limit is a whole number from 1 to 50, not ${limit}`);
  const query = prompt.trim();
  const { found, worded } = await searchLibrary(spec.kind, query, { duration: seconds, limit: count });
  const make = spec.makes ? `make one with \`openfilm get ${spec.makes}\`` : 'write it yourself, as a page or CSS';
  if (!found.length) return { code: 0, lines: [`Nothing in OpenFilm's library for “${query}”: ${make}.`] };
  const lang = languageOf(query);
  const { vocab } = library();
  /* what the film around here has already: a sound or music the library gave keeps its file's name in assets/ */
  const root = projectAround('.');
  let film = '';
  try { if (root) film = readFileSync(join(root, 'film.html'), 'utf8'); } catch { /* no film yet */ }
  const lines = [worded ? `${found.length} in OpenFilm's library for “${query}”, the best first (free to use in any film):`
    : `No words of “${query}” are in OpenFilm's library; the ${found.length} nearest in meaning, which may not fit:`, ''];
  found.forEach(({ item, tags }, i) => {
    const name = lang === 'en' || !item.name[lang] ? item.name.en : `${item.name[lang]} (${item.name.en})`;
    const facts = [
      item.durationMs && item.kind !== 'look' ? clock(item.durationMs) : null,
      item.bpm ? `${item.bpm} bpm` : null,
      item.energy ? `energy ${item.energy}/5` : null,
      item.loop ? 'loops' : null,
      item.place === 'cut' ? 'over a cut' : null,
    ].filter(Boolean).join(' · ');
    lines.push(`${String(i + 1).padStart(2)}. ${name}${facts ? `   ${facts}` : ''}`);
    lines.push(`    ${BUILT_IN}/${item.id}`);
    if (item.about) lines.push(`    ${item.about}`);
    const shown = tags.filter((t) => vocab.byId.get(t)?.kind !== 'energy').slice(0, 8).map((t) => vocab.byId.get(t)?.name[lang] ?? t);
    if (shown.length) lines.push(`    ${shown.join(', ')}`);
    const fit = fitOf(item, query);
    if (fit.has.length || fit.lacks.length) lines.push(`    has: ${fit.has.join(', ') || 'none of the words asked'}${fit.lacks.length ? ` · lacks: ${fit.lacks.join(', ')}` : ''}`);
    if (item.kind === 'sound' && film.includes(basename(item.id))) lines.push('    in this film already');
    const preview = previewOf(item);
    lines.push(`    ${preview ? `${item.kind === 'sound' ? 'hear' : 'see'} it: ${preview}` : item.kind === 'sound' ? 'its file is not on this computer' : 'no preview'}`);
  });
  lines.push('', `Take one into the film: \`openfilm get ${verb} --take <id>\` (it says what to put in film.html).`);
  lines.push(spec.makes ? `None fits well enough, or the film needs its own? ${make[0].toUpperCase()}${make.slice(1)}, made to the prompt (it costs).` : `None fits? ${make[0].toUpperCase()}${make.slice(1)}.`);
  return { code: 0, lines };
}

/* what each verb's --prompt might say */
const EXAMPLES = /** @type {Record<string, string>} */ ({
  'music-search': 'calm piano for a morning scene', 'sfx-search': 'whoosh for a fast cut', transition: 'glitch', effect: 'snow falling',
  filter: 'warm vintage film', sticker: 'heart', text: 'title for a product launch', template: 'travel diary',
});

/**
 * A thing of the library taken into the project around the current folder, as Studio's assets drawer takes it
 * (saved.mjs takeSaved): a sound into assets/, a page's files to saved/openfilm/<its id>/; and what to write in
 * film.html to use it. A motion preset is CSS, printed; a filter, a fade and a text style are put on a clip in Studio.
 * @param {string} verb @param {string} asked its id, with `openfilm/` or without
 * @returns {Promise<{ code: number, lines: string[] }>}
 */
async function takeOne(verb, asked) {
  const id = asked.replace(new RegExp(`^${BUILT_IN}/`), '');
  const item = library().items.get(id);
  if (!item || item.cat !== KINDS[LIBRARY_VERBS[verb].kind]) {
    return { code: 2, lines: [`openfilm get ${verb}: no ${asked} here; \`openfilm get ${verb} --prompt <what>\` says what there is`] };
  }
  if (item.kind === 'look' || item.kind === 'textstyle' || item.kind === 'textmotion' || item.kind === 'fade') {
    const where = item.kind === 'look' ? 'Filters' : item.kind === 'fade' ? 'Transitions' : 'Text';
    return { code: 0, lines: [`${item.name.en} is put on a clip in Studio: the person drops it from the library's ${where} onto the clip.`,
      item.kind === 'fade' ? 'To write a fade yourself, overlap the two clips and fade the upper one in: `openfilm get effect --prompt "fade in"` has the motion for it.' : 'Tell the person which one, and on which clip.'] };
  }
  const root = projectAround('.');
  if (!root) return { code: 2, lines: [`openfilm get: ${resolve('.')} is not in a project; \`openfilm open\` makes one`] };
  if (item.kind === 'motion') {
    const { withPreset } = await import('./clip-motion.mjs');
    const slots = /** @type {[import('./clip-motion.mjs').PresetSlot, import('./clip-motion.mjs').Preset][]} */ (Object.entries(/** @type {object} */ (item.motion ?? {})));
    const lines = ['In film.html\'s <style>:'];
    for (const [, p] of slots) lines.push(`  @keyframes ${p.name} { ${p.body} }`);
    for (const [slot, p] of slots) {
      const on = item.place === 'cut' ? (slot === 'out' ? 'the clip before the cut' : 'the clip after it, overlapping the one before') : 'the clip';
      lines.push(`In the style of ${on}: ${withPreset('', slot, p)}`);
    }
    return { code: 0, lines };
  }
  if (item.kind === 'sound' && !(await fetchLibrary(item.id))) {
    const make = LIBRARY_VERBS[verb].makes;
    return { code: 1, lines: [`openfilm get ${verb}: ${item.name.en}'s file could not be fetched (the library's sounds and music come over the network the first time they are used). Try again online, or make one with \`openfilm get ${make}\`.`] };
  }
  const { takeSaved } = await import('../studio/server/saved.mjs');
  const { clipTag } = await import('./film-doc.mjs');
  const taken = await takeSaved(root, `${BUILT_IN}/${item.id}`);
  const secs = (item.durationMs ?? 0) / 1000;
  if ('path' in taken) {
    return { code: 0, lines: [`${taken.path}  ${clock(item.durationMs ?? 0)}`,
      `In film.html, on a sound track: ${clipTag(/** @type {any} */ ({ src: taken.path }))}${item.cat === 'music' ? '   (a bed under a voice: volume="0.3")' : ''}`] };
  }
  if ('clips' in taken) {
    const lines = [`In film.html, on ${new Set(taken.clips.map((c) => c.track)).size} tracks of their own, top first, from the second it starts (add it to each \`at\`):`];
    for (const c of taken.clips) lines.push(`  track ${c.track + 1}: ${clipTag(/** @type {any} */ ({ ...c.clip, at: c.at }))}`);
    if (item.slots) lines.push(`Its ${item.slots} clips with data-slot are places for pictures, each its example: put the film's own there.`);
    return { code: 0, lines };
  }
  const where = item.place === 'cut'
    ? `on a track above the two clips it goes between, its middle on the cut (at = the cut − ${Number((secs / 2).toFixed(2))})`
    : 'on a track above what it goes over';
  return { code: 0, lines: [`In film.html, ${where}:`, `  ${clipTag(/** @type {any} */ (taken.clip))}`] };
}
