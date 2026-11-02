// @ts-check
/**
 * `openfilm find` and `openfilm take`: OpenFilm's own library (studio/server/library.mjs) searched, so a film uses a
 * sound, a music bed, a transition, an effect, a filter, a sticker, a text or a template that is already there before
 * anything is made or paid for; and the one chosen taken into the project, as Studio's assets drawer takes it.
 *
 * Search runs here, offline: what was asked is read for the library's tags (src/library-words.mjs) and its other
 * words, and each thing of the kind asked is scored by what it shares with it — a tag its names say counts most, then
 * a tag it carries, a word of its names, a word of what it is about — each the more the fewer things have it. Music
 * and sounds are also matched on how lively they are (`calm`, `soft`, `energetic` against their energy), a tempo
 * asked (`120 bpm`) and the length asked (--duration).
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BUILT_IN, builtInRoot, libraryIndex } from '../studio/server/library.mjs';
import { CJK, fold, readText, tagsIn, vocabulary, wordsOf } from './library-words.mjs';
import { UsageError } from './shared.mjs';

/** What can be looked for, and the library's category of each. */
export const KINDS = /** @type {const} */ ({ music: 'music', sound: 'sound', transition: 'transition', effect: 'effect', filter: 'filter', sticker: 'sticker', text: 'text', template: 'template' });

/** @typedef {{ id: string, cat: string, group: string, kind: string, name: Record<string, string>, durationMs?: number, tags?: string[], about?: string, energy?: number, bpm?: number, loop?: boolean, place?: string, poster?: string, sample?: string, [k: string]: unknown }} Item */


/** @typedef {{ index: unknown, vocab: ReturnType<typeof vocabulary>, docs: Map<string, Doc> }} Searched */
/** @type {Searched | null} */
let kept = null;

/** @typedef {{ item: Item, tags: Set<string>, named: Set<string>, nameWords: Set<string>, words: Set<string>, cjk: string, title: string[] }} Doc */

/** What each thing is searched by, made once for the library as it is. @returns {Searched} */
function library() {
  const index = libraryIndex();
  if (kept && kept.index === index) return kept;
  const vocab = vocabulary(builtInRoot());
  const { items, groups } = /** @type {{ items: Item[], groups: Record<string, { id: string, name: Record<string, string> }[]> }} */ (index);
  /** @type {Map<string, Doc>} */
  const docs = new Map();
  for (const item of items) {
    const group = groups[item.cat]?.find((g) => g.id === item.group);
    const slug = (item.id.split('/').pop() ?? '').replace(/(-[0-9a-f]{6})?\.\w+$/, '').replaceAll('-', ' ');
    const names = `${item.name.en} ${item.name.es ?? ''} ${slug}`;
    /* a sound is what it sounds like, not a picture's look (`warm` the mood, not the tone) */
    const fits = (/** @type {string} */ t) => item.kind !== 'sound' || !['look', 'motion'].includes(vocab.byId.get(t)?.kind ?? '');
    const named = new Set([...tagsIn(vocab, `${names} ${['zh-CN', 'ja', 'ko'].map((l) => item.name[l] ?? '').join(' ')}`)].filter(fits));
    const grouped = [...tagsIn(vocab, Object.values(group?.name ?? {}).join(' '))].filter(fits);
    docs.set(item.id, {
      item, named,
      tags: new Set([...named, ...(item.tags ?? []), ...grouped]),
      nameWords: new Set(wordsOf(names)),
      words: new Set(wordsOf(`${item.about ?? ''} ${group?.name.en ?? ''} ${(item.tags ?? []).join(' ')}`)),
      cjk: fold(['zh-CN', 'ja', 'ko'].map((l) => `${item.name[l] ?? ''} ${group?.name[l] ?? ''}`).join(' ')),
      title: [wordsOf(item.name.en).join(' '), ...['zh-CN', 'ja', 'ko'].map((l) => fold(item.name[l] ?? ''))],
    });
  }
  const made = { index, vocab, docs };
  kept = made;
  return made;
}

/** How rare a thing is among `n`, `count` having it: the rarer, the more it says. */
const rarity = (/** @type {number} */ n, /** @type {number} */ count) => Math.log(1 + n / (1 + count));

/**
 * The things of the library of `kind` (all kinds when null) that fit `query` best, the best first.
 * @param {keyof typeof KINDS | null} kind @param {string} query
 * @param {{ duration?: number, limit?: number }} [o] duration: the seconds it is wanted for
 * @returns {{ item: Item, score: number, tags: string[] }[]}
 */
export function findInLibrary(kind, query, o = {}) {
  const { vocab, docs } = library();
  const all = [...docs.values()].filter((d) => !kind || d.item.cat === KINDS[kind]);
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
  const short = new Set();
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
    if (d.title.some((t) => t && (t === said || (CJK.test(t) && t.length > 1 && folded.includes(t))))) score += 2 * top;
    if (score <= 0 || !met) continue;
    /* the more of what was asked it has, the better */
    score *= 0.4 + 0.6 * Math.min(1, met / Math.max(1, asks));
    if (o.duration && d.item.durationMs) {
      const secs = d.item.durationMs / 1000;
      if (d.item.cat === 'music') { if (secs < o.duration && !d.item.loop) short.add(d.item.id); }
      else score /= 1 + Math.abs(Math.log(secs / o.duration));
    } else if (d.item.cat === 'music' && d.item.durationMs) {
      /* music for a scene rather than a sting, when no length is asked */
      score *= Math.min(1, 0.8 + (0.2 * d.item.durationMs) / 30000);
    }
    results.push({ item: d.item, score, tags: [...d.tags] });
  }
  /* music shorter than asked (and not a loop) after all that is long enough */
  results.sort((a, b) => Number(short.has(a.item.id)) - Number(short.has(b.item.id)) || b.score - a.score || a.item.id.localeCompare(b.item.id));
  return results.slice(0, o.limit ?? 8);
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

/**
 * `openfilm find [kind] <what>`: the best matches, each with its id (for `take`), name, length, what it is like, and
 * where to see or hear it.
 * @param {string[]} args @param {{ duration?: string, limit?: string }} o @param {string} run the command as typed here
 */
export function findCommand(args, o, run) {
  const kind = args[0] in KINDS ? /** @type {keyof typeof KINDS} */ (args[0]) : null;
  const query = (kind ? args.slice(1) : args).join(' ').trim();
  if (!query) throw new UsageError(`what to look for, please: \`${run} find music "calm piano for a morning scene"\` (kinds: ${Object.keys(KINDS).join(', ')})`);
  const duration = o.duration == null ? undefined : Number(o.duration);
  if (duration !== undefined && !(duration > 0 && duration <= 3600)) throw new UsageError(`--duration is seconds, from 0 to 3600, not ${o.duration}`);
  const limit = o.limit == null ? 8 : Number(o.limit);
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= 50)) throw new UsageError(`--limit is a whole number from 1 to 50, not ${o.limit}`);
  const found = findInLibrary(kind, query, { duration, limit });
  const lang = languageOf(query);
  const { vocab } = library();
  const what = kind ?? 'anything';
  if (!found.length) {
    const make = kind === 'music' || kind === 'sound' ? ` Nothing fits: make it with \`${run} get ${kind === 'music' ? 'music' : 'sfx'}\`, or write it as a page.` : ' Nothing fits: write it yourself, as a page or CSS.';
    return { ok: true, lines: [`No ${what} in OpenFilm's library for “${query}”.${make}`] };
  }
  const lines = [`${found.length} ${what === 'anything' ? 'things' : what} in OpenFilm's library for “${query}”, the best first:`, ''];
  found.forEach(({ item, tags }, i) => {
    const name = lang === 'en' || !item.name[lang] ? item.name.en : `${item.name[lang]} (${item.name.en})`;
    const facts = [
      kind ? null : item.cat,
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
    const preview = previewOf(item);
    lines.push(`    ${preview ? `${item.kind === 'sound' ? 'hear' : 'see'} it: ${preview}` : item.kind === 'sound' ? 'its file is not on this computer' : 'no preview'}`);
  });
  lines.push('', `Take one into the film: \`${run} take <id>\` (it prints what to put in film.html).`);
  if (kind === 'music' || kind === 'sound') lines.push(`Only when none of these fits, make one with \`${run} get ${kind === 'music' ? 'music' : 'sfx'}\`.`);
  return { ok: true, lines };
}

/**
 * `openfilm take <id>`: a thing of the library taken into the project around the current folder, as Studio's assets
 * drawer takes it (saved.mjs takeSaved): a sound into assets/, a page's files to saved/openfilm/<its id>/; and what to
 * write in film.html to use it. A motion preset is CSS, printed; a filter, a fade and a text style are put on a clip
 * in Studio.
 * @param {string[]} args @param {string} run
 */
export async function takeCommand(args, run) {
  const id = (args[0] ?? '').replace(new RegExp(`^${BUILT_IN}/`), '');
  if (!id) throw new UsageError(`which thing, please: \`${run} take openfilm/<id>\`, an id \`${run} find\` printed`);
  const item = library().docs.get(id)?.item;
  if (!item) throw new UsageError(`no ${id} in OpenFilm's library; \`${run} find\` says what there is`);
  if (item.kind === 'look' || item.kind === 'textstyle' || item.kind === 'textmotion' || item.kind === 'fade') {
    const where = item.kind === 'look' ? 'Filters' : item.kind === 'fade' ? 'Transitions' : 'Text';
    return { ok: true, lines: [`${item.name.en} is put on a clip in Studio: the person drops it from the library's ${where} onto the clip.`,
      item.kind === 'fade' ? `To write a fade yourself, overlap the two clips and fade the upper one in: \`${run} find transition fade\` lists the motions for it.` : 'Tell the person which one, and on which clip.'] };
  }
  const root = projectAround('.');
  if (!root) return { ok: false, usage: true, lines: [`${run} take: ${resolve('.')} is not in a project; \`${run} open\` makes one`] };
  if (item.kind === 'motion') {
    const { withPreset } = await import('./clip-motion.mjs');
    const slots = /** @type {[import('./clip-motion.mjs').PresetSlot, import('./clip-motion.mjs').Preset][]} */ (Object.entries(/** @type {object} */ (item.motion ?? {})));
    const lines = ['In film.html\'s <style>:'];
    for (const [, p] of slots) lines.push(`  @keyframes ${p.name} { ${p.body} }`);
    for (const [slot, p] of slots) {
      const on = item.place === 'cut' ? (slot === 'out' ? 'the clip before the cut' : 'the clip after it, overlapping the one before') : 'the clip';
      lines.push(`In the style of ${on}: ${withPreset('', slot, p)}`);
    }
    return { ok: true, lines };
  }
  if (item.kind === 'sound' && !existsSync(join(builtInRoot(), item.id))) {
    return { ok: false, lines: [`${run} take: ${item.name.en}'s file is not on this computer: this copy of OpenFilm has the library's list of sounds and music, not their files. Take another, or make one with \`${run} get\`.`] };
  }
  const { takeSaved } = await import('../studio/server/saved.mjs');
  const { clipTag } = await import('./film-doc.mjs');
  const taken = await takeSaved(root, `${BUILT_IN}/${item.id}`);
  const secs = (item.durationMs ?? 0) / 1000;
  if ('path' in taken) {
    return { ok: true, lines: [`${taken.path}  ${clock(item.durationMs ?? 0)}`,
      `In film.html, on a sound track: ${clipTag(/** @type {any} */ ({ src: taken.path }))}${item.cat === 'music' ? '   (a bed under a voice: volume="0.3")' : ''}`] };
  }
  if ('clips' in taken) {
    const lines = [`In film.html, on ${new Set(taken.clips.map((c) => c.track)).size} tracks of their own, top first, from the second it starts (add it to each \`at\`):`];
    for (const c of taken.clips) lines.push(`  track ${c.track + 1}: ${clipTag(/** @type {any} */ ({ ...c.clip, at: c.at }))}`);
    if (item.slots) lines.push(`Its ${item.slots} slot.html clips are places for pictures: put the film's own there.`);
    return { ok: true, lines };
  }
  const where = item.place === 'cut'
    ? `on a track above the two clips it goes between, its middle on the cut (at = the cut − ${Number((secs / 2).toFixed(2))})`
    : 'on a track above what it goes over';
  return { ok: true, lines: [`In film.html, ${where}:`, `  ${clipTag(/** @type {any} */ (taken.clip))}`] };
}
