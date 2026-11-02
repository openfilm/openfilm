// Overrides (SPEC §1): a person's tweaks of elements inside a page clip, applied after the page draws a frame. The
// film's timeline applies them to each page clip it plays (timeline.mjs); Studio's thumbnails of a page clip apply them
// too (studio/server/pageframes.mjs), so the timeline's pictures of a clip show what was changed in it. `c` is the
// clip as the timeline keeps it: its page's window (`win`), what its tweaks changed (`touched`), which ones found an
// element (`found`).

import { registerEffects } from './film-doc.mjs';

/**
 * Overrides: a person's tweak of one element inside a page, applied after the page draws each frame. `found` keeps,
 * per tweak, whether its selector ever found an element (a page rewritten since may have lost it). What a tweak
 * changes is remembered as it was before (`touched`), so a tweak taken away, or changed, leaves nothing behind.
 * A tweak's `animation` plays the film's @keyframes (`keyframes`, name → body): those it names are put in the page.
 */
export function override(c, list = [], keyframes = null) {
  const win = c.win;
  if (!win) return;
  keyframesIn(win.document, list, keyframes);
  const touch = (el, prop) => {
    let saved = c.touched.get(el);
    if (!saved) { saved = { props: new Map(), texts: null }; c.touched.set(el, saved); }
    if (!saved.props.has(prop)) saved.props.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
  };
  const set = (el, prop, value, priority = '') => { touch(el, prop); el.style.setProperty(prop, value, priority); };
  for (const [i, o] of list.entries()) {
    if (o.at === undefined) continue; // the clip's own entry (its fades): not an element's
    let nodes = [];
    try { nodes = [...win.document.querySelectorAll(o.at)]; } catch { continue; }
    if (o.n) nodes = nodes.slice(o.n - 1, o.n);
    if (nodes.length) c.found[i] = true;
    for (const el of nodes) {
      /* split into parts already, for the same words and the same way: as it is (each frame would start them over) */
      const splitKey = o.split ? JSON.stringify([o.split, o.text ?? null]) : null;
      const done = splitKey != null && c.touched.get(el)?.split === splitKey;
      if (o.t) set(el, 'translate', `${o.t[0]}px ${o.t[1]}px`);
      if (o.s != null) set(el, 'scale', Array.isArray(o.s) ? `${o.s[0]} ${o.s[1]}` : String(o.s));
      if (o.r != null) set(el, 'rotate', `${o.r}deg`);
      for (const [k, v] of Object.entries(o.style ?? {})) {
        /* a custom property (`--accent`) is set as it is named, its value as it is: what a number means is the page's */
        if (k.startsWith('--')) { set(el, k, String(v), 'important'); continue; }
        const prop = k.replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase());
        set(el, prop, typeof v === 'number' && !/opacity|z-index|font-weight|line-height|flex/.test(prop) ? v + 'px' : String(v), 'important');
      }
      if (o.text != null && !done) {
        const saved = (touch(el, 'translate'), c.touched.get(el));
        if ([...el.children].every((ch) => ch.localName === 'br')) {
          /* words alone, or lines between <br>s: all of them change, a <br> at each line break (SPEC §1) */
          saved.nodes ??= [...el.childNodes];
          if (linesOf(el) !== o.text) {
            const doc = el.ownerDocument;
            el.replaceChildren(...o.text.split('\n').flatMap((line, k) => (k ? [doc.createElement('br'), doc.createTextNode(line)] : [doc.createTextNode(line)])));
          }
        } else {
          const parts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.data.trim());
          saved.texts ??= parts.map((n) => [n, n.data]);
          /* a heading with other inline parts (`Quiet<br><em>you</em>`): its own words change, the parts stay */
          parts.forEach((n, k) => { n.data = k ? '' : o.text; });
        }
      }
      if (o.split && !done) {
        const saved = (touch(el, 'translate'), c.touched.get(el));
        saved.nodes ??= [...el.childNodes];
        splitInto(el, o.split);
        saved.split = splitKey;
      }
    }
  }
}

/** A part's mark: what restore takes back out (it puts the element's own nodes back). */
const PART = 'data-film-part';

/**
 * An element's words in parts (an override's `split`): each character or word in a <span> of its own (an
 * inline-block, so it can move and grow; spaces stay as they are), each given the animation, started at its turn.
 * Lines are its words grouped by where the page lays them out.
 */
function splitInto(el, split) {
  const doc = el.ownerDocument;
  for (const old of el.querySelectorAll(`[${PART}]`)) old.replaceWith(...old.childNodes);
  el.normalize();
  const texts = [];
  const walk = (n) => { for (const ch of [...n.childNodes]) { if (ch.nodeType === 3) texts.push(ch); else if (ch.nodeType === 1) walk(ch); } };
  walk(el);
  const parts = [];
  for (const node of texts) {
    const pieces = split.by === 'char' ? [...node.data].map((ch) => (/\s/.test(ch) ? { space: ch } : { word: ch }))
      : node.data.split(/(\s+)/).filter(Boolean).map((w) => (/^\s+$/.test(w) ? { space: w } : { word: w }));
    node.replaceWith(...pieces.map((p) => {
      if (p.space) return doc.createTextNode(p.space);
      const span = doc.createElement('span');
      span.setAttribute(PART, '');
      span.style.display = 'inline-block';
      span.textContent = p.word;
      parts.push(span);
      return span;
    }));
  }
  /* a line's words go at once: their turn is their line's */
  let turns = parts.map((_, i) => i);
  if (split.by === 'line') {
    const tops = [];
    turns = parts.map((span) => {
      const top = Math.round(span.offsetTop);
      let k = tops.findIndex((t) => Math.abs(t - top) < 2);
      if (k < 0) { tops.push(top); k = tops.length - 1; }
      return k;
    });
  }
  const n = Math.max(...turns, 0) + 1;
  const orderOf = (k) => (split.order === 'reverse' ? n - 1 - k
    : split.order === 'center' ? Math.round(Math.abs(k - (n - 1) / 2))
      : split.order === 'random' ? shuffled(n)[k] : k);
  parts.forEach((span, i) => {
    span.style.animation = split.animation;
    span.style.animationDelay = `${Math.round(((split.start ?? 0) + orderOf(turns[i]) * split.stagger) * 1000) / 1000}s`;
  });
}

/** 0 … n−1 in an order that looks random and is always the same for n (a film renders as it previews). */
function shuffled(n) {
  const out = [...Array(n).keys()];
  let seed = 0x2545f491 ^ n;
  for (let i = n - 1; i > 0; i--) {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) | 0;
    const j = ((seed >>> 0) % (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The film's @keyframes the tweaks' animations name, in a <style> of the page's own (none named: taken out). */
function keyframesIn(page, list, keyframes) {
  const names = new Set();
  for (const o of list) {
    for (const anim of o.at !== undefined ? [o.style?.animation, o.split?.animation] : []) {
      if (typeof anim === 'string') for (const entry of anim.split(',')) names.add(entry.trim().split(/\s+/)[0]);
    }
  }
  const text = [...names].filter((n) => keyframes?.[n] != null).map((n) => `@keyframes ${n} { ${keyframes[n]} }`).join('\n');
  if (!text && typeof page?.querySelector !== 'function') return;
  /* an effect's keyframes ease only where its custom property is registered (film-doc EFFECTS) */
  if (text.includes('--fx-')) registerEffects(page.defaultView);
  let tag = page.querySelector('style[data-film-keyframes]');
  if (!text) { tag?.remove(); return; }
  if (!tag) {
    tag = page.createElement('style');
    tag.setAttribute('data-film-keyframes', '');
    (page.head ?? page.documentElement).append(tag);
  }
  if (tag.textContent !== text) tag.textContent = text;
}

/** An element's words with a line break for each <br>, as a `text` override writes them. */
export function linesOf(el) {
  return [...el.childNodes].map((n) => (n.nodeType === 3 ? n.data : n.localName === 'br' ? '\n' : '')).join('');
}

/** Put back what a clip's tweaks changed (before a changed list is applied, or when it is taken away). */
export function restore(c) {
  for (const [el, saved] of c.touched) {
    for (const [prop, [value, priority]] of saved.props) {
      if (value) el.style.setProperty(prop, value, priority); else el.style.removeProperty(prop);
    }
    if (saved.nodes) el.replaceChildren(...saved.nodes);
    else if (saved.texts) for (const [node, data] of saved.texts) node.data = data;
    /* words split into parts deeper in it: back as words */
    if (saved.split) { for (const part of el.querySelectorAll(`[${PART}]`)) part.replaceWith(...part.childNodes); el.normalize(); }
  }
  c.touched = new Map();
  c.found = [];
}
