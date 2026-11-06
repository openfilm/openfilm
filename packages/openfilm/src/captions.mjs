// @ts-check
/**
 * A caption track's file (SPEC §1 Captions): WebVTT on the film's time. Read and written here for everyone who
 * touches it: the timeline page draws its cues (src/timeline.mjs), Studio edits them, an export writes them out.
 *
 * What is read: the header, NOTE, REGION and STYLE blocks, and each cue's id, times, settings and text. What is
 * written is the same file, laid out one way: the header, the notes, the regions, the styles, then the cues, a blank
 * line between blocks. A cue's text is kept as written (its tags and timestamps); `cueNodes` reads it as a tree.
 *
 * Plain JavaScript with no dependencies: Studio's editor imports it as it is.
 */

/** @typedef {{ id: string, start: number, end: number, settings: string, text: string }} VttCue */
/** @typedef {{ header: string, notes: string[], regions: string[], styles: string[], cues: VttCue[] }} Vtt */

/**
 * The note at the top of a caption track's file made of what is said in the film (Studio's library): its captions are
 * made again of the speech once the film is cut, where any other track's are left as they are. A WebVTT comment, so
 * every reader takes the file as it always did.
 */
export const SPEECH_NOTE = 'NOTE Captions of what is said in the film, made again of it after cuts.';
/** Whether a caption track's file is made of what is said (SPEECH_NOTE). @param {Vtt} vtt */
export const madeOfSpeech = (vtt) => vtt.notes.some((n) => n.startsWith(SPEECH_NOTE));
/**
 * A short print of cues' words (FNV-1a), not their times: what they said when Studio wrote them. Captions moved with
 * the film are still Studio's; words changed are the person's. @param {readonly VttCue[]} cues
 */
function cuesPrint(cues) {
  let h = 0x811c9dc5;
  for (const c of cues) {
    const line = `${cuePlain(c.text)}\n`;
    for (let i = 0; i < line.length; i += 1) { h ^= line.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return h.toString(16).padStart(8, '0');
}
/** The note of a file of what is said with these cues: SPEECH_NOTE and their print. @param {readonly VttCue[]} cues */
export const speechNote = (cues) => `${SPEECH_NOTE} ${cuesPrint(cues)}`;
/** Whether a file of what is said has its words as Studio wrote them, not changed by hand since. @param {Vtt} vtt */
export const untouchedSpeech = (vtt) => vtt.notes.includes(speechNote(vtt.cues));
export const CLIPS_NOTE = 'NOTE Of the files ';
/** The note of a file of what some media say: their files (a clip cut in two still speaks from its file). @param {readonly string[]} srcs */
export const clipsNote = (srcs) => `${CLIPS_NOTE}${JSON.stringify(srcs)}`;
/** The media files a file of what is said is made of (clipsNote); null: all that speak. @param {Vtt} vtt @returns {string[] | null} */
export function speechClips(vtt) {
  const note = vtt.notes.find((n) => n.startsWith(CLIPS_NOTE));
  try { const ids = note ? JSON.parse(note.slice(CLIPS_NOTE.length)) : null; return Array.isArray(ids) ? ids.map(String) : null; } catch { return null; }
}

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/;

/** Seconds from a WebVTT timestamp (`01:02.500`, `1:01:02.500`); NaN when it is not one. */
export function vttSeconds(/** @type {string} */ text) {
  const m = TIME.exec(text.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? '0').padEnd(3, '0')) / 1000;
}

/** A WebVTT timestamp, to the millisecond: `00:01:02.500`. */
export function vttTime(/** @type {number} */ seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  const pad = (/** @type {number} */ n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

/**
 * A WebVTT file read: its blocks as they are. Lenient as players are: a block that is not a cue, a note, a region or
 * a style is passed over; a cue without an id gets none (`''`).
 * @param {string} text @returns {Vtt}
 */
export function readVtt(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const header = lines[0]?.startsWith('WEBVTT') ? lines[0] : 'WEBVTT';
  /** @type {Vtt} */
  const out = { header, notes: [], regions: [], styles: [], cues: [] };
  let i = lines[0]?.startsWith('WEBVTT') ? 1 : 0;
  /* the header's own lines, up to the first blank one */
  while (i < lines.length && lines[i].trim() !== '') i++;
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) break;
    const block = [];
    while (i < lines.length && lines[i].trim() !== '') block.push(lines[i++]);
    const first = block[0];
    if (/^NOTE(\s|$)/.test(first)) { out.notes.push(block.join('\n')); continue; }
    if (first === 'STYLE' || /^STYLE\s/.test(first)) { out.styles.push(block.slice(1).join('\n')); continue; }
    if (first === 'REGION' || /^REGION\s/.test(first)) { out.regions.push(block.slice(1).join('\n')); continue; }
    const at = block.findIndex((l) => l.includes('-->'));
    if (at < 0 || at > 1) continue;
    const [from, rest] = block[at].split('-->');
    const [to, ...settings] = rest.trim().split(/[ \t]+/);
    const start = vttSeconds(from), end = vttSeconds(to);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.cues.push({ id: at === 1 ? block[0].trim() : '', start, end, settings: settings.join(' '), text: block.slice(at + 1).join('\n') });
  }
  return out;
}

/** The file that says `vtt`: header, notes, regions, styles, cues. @param {Vtt} vtt */
export function writeVtt(vtt) {
  const blocks = [
    vtt.header || 'WEBVTT',
    ...vtt.notes,
    ...vtt.regions.map((r) => `REGION\n${r}`),
    ...vtt.styles.filter((css) => css.trim()).map((css) => `STYLE\n${css.trim()}`),
    ...vtt.cues.map((c) => `${c.id ? `${c.id}\n` : ''}${vttTime(c.start)} --> ${vttTime(c.end)}${c.settings ? ` ${c.settings}` : ''}\n${c.text || ' '}`),
  ];
  return `${blocks.join('\n\n')}\n`;
}

/* ── a cue's settings ───────────────────────────────────────────────────── */

/** A cue's settings as name → value (`line:40% align:center` → { line: '40%', align: 'center' }). */
export function cueSettings(/** @type {string} */ settings) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of settings.split(/[ \t]+/)) {
    const k = part.indexOf(':');
    if (k > 0) out[part.slice(0, k)] = part.slice(k + 1);
  }
  return out;
}

/** Settings written back, in the order WebVTT lists them; a null value takes one out. */
export function withSettings(/** @type {string} */ settings, /** @type {Record<string, string | null>} */ set) {
  const now = { ...cueSettings(settings), ...set };
  const order = ['region', 'vertical', 'line', 'position', 'size', 'align'];
  const names = [...order.filter((k) => k in now), ...Object.keys(now).filter((k) => !order.includes(k))];
  return names.filter((k) => now[k] != null && now[k] !== '').map((k) => `${k}:${now[k]}`).join(' ');
}

/** A REGION block's settings (`id:bottom`, `width:80%`…) as name → value. */
export function regionSettings(/** @type {string} */ block) {
  return cueSettings(block.replace(/\n/g, ' '));
}

/* ── a cue's text ───────────────────────────────────────────────────────── */

/**
 * @typedef {{ type: 'text', text: string, t: number | null }} CueText
 * @typedef {{ type: 'tag', tag: string, classes: string[], annotation: string, t: number | null, children: CueNode[] }} CueTag
 * @typedef {CueText | CueTag} CueNode
 */

const TAGS = new Set(['c', 'i', 'b', 'u', 'ruby', 'rt', 'v', 'lang']);
const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '‎', rlm: '‏', quot: '"', apos: "'" });
const unescape = (/** @type {string} */ s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => (
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? all
));

/**
 * A cue's text as WebVTT reads it: text, and the spans `c`, `i`, `b`, `u`, `ruby`, `rt`, `v` and `lang` with their
 * classes and annotation (a voice's name, a language). Each node has the time of the timestamp before it (`t`, null
 * before the first): what `:past` and `:future` look at. Any other tag is passed over, its text kept.
 * @param {string} text @returns {CueNode[]}
 */
export function cueNodes(text) {
  /** @type {CueNode[]} */
  const root = [];
  /** @type {CueTag[]} */
  const open = [];
  let t = /** @type {number | null} */ (null);
  const here = () => (open.length ? open[open.length - 1].children : root);
  const re = /<([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[2] != null) { here().push({ type: 'text', text: unescape(m[2]), t }); continue; }
    const inner = m[1].trim();
    if (/^\d/.test(inner)) { const s = vttSeconds(inner); if (Number.isFinite(s)) t = s; continue; }
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      const k = open.map((o) => o.tag).lastIndexOf(name);
      if (k >= 0) open.length = k;
      continue;
    }
    const [head, ...rest] = inner.split(/[ \t]+/);
    const [tag, ...classes] = head.split('.');
    if (!TAGS.has(tag)) continue;
    /** @type {CueTag} */
    const node = { type: 'tag', tag, classes: classes.filter(Boolean), annotation: unescape(rest.join(' ')), t, children: [] };
    here().push(node);
    open.push(node);
  }
  return root;
}

/** A cue's text without its tags and timestamps: what it says. */
export function cuePlain(/** @type {string} */ text) {
  /** @type {(nodes: CueNode[]) => string} */
  const walk = (nodes) => nodes.map((n) => (n.type === 'text' ? n.text : walk(n.children))).join('');
  return walk(cueNodes(text));
}

/** Text for a cue's payload, escaped (`<`, `&` as entities; a blank line, which would end the cue, closed up). */
export function cueEscape(/** @type {string} */ text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n\s*\n/g, '\n');
}

/* a character written as a word of its own (Chinese, Japanese): each is timed apart */
const CJK = '\\u3040-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff';
const UNITS = new RegExp(`\\s+|[${CJK}][^\\s${CJK}\\p{L}\\p{N}]*|[^\\s${CJK}]+`, 'gu');

/**
 * Words with no times of their own (a translation, a line typed in) timed across their cue, each by its length, as a
 * cue's payload: a timestamp before each word (a Chinese or Japanese character is one), the last ending a little
 * before the cue does. What a cue's words lit as said need, where nothing heard them.
 * @param {string} text plain words @param {number} start @param {number} end seconds
 */
export function timedText(text, start, end) {
  /** @type {{ text: string, w: number }[]} */
  const units = [];
  for (const m of text.trim().match(UNITS) ?? []) {
    if (/^\s+$/u.test(m)) { if (units.length) units[units.length - 1].text += m; continue; }
    units.push({ text: m, w: new RegExp(`^[${CJK}]`, 'u').test(m) ? 1 : Math.max(1, [...m].length * 0.35) });
  }
  const total = units.reduce((n, u) => n + u.w, 0);
  if (!total) return cueEscape(text);
  const span = Math.max(0, end - start) * 0.95;
  let at = 0;
  return units.map((u) => { const t = start + (span * at) / total; at += u.w; return `<${vttTime(t)}>${cueEscape(u.text)}`; }).join('');
}

/* ── its CSS ────────────────────────────────────────────────────────────── */

/**
 * The top-level pieces of a style sheet: each rule's prelude and block, an at-rule's too (`@keyframes`, `@media`,
 * `@font-face`), comments dropped.
 * @param {string} css @returns {{ prelude: string, block: string }[]}
 */
export function cssRules(css) {
  const out = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    let depth = 1, j = open + 1, quote = '';
    for (; j < text.length && depth; j++) {
      const ch = text[j];
      if (quote) { if (ch === quote && text[j - 1] !== '\\') quote = ''; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    out.push({ prelude, block: text.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

/** Splits a selector list at its top-level commas (not those inside `::cue(…)` or `:is(…)`). */
function selectorList(/** @type {string} */ list) {
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && !depth) { out.push(list.slice(from, i).trim()); from = i + 1; }
  }
  out.push(list.slice(from).trim());
  return out.filter(Boolean);
}

/** A selector inside `::cue(…)`, for the elements the page draws: an id is the cue's, `:past`/`:future` classes. */
const inner = (/** @type {string} */ sel) => sel
  .replace(/#((?:\\.|[\w-])+)/g, (_, id) => `[data-cue-id="${id.replace(/\\(.)/g, '$1').replace(/[\\"]/g, '\\$&')}"]`)
  .replace(/:past\b/g, '.past')
  .replace(/:future\b/g, '.future');

/**
 * A caption track's STYLE (all its blocks' CSS) for the page that draws it, inside `scope` (a selector of the
 * track's layer): `::cue` is each cue's text, `::cue(X)` the cue whose id X names or the spans inside it that X
 * matches. Rules without `::cue` (`@keyframes`, `@font-face`) are kept as they are; `@media` is read inside.
 * @param {string} css @param {string} scope @returns {string}
 */
export function cueCss(css, scope) {
  const out = [];
  for (const { prelude, block } of cssRules(css)) {
    if (/^@media\b/i.test(prelude) || /^@supports\b/i.test(prelude)) { out.push(`${prelude} {\n${cueCss(block, scope)}\n}`); continue; }
    if (prelude.startsWith('@')) { out.push(`${prelude} {${block}}`); continue; }
    const selectors = selectorList(prelude).flatMap((sel) => {
      const m = /^(.*?)::cue(?:\((.*)\))?(.*)$/.exec(sel);
      if (!m) return [];
      const [, before, arg, after] = m;
      const lead = `${scope} ${before.trim()}`.trim();
      if (arg == null) return [`${lead} .cue-text${after}`];
      const x = inner(arg.trim());
      return [`${lead} .cue-text:is(${x})${after}`, `${lead} .cue-text :is(${x})${after}`];
    });
    if (selectors.length) out.push(`${selectors.join(',\n')} {${block}}`);
  }
  return out.join('\n');
}

/**
 * How every caption is drawn before its file's STYLE says otherwise: WebVTT's own default (white on black, 5% of the
 * frame's height), laid over the picture without taking clicks. A cue's text (`.cue-text`, what `::cue` styles) holds
 * its words (`.cue-words`). The library text's variables style them as they style a text (library/text/text): font,
 * size, weight, color, fill, outline, shadow, glow, box, spacing, and how they come in, move and go out (its motions,
 * `__film/caption-text.css`), on the cue's own time (`--clip-length` its length). Plain CSS in `::cue` overrides them.
 */
export const CAPTION_BASE_CSS = `
[data-film-captions] { position: absolute; inset: 0; pointer-events: none; overflow: hidden; container-type: size; }
[data-film-captions] .cue { position: absolute; box-sizing: border-box; text-align: center; white-space: pre-line; }
[data-film-captions] .cue-auto { position: absolute; left: 0; right: 0; bottom: 4%; display: flex; flex-direction: column; align-items: center; gap: .2em; }
[data-film-captions] .cue-auto > .cue { position: relative; width: 100%; }
[data-film-captions] .cue-region { position: absolute; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; }
[data-film-captions] .cue-region > .cue { position: relative; width: 100%; }
[data-film-captions] .cue-text { color: var(--color, #fff); background: var(--box, rgba(0, 0, 0, .8)); padding: var(--box-pad, 0 .25em);
  border-radius: var(--box-radius, 0); font-family: var(--font, sans-serif); font-size: var(--size, 5cqh); font-weight: var(--weight, normal);
  font-style: var(--italic, normal); letter-spacing: var(--spacing, normal); line-height: 1.25;
  -webkit-text-stroke: var(--stroke, 0) var(--stroke-color, transparent); paint-order: stroke fill; text-shadow: var(--shadow, none);
  -webkit-box-decoration-break: clone; box-decoration-break: clone; }
[data-film-captions] .cue-words { display: inline-block; background: var(--fill, none); -webkit-background-clip: text; background-clip: text;
  filter: var(--glow, none);
  animation: var(--in, none) var(--in-time, .5s) cubic-bezier(.2, .8, .2, 1) both,
    var(--loop, none) var(--loop-time, 1.6s) ease-in-out var(--in-time, .5s) infinite,
    var(--out, none) var(--out-time, .4s) cubic-bezier(.6, 0, .8, .2) calc(var(--clip-length, 3600s) - var(--out-time, .4s)) forwards; }
`;

/* ── where a cue sits ───────────────────────────────────────────────────── */

/** How high one line is, % of the frame: the base font (5% of its height) at its line height. */
export const CAPTION_LINE_PCT = 6.25;

const pct = (/** @type {string | undefined} */ v) => { const n = Number(String(v ?? '').replace(/%$/, '')); return String(v ?? '').endsWith('%') && Number.isFinite(n) ? n : null; };

/**
 * Where a cue is drawn, as WebVTT lays it out, in % of the frame: `auto` with the cues stacked from the bottom (no
 * `line`), `region` in the region its `region` names, else placed by its `line`. Its width and left edge come from
 * `size` and `position`, its text's alignment from `align`.
 * @param {string} settings @param {ReadonlySet<string>} [regions] the ids of the file's regions
 * @returns {{ mode: 'auto' | 'region' | 'placed', region?: string, left: number, width: number, align: string, top?: number, bottom?: number, shift?: number }}
 */
export function cueLayout(settings, regions = new Set()) {
  const s = cueSettings(settings);
  const align = ['start', 'center', 'end', 'left', 'right'].includes(s.align) ? s.align : 'center';
  const width = Math.min(100, Math.max(0, pct(s.size) ?? 100));
  const [posValue, posAlignGiven] = (s.position ?? '').split(',');
  const pos = pct(posValue) ?? (align === 'left' || align === 'start' ? 0 : align === 'right' || align === 'end' ? 100 : 50);
  const posAlign = posAlignGiven ?? (align === 'left' || align === 'start' ? 'line-left' : align === 'right' || align === 'end' ? 'line-right' : 'center');
  const left0 = posAlign === 'line-left' ? pos : posAlign === 'line-right' ? pos - width : pos - width / 2;
  const left = Math.min(100 - width, Math.max(0, left0));
  const textAlign = align === 'start' ? 'left' : align === 'end' ? 'right' : align;
  if (s.region && regions.has(s.region) && !s.vertical && !s.line && !s.size) return { mode: 'region', region: s.region, left, width, align: textAlign };
  if (!s.line || s.line === 'auto') return { mode: 'auto', left, width, align: textAlign };
  const [lineValue, lineAlign = 'start'] = s.line.split(',');
  const linePct = pct(lineValue);
  if (linePct != null) {
    if (lineAlign === 'end') return { mode: 'placed', left, width, align: textAlign, bottom: 100 - linePct };
    return { mode: 'placed', left, width, align: textAlign, top: linePct, ...(lineAlign === 'center' ? { shift: -50 } : {}) };
  }
  const n = Math.trunc(Number(lineValue));
  if (!Number.isFinite(n)) return { mode: 'auto', left, width, align: textAlign };
  return n >= 0 ? { mode: 'placed', left, width, align: textAlign, top: n * CAPTION_LINE_PCT } : { mode: 'placed', left, width, align: textAlign, bottom: (-n - 1) * CAPTION_LINE_PCT };
}

/**
 * A REGION block's box, % of the frame: `width`, `lines` tall, its `regionanchor` point put on the frame's
 * `viewportanchor` point (both default to the bottom left).
 * @param {string} block @returns {{ id: string, left: number, top: number, width: number, height: number }}
 */
export function regionBox(block) {
  const s = regionSettings(block);
  const width = pct(s.width) ?? 100;
  const lines = Number.isInteger(Number(s.lines)) ? Number(s.lines) : 3;
  const height = lines * CAPTION_LINE_PCT;
  const point = (/** @type {string | undefined} */ v) => { const [x, y] = String(v ?? '').split(','); return [pct(x) ?? 0, pct(y) ?? 100]; };
  const [rx, ry] = point(s.regionanchor), [vx, vy] = point(s.viewportanchor);
  return { id: s.id ?? '', left: vx - (rx / 100) * width, top: vy - (ry / 100) * height, width, height };
}
