/*
 * Studio's stage inside the film's timeline page (src/timeline.mjs), injected after bridge.js. The editor runs on
 * another origin and cannot touch the picture's DOM, so what the stage needs of it lives here: what is under a point,
 * what a layer is (its kind, words, style, override, parents), where it is drawn, a move / scale / turn / style / text
 * shown before it is kept, the in-place text box, and the keys pressed while the picture has focus.
 *
 * Nothing here writes film.html: a change is only shown (as a preview of the clip's `overrides`, or a clip placed in a
 * box) until the editor keeps it, and the film's next update takes the shown change back.
 *
 *   editor → { source: 'openfilm-studio', type: 'stage', seq, op, ...args }    (ops below, at `ops`)
 *   film   → { source: 'openfilm-film', type: 'stage', seq, result }           the answer (null when nothing)
 *            { type: 'stage-event', event: 'text', handle, commit, value?, before? }   an in-place edit ended
 *            { type: 'stage-event', event: 'key', key, code, repeat, metaKey, ctrlKey, shiftKey, altKey }
 *                                                   a key pressed in the picture (not while typing in it)
 *
 * Points and boxes are in stage px (the film's own size, before the editor scales its frame). A layer is named by a
 * `handle` (a number, good while its element is in the page) and by `loc`: its selector, with `#n` when the selector
 * finds several (the override target `{ at, n }`).
 *
 * Only the editor's origin is listened to and answered (the server puts it in for EDITOR).
 */
(() => {
  const EDITOR = __EDITOR__;
  const BLUE = '#0d99ff';
  const post = (message) => parent.postMessage({ source: 'openfilm-film', ...message }, EDITOR);
  const editor = () => window.__filmEditor;
  const hooks = () => window.__filmEditor?.stage;
  const clips = () => hooks()?.clips() ?? [];

  /* ── handles: a number per element, kept weakly ── */
  let nextHandle = 1;
  const byHandle = new Map();
  const handles = new WeakMap();
  const handleOf = (el) => {
    let h = handles.get(el);
    if (!h) {
      h = nextHandle++;
      handles.set(el, h);
      byHandle.set(h, new WeakRef(el));
      if (byHandle.size > 4000) for (const [k, ref] of byHandle) if (!ref.deref()?.isConnected) byHandle.delete(k);
    }
    return h;
  };
  const nodeOf = (h) => {
    if (h == null) return null;
    const el = byHandle.get(h)?.deref();
    return el?.isConnected ? el : null;
  };
  const clipOfNode = (el) => clips().find((c) => c.kind === 'page' && c.win === el?.ownerDocument?.defaultView) ?? null;
  const clipById = (id) => clips().find((c) => c.id === id) ?? null;

  /* ── a clip on the stage: its placement maps its own px to stage px ── */
  const matrixOf = (c) => new DOMMatrix(getComputedStyle(c.el).transform);
  const mapPoint = (M, x, y) => { const p = M.transformPoint(new DOMPoint(x, y)); return { x: p.x, y: p.y }; };
  /** A box in the clip's px → the stage box around it. */
  const mapRect = (M, r) => {
    const pts = [[r.left, r.top], [r.left + r.width, r.top], [r.left + r.width, r.top + r.height], [r.left, r.top + r.height]]
      .map(([x, y]) => mapPoint(M, x, y));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  };
  /** A frame (center, size, turn) in the clip's px → the same frame on the stage (the clip's turn and scale added). */
  const mapFrame = (M, f) => {
    const rad = (f.r * Math.PI) / 180;
    const ux = { x: Math.cos(rad), y: Math.sin(rad) };
    const uy = { x: -Math.sin(rad), y: Math.cos(rad) };
    const at = (kx, ky) => mapPoint(M, f.cx + (ux.x * kx * f.w + uy.x * ky * f.h) / 2, f.cy + (ux.y * kx * f.w + uy.y * ky * f.h) / 2);
    const c = mapPoint(M, f.cx, f.cy);
    const p0 = at(-1, -1);
    const p1 = at(1, -1);
    const p3 = at(-1, 1);
    const r = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
    return { cx: c.x, cy: c.y, w: Math.hypot(p1.x - p0.x, p1.y - p0.y), h: Math.hypot(p3.x - p0.x, p3.y - p0.y), r: Math.abs(r) < 1e-6 ? 0 : r };
  };
  const clipTurn = (M) => (Math.atan2(M.b, M.a) * 180) / Math.PI;
  const clipScale = (M) => Math.hypot(M.a, M.b) || 1;

  /** The picture clips a person sees now, the top one first (track 0 is on top). */
  const shown = () => clips()
    .filter((c) => c.el && c.kind !== 'sound' && c.el.style.visibility === 'visible' && !(Number(c.el.style.opacity || 1) <= 0))
    .sort((a, b) => a.ti - b.ti);
  /** The top clip under a stage point, by its placed box (a full-frame video draws nothing a point test could find). */
  const clipAt = (x, y, pictures = false) => {
    for (const c of shown()) {
      if (pictures && c.kind === 'page') continue;
      const p = matrixOf(c).inverse().transformPoint(new DOMPoint(x, y));
      if (p.x >= 0 && p.y >= 0 && p.x <= c.w && p.y <= c.h) return c;
    }
    return null;
  };

  /* ── a page's layers (ported from the old Studio's stage-dom / stage-inspect) ── */
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'title', 'head', 'br', 'wbr']);
  const IMAGE_TAGS = new Set(['img', 'video', 'canvas', 'picture']);
  const SHAPE_TAGS = new Set(['svg', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'g', 'text', 'tspan', 'use']);
  const SVG_TEXT_TAGS = new Set(['text', 'tspan', 'textpath']);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const INLINE = new Set(['BR', 'WBR', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'SPAN', 'SMALL', 'SUP', 'SUB', 'A', 'MARK', 'CODE', 'ABBR', 'Q', 'TIME']);
  const EDITOR_ATTR = 'data-openfilm-text-editor';
  const LIMIT = 1500;

  const view = (el) => el.ownerDocument.defaultView;
  const css = (el) => view(el).getComputedStyle(el);
  const tagKind = (tag) => (IMAGE_TAGS.has(tag) ? 'image' : SHAPE_TAGS.has(tag) ? 'shape' : null);
  const isSvgText = (el) => el.namespaceURI === SVG_NS && SVG_TEXT_TAGS.has(el.localName.toLowerCase());
  const isGroup = (el) => Boolean(el?.hasAttribute?.('data-group'));
  const kebab = (key) => key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);

  /** Every element of a page that can be a layer, in document order. */
  const layersOf = (doc) => {
    const out = [];
    if (!doc.body) return out;
    for (const el of doc.body.querySelectorAll('*')) {
      if (out.length >= LIMIT) break;
      if (SKIP.has(el.localName.toLowerCase()) || el.hasAttribute(EDITOR_ATTR) || el.closest(`[${EDITOR_ATTR}]`)) continue;
      out.push(el);
    }
    return out;
  };

  /** Faded out to nothing, here or on the way up: not hit, not framed. */
  const invisible = (el) => {
    for (let node = el; node; node = node.parentElement) {
      if (!(Number.parseFloat(css(node).opacity) > 0)) return true;
      if (node === el.ownerDocument.documentElement) break;
    }
    return false;
  };

  const collapse = (raw) => raw.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim();
  /** The words on an element as written, line breaks kept (`<br>` and block children both break a line). */
  const stageText = (el) => {
    let out = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === 3) { out += node.nodeValue ?? ''; return; }
      if (node.nodeType !== 1) return;
      if (node.localName === 'br') { out += '\n'; return; }
      const display = css(node).display;
      if (!display.startsWith('inline') && display !== 'contents' && out && !out.endsWith('\n')) out += '\n';
      out += stageText(node);
    });
    return collapse(out);
  };
  /** An element's own words: all of them, or, when it holds inline parts (`<em>`, `<br>`…), those written in it. */
  const ownWords = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join('').replace(/\s+/g, ' ').trim();
  /* an icon beside the words (a badge's ✓, a button's arrow) does not stop them being the element's text: its own
     words are typed in place, and the icon stays (a text override changes the element's own words only) */
  const ICON = new Set(['svg', 'img']);
  const textOf = (el) => {
    if (el.childElementCount === 0) return stageText(el);
    if (![...el.children].every((c) => INLINE.has(c.tagName) || ICON.has(c.localName))) return '';
    return ownWords(el);
  };

  const transparent = (color) => {
    const c = color.trim();
    if (!c || c === 'transparent') return true;
    const m = /^rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(c);
    return m != null && Number(m[1]) === 0;
  };
  /** Whether a layer paints anything itself: a fill, a border, a background picture, a shadow. */
  const paints = (cs) => !transparent(cs.backgroundColor)
    || (cs.backgroundImage && cs.backgroundImage !== 'none')
    || (Number.parseFloat(cs.borderTopWidth) > 0 && !transparent(cs.borderTopColor))
    || (cs.boxShadow && cs.boxShadow !== 'none');

  /** text, image, shape or box; null for an empty shell (a click there goes to what is under it). */
  const kindOf = (el) => {
    if (isSvgText(el) && textOf(el)) return 'text';
    const byTag = tagKind(el.localName.toLowerCase());
    if (byTag) return byTag;
    if (el.namespaceURI !== SVG_NS && textOf(el)) return 'text';
    return paints(css(el)) ? 'box' : null;
  };

  const angleDeg = (raw) => {
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v)) return 0;
    if (/rad$/i.test(raw)) return (v * 180) / Math.PI;
    if (/turn$/i.test(raw)) return v * 360;
    if (/grad$/i.test(raw)) return v * 0.9;
    return v;
  };
  const transformTurn = (transform) => {
    if (!transform || transform === 'none') return 0;
    const m = /matrix(3d)?\(([^)]+)\)/i.exec(transform);
    if (!m) return 0;
    const n = m[2].split(',').map((x) => Number.parseFloat(x));
    return Number.isFinite(n[0]) && Number.isFinite(n[1]) ? (Math.atan2(n[1], n[0]) * 180) / Math.PI : 0;
  };
  const ownTurn = (el) => { const r = css(el).rotate; return r && r !== 'none' ? angleDeg(r.split(/\s+/).pop()) : 0; };
  /** How far a layer and everything around it in its page is turned (the `rotate` property and `transform`). */
  const totalTurn = (el) => {
    let r = 0;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) r += ownTurn(node) + transformTurn(css(node).transform);
    return r;
  };

  /** The override geometry painted on a layer now (inline translate / scale / rotate). */
  const paintedOf = (el) => {
    const tr = el.style.getPropertyValue('translate').trim();
    const sc = el.style.getPropertyValue('scale').trim();
    const ro = el.style.getPropertyValue('rotate').trim();
    const px = tr && tr !== 'none' ? tr.split(/\s+/).map((v) => Number.parseFloat(v) || 0) : [];
    const sp = sc && sc !== 'none' ? sc.split(/\s+/).map((v) => Number.parseFloat(v) || 1) : [];
    return { t: [px[0] ?? 0, px[1] ?? 0], s: [sp[0] ?? 1, sp[1] ?? sp[0] ?? 1], r: ro && ro !== 'none' ? angleDeg(ro) : 0 };
  };

  /** A layer's box in its page. A group's is the box of what is in it (it fills the frame and paints nothing). */
  const rectOf = (el) => {
    if (isGroup(el)) {
      let l = Infinity; let t = Infinity; let r = -Infinity; let b = -Infinity;
      for (const c of el.querySelectorAll('*')) {
        if (isGroup(c) || SKIP.has(c.localName.toLowerCase()) || invisible(c)) continue;
        const x = c.getBoundingClientRect();
        if (x.width < 1 || x.height < 1) continue;
        l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom);
      }
      if (l < r && t < b) return { left: l, top: t, width: r - l, height: b - t };
    }
    const x = el.getBoundingClientRect();
    return { left: x.left, top: x.top, width: x.width, height: x.height };
  };

  /**
   * A layer's frame in its page as drawn: center from its box, true width and height worked out from its laid-out
   * aspect (times the override's scale) and its turn, so whatever scaled it is counted.
   */
  const measureFrame = (el, s, r) => {
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    let lw = el.offsetWidth;
    let lh = el.offsetHeight;
    if (!(lw > 0 && lh > 0)) {
      try { const bb = el.getBBox?.(); lw = bb?.width ?? 0; lh = bb?.height ?? 0; } catch { lw = 0; lh = 0; }
    }
    if (!(lw > 0 && lh > 0)) return { cx, cy, w: box.width, h: box.height, r: 0 };
    const ratio = (lw * s[0]) / (lh * s[1]);
    const rad = (r * Math.PI) / 180;
    const c = Math.abs(Math.cos(rad));
    const sn = Math.abs(Math.sin(rad));
    const h = (box.width + box.height) / (ratio * c + sn + ratio * sn + c);
    return { cx, cy, w: ratio * h, h, r };
  };
  /** The frame a layer is drawn in (turned with it and its parents): hover, hit and the selection box share it. */
  const frameOf = (el, rect = rectOf(el)) => {
    const r = totalTurn(el);
    if (Math.abs(r % 360) < 0.01 || isGroup(el)) return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, w: rect.width, h: rect.height, r: 0 };
    return measureFrame(el, paintedOf(el).s, r);
  };
  const inFrame = (f, x, y) => {
    if (!f.r) return Math.abs(x - f.cx) <= f.w / 2 && Math.abs(y - f.cy) <= f.h / 2;
    const rad = (-f.r * Math.PI) / 180;
    const dx = x - f.cx;
    const dy = y - f.cy;
    return Math.abs(dx * Math.cos(rad) - dy * Math.sin(rad)) <= f.w / 2 + 0.5 && Math.abs(dx * Math.sin(rad) + dy * Math.cos(rad)) <= f.h / 2 + 0.5;
  };
  /** Override px → page px: `translate` is in the parent's coordinates, so the parent's own scale counts. */
  const localScale = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const r = p.getBoundingClientRect();
      if (p.offsetWidth > 0 && r.width > 0) return r.width / p.offsetWidth;
    }
    return 1;
  };

  /* ── selectors: a name a person's tweak keeps pointing at when the page is rewritten around it ── */
  const stepOf = (el) => {
    const tag = el.localName;
    const classes = [...el.classList].filter((c) => /^[A-Za-z_][\w-]*$/.test(c)).slice(0, 3);
    const named = tag + classes.map((c) => `.${CSS.escape(c)}`).join('');
    const siblings = [...el.parentElement.children];
    if (siblings.filter((c) => c.tagName === el.tagName && classes.every((k) => c.classList.contains(k))).length === 1) return named;
    const typed = siblings.filter((c) => c.tagName === el.tagName);
    return `${named}:nth-of-type(${typed.indexOf(el) + 1})`;
  };
  const selectorOf = (el) => {
    const doc = el.ownerDocument;
    if (el.id && doc.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
    const parentEl = el.parentElement;
    if (!parentEl || el === doc.body) return el.localName;
    return `${parentEl === doc.body ? 'body' : selectorOf(parentEl)} > ${stepOf(el)}`;
  };
  const matches = (doc, o) => {
    let nodes = [];
    try { nodes = [...doc.querySelectorAll(o.at)]; } catch { return []; }
    return o.n ? nodes.slice(o.n - 1, o.n) : nodes;
  };
  /** Its selector, and which match it is when the selector finds several. */
  const locOf = (el) => {
    const at = selectorOf(el);
    const all = matches(el.ownerDocument, { at });
    if (all.length <= 1) return { at, loc: at };
    const n = all.indexOf(el) + 1;
    return { at, n, loc: `${at}#${n}`, instance: n, instances: all.length };
  };
  const targetOf = (el) => { const { at, n } = locOf(el); return n ? { at, n } : { at }; };

  /** The clip's kept override that applies to this element (the last one that finds it). */
  const overrideOf = (c, el) => {
    let found = null;
    for (const o of c.overrides ?? []) if (matches(el.ownerDocument, o).includes(el)) found = o;
    if (!found) return null;
    const out = {};
    if (Array.isArray(found.t)) out.t = [Number(found.t[0]) || 0, Number(found.t[1]) || 0];
    if (found.s != null) out.s = found.s;
    if (typeof found.r === 'number') out.r = found.r;
    if (found.style && typeof found.style === 'object') out.style = found.style;
    if (found.lock === true) out.lock = true;
    if (typeof found.text === 'string') out.text = found.text;
    return Object.keys(out).length ? out : null;
  };
  /** Locked here or on a layer around it: not dragged, not boxed, not hovered. */
  const lockedOf = (c, el) => {
    const locks = (c.overrides ?? []).filter((o) => o.lock === true);
    if (!locks.length) return false;
    const held = new Set(locks.flatMap((o) => matches(el.ownerDocument, o)));
    for (let node = el; node; node = node.parentElement) if (held.has(node)) return true;
    return false;
  };

  /* what arrange (below) needs to know of a layer and its parents */
  const FLEX_OR_GRID = /^(inline-)?(flex|grid)$/;
  const stackingContext = (node) => {
    /* the root only: a body with a background of its own would hide a layer sent behind it */
    if (node === node.ownerDocument.documentElement) return true;
    const cs = css(node);
    /* a flex or grid item with a z-index is one too (zOf, below) */
    return cs.isolation === 'isolate' || (cs.position !== 'static' && cs.zIndex !== 'auto') || Number.parseFloat(cs.opacity) < 1
      || cs.transform !== 'none' || cs.translate !== 'none' || cs.scale !== 'none' || cs.rotate !== 'none'
      || cs.filter !== 'none' || cs.mixBlendMode !== 'normal' || cs.clipPath !== 'none'
      || (cs.maskImage || cs.webkitMaskImage || 'none') !== 'none' || zOf(node) != null;
  };
  /** Whether a z-index on it counts: it has a position, or it is laid out by a flex or grid parent. */
  const placedIn = (node) => css(node).position !== 'static' || FLEX_OR_GRID.test(css(node.parentElement ?? node).display);
  /** The z-index it is drawn by, null for auto (a z-index where it does not count is auto). */
  const zOf = (node) => {
    if (!placedIn(node)) return null;
    const z = Number.parseInt(css(node).zIndex, 10);
    return Number.isFinite(z) ? z : null;
  };
  /**
   * Where a layer is drawn in the stacking context it is in, as CSS paints them: by z-index (auto is 0); at the same
   * z, those without a position first, then those with one and the stacking contexts made otherwise (a transform, an
   * opacity, an isolation); then in document order (compare `order` last).
   */
  const paintKey = (node) => {
    const z = zOf(node);
    if (z == null) return [0, css(node).position !== 'static' || stackingContext(node) ? 1 : 0];
    return [z, z < 0 ? 0 : z === 0 ? 1 : 2];
  };
  const paintCompare = (a, b) => {
    const ka = paintKey(a);
    const kb = paintKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  };
  /**
   * The part of a layer drawn last: the layer itself when it is a stacking context (all of it is drawn at once), else
   * the latest of it and what is in it, since those are drawn among its siblings (a transformed card inside a plain
   * column is drawn with the positioned layers, after a sibling column with a z-index of 0). `memo`: per reading.
   */
  const reachOf = (node, memo) => {
    let best = memo.get(node);
    if (best) return best;
    best = node;
    if (!stackingContext(node)) {
      for (const ch of node.children) {
        if (SKIP.has(ch.localName.toLowerCase())) continue;
        const r = reachOf(ch, memo);
        if (paintCompare(best, r) < 0) best = r;
      }
    }
    memo.set(node, best);
    return best;
  };
  /** Siblings in the order they are drawn, by what of each is drawn last; a fresh reading each time. */
  const siblingOrder = (nodes) => {
    const memo = new Map();
    return [...nodes].sort((a, b) => paintCompare(reachOf(a, memo), reachOf(b, memo)));
  };
  /** whether giving `node` a position would move what is placed inside it against something further out */
  const unsafe = (node) => [...node.querySelectorAll('*')].some((inner) => {
    if (css(inner).position !== 'absolute') return false;
    for (let up = inner.parentElement; up && up !== node; up = up.parentElement) if (css(up).position !== 'static') return false;
    return true;
  });

  /* styles the inspector shows per kind (computed: a page states none as source keys) */
  const TEXT_STYLE_KEYS = ['fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlign', 'color', 'opacity'];
  const SVG_TEXT_STYLE_KEYS = ['fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'letterSpacing', 'fill', 'opacity'];
  const KIND_STYLE_KEYS = { text: [...TEXT_STYLE_KEYS, 'textTransform'], image: ['opacity', 'borderRadius', 'objectFit', 'objectPosition', 'clipPath'], shape: ['opacity'], box: ['backgroundColor', 'borderRadius', 'opacity', 'clipPath'] };
  /* the look every kind shows (blend, adjustments and shadow, stroke, faded edges): as the page draws it, its CSS's or its own */
  const LOOK_STYLE_KEYS = ['mixBlendMode', 'filter', 'border', 'maskImage', 'maskComposite'];
  const LOOK_KEYS = new Set([...LOOK_STYLE_KEYS, 'textTransform', 'objectPosition', 'clipPath']);
  const UNITLESS = new Set(['opacity', 'fontWeight', 'lineHeight', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order', 'zoom', 'scale', 'fillOpacity', 'strokeOpacity', 'strokeMiterlimit']);
  const isColorKey = (key) => /^(color|fill|stroke|background|backgroundColor|borderColor|outlineColor|stopColor)$/.test(key) || /Color$/.test(key);
  const pxNumber = (value) => {
    const m = /^(-?[\d.]+)px$/.exec(String(value).trim());
    if (!m) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : undefined;
  };
  /** `rgb(…)` / `rgba(…)` as hex; a see-through color keeps its alpha (`#00ff0080`), as the inspector wrote it. */
  const rgbToHex = (color) => {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(color.trim());
    if (!m) return color.startsWith('#') ? color : undefined;
    const hex = (n) => Number(n).toString(16).padStart(2, '0');
    const a = m[4] == null ? 1 : Number(m[4]);
    return `#${[m[1], m[2], m[3]].map(hex).join('')}${a < 1 ? hex(Math.round(a * 255)) : ''}`;
  };
  const own = (el, name) => el.style.getPropertyValue(name).trim();
  const styleValue = (el, key, cs) => {
    const name = kebab(key);
    if (key === 'lineHeight') {
      const mine = own(el, 'line-height');
      if (mine && !mine.endsWith('px')) { const n = Number(mine); return Number.isFinite(n) ? n : mine; }
      const size = pxNumber(cs.fontSize);
      const leading = pxNumber(mine || cs.lineHeight);
      return leading != null && size ? Math.round((leading / size) * 100) / 100 : undefined;
    }
    if (isColorKey(key)) {
      const mine = own(el, name);
      if (mine && /gradient|url\(/i.test(mine)) return mine;
      return rgbToHex(mine || cs.getPropertyValue(name)) ?? (mine || undefined);
    }
    if (key === 'fontWeight') return own(el, 'font-weight') || cs.fontWeight || undefined;
    if (key === 'fontFamily') return own(el, 'font-family') || cs.fontFamily || undefined;
    if (key === 'fontStyle') { const v = own(el, 'font-style') || cs.fontStyle; return v && v !== 'normal' ? v : undefined; }
    if (key === 'textAlign') { const v = own(el, 'text-align') || cs.textAlign; return v && v !== 'start' ? v : undefined; }
    if (LOOK_KEYS.has(key)) { const v = own(el, name) || cs.getPropertyValue(name); return v && !/^(none|normal|add|50% 50%)$/.test(v) && !/^0px none\b/.test(v) ? v : undefined; }
    if (UNITLESS.has(key)) {
      const mine = own(el, name);
      const n = Number(mine || cs.getPropertyValue(name));
      return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : (mine || undefined);
    }
    const mine = own(el, name);
    if (!mine || /^-?[\d.]+px$/.test(mine) || mine === '0') { const n = pxNumber(mine || cs.getPropertyValue(name)); if (n != null) return n; }
    return mine || undefined;
  };
  const styleOf = (el, kind) => {
    const style = {};
    const cs = css(el);
    let keys = [...(kind === 'text' && isSvgText(el) ? SVG_TEXT_STYLE_KEYS : KIND_STYLE_KEYS[kind]), ...LOOK_STYLE_KEYS];
    /* a line with its own fill (a badge, a tag) is a box too */
    if (kind === 'text' && paints(cs)) keys.push('backgroundColor', 'borderRadius');
    keys = [...new Set(keys)];
    for (const key of keys) {
      if (key === 'backgroundColor' && transparent(cs.backgroundColor)) continue;
      if (key === 'objectFit') { const fit = own(el, 'object-fit') || cs.objectFit; if (fit) style[key] = fit; continue; }
      if (key === 'borderRadius') {
        const mine = own(el, 'border-radius');
        const n = pxNumber(mine || cs.borderTopLeftRadius);
        if (n != null) style[key] = n; else if (mine) style[key] = mine;
        continue;
      }
      const value = styleValue(el, key, cs);
      if (value != null && value !== '') style[key] = value;
    }
    return style;
  };

  const labelOf = (el, kind) => {
    if (kind === 'text') {
      const text = textOf(el).replace(/\s+/g, ' ');
      if (text) return text.length <= 32 ? text : `${text.slice(0, 32)}…`;
    }
    if (kind === 'image') {
      const src = el.getAttribute('src') ?? '';
      const name = src.startsWith('data:') ? null : src.split(/[?#]/)[0].split('/').pop();
      if (name) { try { return decodeURIComponent(name); } catch { return name; } }
    }
    if ((kind === 'box' || kind === 'shape') && el.querySelectorAll('*').length <= 1) {
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (text && text.length <= 24) return text;
    }
    return el.localName.toLowerCase();
  };
  /** The layers around this one in its page (nearest first), at most four: the inspector's breadcrumb. */
  const parentsOf = (el) => {
    const out = [];
    for (let node = el.parentElement; node && node !== el.ownerDocument.body && out.length < 4; node = node.parentElement) {
      const kind = kindOf(node) ?? (isGroup(node) ? 'box' : null);
      if (kind) out.push({ loc: locOf(node).loc, label: labelOf(node, kind), kind });
    }
    return out;
  };

  /** All layers under a point of a clip's page, the smallest first (equal areas: the one drawn later first). */
  const layersAt = (c, x, y, includeLocked) => {
    const hits = [];
    layersOf(c.win.document).forEach((el, order) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
      const frame = frameOf(el, rect);
      if (frame.r && !inFrame(frame, x, y)) return;
      const kind = kindOf(el);
      if (!kind || invisible(el)) return;
      if (!includeLocked && lockedOf(c, el)) return;
      hits.push({ el, kind, rect, frame, area: frame.w * frame.h, order });
    });
    return hits.sort((a, b) => a.area - b.area || b.order - a.order);
  };
  /** A layer inside a group is the group until the group is entered (a layer of it is in hand). */
  const liftToGroup = (hit, current) => {
    const groups = [];
    for (let n = hit.el.parentElement; n && n !== hit.el.ownerDocument.body; n = n.parentElement) if (isGroup(n)) groups.unshift(n);
    for (const g of groups) {
      if (current && current !== g && g.contains(current)) continue;
      return { el: g, kind: 'box' };
    }
    return hit;
  };

  /** What the editor gets of a layer: who it is, and where it is on the stage now. */
  const describe = (c, el, kind = kindOf(el) ?? (isGroup(el) ? 'box' : null)) => {
    if (!kind) return null;
    const M = matrixOf(c);
    const rect = rectOf(el);
    const g = paintedOf(el);
    const group = isGroup(el);
    const local = group
      ? { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, w: rect.width, h: rect.height, r: 0 }
      : measureFrame(el, g.s, totalTurn(el));
    const words = kind === 'text' ? textOf(el) : '';
    const where = locOf(el);
    const turn = clipTurn(M);
    return {
      handle: handleOf(el),
      clip: c.id,
      ...where,
      kind,
      tag: el.localName.toLowerCase(),
      label: labelOf(el, kind),
      ...(words ? { text: { value: words, shape: 'value' } } : {}),
      style: styleOf(el, kind),
      parents: parentsOf(el),
      override: overrideOf(c, el),
      group,
      locked: lockedOf(c, el),
      svg: el.namespaceURI === SVG_NS,
      rect: mapRect(M, rect),
      frame: mapFrame(M, local),
      geo: {
        g,
        /* stage px per override px */
        k: localScale(el) * clipScale(M),
        parentR: (el.parentElement ? totalTurn(el.parentElement) : 0) + turn,
        around: totalTurn(el) - ownTurn(el) + turn,
      },
    };
  };
  /** Just where a hovered layer is (asked once a frame). */
  const outline = (c, hit) => {
    const M = matrixOf(c);
    const turned = hit.frame.r || clipTurn(M);
    return { handle: handleOf(hit.el), rect: mapRect(M, hit.rect), ...(turned ? { frame: mapFrame(M, hit.frame) } : {}) };
  };
  /** A layer by its handle, else by its clip and its selector (`at` and `n`, or a `loc`: `at`, or `at#n`). */
  const layerOf = (ref) => {
    let el = nodeOf(ref.handle);
    let c = el ? clipOfNode(el) : null;
    if (!el && ref.clip) {
      c = clipById(ref.clip);
      const doc = c?.win?.document;
      const loc = ref.loc && /^(.*)#(\d+)$/.exec(ref.loc);
      if (doc && ref.at) el = matches(doc, { at: ref.at, n: ref.n })[0] ?? null;
      else if (doc && ref.loc) el = matches(doc, { at: ref.loc })[0] ?? (loc ? matches(doc, { at: loc[1], n: Number(loc[2]) })[0] : null) ?? null;
    }
    return el && c ? { el, c } : null;
  };

  /* ── changes shown before they are kept: the clip's overrides with the drafts merged, as its preview ── */
  const drafts = new Map();
  const sameTarget = (o, t) => o.at === t.at && (o.n ?? null) === (t.n ?? null);
  const show = (c) => {
    const d = drafts.get(c.id);
    if (!d) return;
    const list = (c.overrides ?? []).map((o) => ({ ...o, ...(o.style ? { style: { ...o.style } } : {}) }));
    for (const { target, patch } of d.items.values()) {
      let o = list.find((x) => sameTarget(x, target));
      if (!o) { o = { at: target.at, ...(target.n ? { n: target.n } : {}) }; list.push(o); }
      if (patch.t) o.t = patch.t;
      if ('s' in patch) o.s = patch.s;
      if ('r' in patch) o.r = patch.r;
      if (patch.style) {
        const style = { ...(o.style ?? {}) };
        for (const [k, v] of Object.entries(patch.style)) { if (v == null || v === '') delete style[k]; else style[k] = v; }
        o.style = style;
      }
      if ('text' in patch) { if (patch.text == null) delete o.text; else o.text = patch.text; }
    }
    editor()?.preview(c.id, list);
  };
  const draft = (c, target, patch) => {
    let d = drafts.get(c.id);
    if (!d) { d = { base: JSON.stringify(c.overrides ?? []), items: new Map() }; drafts.set(c.id, d); }
    const key = `${target.at}\u0000${target.n ?? ''}`;
    const prev = d.items.get(key)?.patch ?? {};
    d.items.set(key, { target, patch: { ...prev, ...patch, ...(prev.style || patch.style ? { style: { ...(prev.style ?? {}), ...(patch.style ?? {}) } } : {}) } });
    show(c);
  };
  const release = (id) => {
    if (!drafts.delete(id)) return;
    editor()?.preview(id, null);
  };
  /* the film was updated: a clip whose kept overrides changed shows them, not the drafts made against the old ones */
  const updated = () => {
    for (const [id, d] of drafts) {
      const c = clipById(id);
      if (!c || JSON.stringify(c.overrides ?? []) !== d.base) release(id);
    }
  };

  const paint = (el, c, g) => draft(c, targetOf(el), { t: [g.t[0], g.t[1]], s: g.s[0] === g.s[1] ? g.s[0] : [g.s[0], g.s[1]], r: g.r });
  /**
   * Paint an override and shift its offset until the layer's center sits at `target` (page px): CSS scales and turns
   * about the box before the page's own transform, so a layer the page moved (or an SVG shape) would otherwise not
   * scale or turn in place. The offset is outermost, a pure shift: paint, measure, correct, two or three times.
   */
  const paintAround = (el, c, g, target) => {
    const k = localScale(el) || 1;
    let t = [g.t[0], g.t[1]];
    for (let i = 0; i < 3; i++) {
      paint(el, c, { ...g, t });
      const box = el.getBoundingClientRect();
      const dx = target.x - (box.left + box.width / 2);
      const dy = target.y - (box.top + box.height / 2);
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) break;
      t = [t[0] + dx / k, t[1] + dy / k];
    }
    t = [Math.round(t[0] * 10) / 10, Math.round(t[1] * 10) / 10];
    paint(el, c, { ...g, t });
    return { ...g, t };
  };
  /** Where a frame's center goes when it takes a new size with `pivot` (a corner, an edge or the center) held. */
  const pivotCenter = (f, next, pivot) => {
    const rad = (f.r * Math.PI) / 180;
    const ux = { x: Math.cos(rad), y: Math.sin(rad) };
    const uy = { x: -Math.sin(rad), y: Math.cos(rad) };
    const ax = f.cx + (ux.x * pivot.hx * f.w) / 2 + (uy.x * pivot.hy * f.h) / 2;
    const ay = f.cy + (ux.y * pivot.hx * f.w) / 2 + (uy.y * pivot.hy * f.h) / 2;
    return { x: ax - (ux.x * pivot.hx * next.w) / 2 - (uy.x * pivot.hy * next.h) / 2, y: ay - (ux.y * pivot.hx * next.w) / 2 - (uy.y * pivot.hy * next.h) / 2 };
  };
  const pair = (s) => (Array.isArray(s) ? [s[0] ?? 1, s[1] ?? 1] : typeof s === 'number' && s > 0 ? [s, s] : [1, 1]);
  const placed = (el, c) => {
    const M = matrixOf(c);
    const g = paintedOf(el);
    return { rect: mapRect(M, rectOf(el)), frame: mapFrame(M, measureFrame(el, g.s, totalTurn(el))) };
  };

  /* ── typing a line in place ── */
  let editing = null;
  /**
   * The box typed in when the line cannot be typed in itself: an SVG text (no contentEditable there), or a line with
   * inline parts (only its own words are its text). Fixed in the page over the line, in its type, the line hidden.
   */
  const openOverlay = (el) => {
    const doc = el.ownerDocument;
    const rect = el.getBoundingClientRect();
    const cs = css(el);
    const svg = isSvgText(el);
    let scale = 1;
    if (svg) {
      try {
        const bb = el.getBBox?.();
        if (bb && bb.height > 0 && rect.height > 0) scale = rect.height / bb.height;
        else { const ctm = el.getScreenCTM?.(); if (ctm) scale = Math.hypot(ctm.a, ctm.b) || 1; }
      } catch { scale = 1; }
    }
    const round = (n) => Math.round(n * 100) / 100;
    const size = pxNumber(cs.fontSize);
    const spacing = pxNumber(cs.letterSpacing);
    const fill = cs.fill.trim();
    const color = svg ? (/^url\(/i.test(fill) || fill === 'none' || !fill ? '#ffffff' : fill) : cs.color;
    const align = svg ? (cs.textAnchor === 'middle' ? 'center' : cs.textAnchor === 'end' ? 'right' : 'left') : cs.textAlign;
    const box = doc.createElement('div');
    box.setAttribute(EDITOR_ATTR, '');
    box.textContent = textOf(el);
    const style = {
      position: 'fixed', left: `${round(rect.left)}px`, top: `${round(rect.top)}px`,
      'min-width': `${round(Math.max(1, rect.width))}px`, 'min-height': `${round(Math.max(1, rect.height))}px`,
      ...(svg ? { height: `${round(Math.max(1, rect.height))}px`, 'line-height': `${round(Math.max(1, rect.height))}px` } : { 'line-height': cs.lineHeight }),
      margin: '0', padding: '0', border: '0', background: 'transparent', 'box-sizing': 'content-box',
      'white-space': svg ? 'pre' : 'pre-wrap', 'text-align': align,
      'font-family': cs.fontFamily, 'font-weight': cs.fontWeight, 'font-style': cs.fontStyle || 'normal',
      'font-size': size != null ? `${round(size * scale)}px` : cs.fontSize,
      ...(spacing != null ? { 'letter-spacing': `${round(spacing * scale)}px` } : {}),
      ...(cs.textTransform && cs.textTransform !== 'none' ? { 'text-transform': cs.textTransform } : {}),
      color, 'z-index': '2147483647',
    };
    for (const [name, value] of Object.entries(style)) box.style.setProperty(name, value, 'important');
    (doc.body ?? doc.documentElement).appendChild(box);
    return box;
  };
  const finishText = (commit) => {
    const edit = editing;
    if (!edit) return;
    editing = null;
    edit.cleanup();
    const { el, host, c } = edit;
    const value = edit.overlay ? collapse(host.innerText ?? host.textContent ?? '') : stageText(host);
    if (edit.overlay) host.remove();
    const put = (name, v) => { if (v == null) el.removeAttribute(name); else el.setAttribute(name, v); };
    put('contenteditable', edit.attrs.contentEditable);
    put('style', edit.attrs.style);
    put('spellcheck', edit.attrs.spellcheck);
    el.replaceChildren(...edit.children);
    edit.data.forEach((text, n) => { n.data = text; });
    el.ownerDocument.getSelection()?.removeAllRanges();
    const kept = commit && value && value !== edit.before;
    /* the new words stay on screen until the edit is kept (or refused: the editor releases the clip) */
    if (kept) draft(c, edit.target, { text: value });
    post({ type: 'stage-event', event: 'text', handle: edit.handle, commit: Boolean(kept), ...(kept ? { value, before: edit.before } : {}) });
  };
  const startText = ({ handle, multiline }) => {
    const el = nodeOf(handle);
    const c = el && clipOfNode(el);
    if (!el || !c || editing) return false;
    const doc = el.ownerDocument;
    const data = new Map();
    const walker = doc.createTreeWalker(el, 4);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) data.set(n, n.data);
    const attrs = { contentEditable: el.getAttribute('contenteditable'), style: el.getAttribute('style'), spellcheck: el.getAttribute('spellcheck') };
    const overlay = isSvgText(el) || el.childElementCount > 0;
    const host = overlay ? openOverlay(el) : el;
    if (overlay) el.style.setProperty('visibility', 'hidden', 'important');
    try { host.contentEditable = 'plaintext-only'; } catch { host.contentEditable = 'true'; }
    if (host.contentEditable !== 'plaintext-only') host.contentEditable = 'true';
    host.spellcheck = false;
    for (const [name, value] of [['user-select', 'text'], ['-webkit-user-select', 'text'], ['cursor', 'text'], ['outline', 'none'], ['pointer-events', 'auto'], ['caret-color', BLUE]]) {
      host.style.setProperty(name, value, 'important');
    }
    const lines = Boolean(multiline) && !overlay;
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finishText(false); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !lines)) { e.preventDefault(); finishText(true); }
    };
    const onBlur = () => finishText(true);
    host.addEventListener('keydown', onKey);
    host.addEventListener('blur', onBlur);
    editing = {
      el, host, c, handle, overlay, data, attrs, target: targetOf(el),
      children: [...el.childNodes],
      before: textOf(el),
      cleanup: () => { host.removeEventListener('keydown', onKey); host.removeEventListener('blur', onBlur); },
    };
    window.focus();
    c.win.focus();
    host.focus({ preventScroll: true });
    doc.getSelection()?.selectAllChildren(host);
    return true;
  };

  /* ── keys pressed while the picture has focus go to the editor (its own keys work there too) ── */
  const typing = (target) => {
    const el = target?.nodeType === 1 ? target : null;
    return Boolean(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable));
  };
  const EDITOR_KEYS = new Set([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', '[', ']']);
  const onKey = (e) => {
    if (editing || typing(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if ((EDITOR_KEYS.has(e.key) && !mod) || (mod && (k === 'z' || (e.shiftKey && (k === 'h' || k === 'l'))))) e.preventDefault();
    post({ type: 'stage-event', event: 'key', key: e.key, code: e.code, repeat: e.repeat, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey });
  };
  const listening = new WeakSet();
  const listen = (win) => {
    if (!win || listening.has(win)) return;
    listening.add(win);
    win.addEventListener('keydown', onKey, true);
  };
  const listenAll = () => { listen(window); for (const c of clips()) if (c.win) listen(c.win); };
  listen(window);
  (async () => {
    while (!window.film) await new Promise((r) => setTimeout(r, 20));
    try { await window.film.ready; } catch { return; }
    listenAll();
    const h = hooks();
    /* an update may have added pages: their keys are heard too */
    if (h) h.updated = () => { listenAll(); updated(); };
  })();

  /* ── restacking ── */
  /** Hit tests that see every layer (a page may turn pointer events off), for as long as `fn` runs. */
  const seeingAll = (doc, fn) => {
    const probe = doc.createElement('style');
    probe.textContent = '* { pointer-events: auto !important; }';
    doc.head.append(probe);
    try { return fn(); } finally { probe.remove(); }
  };
  /**
   * Whether `upper` (or anything in it) is drawn over `lower` where their boxes overlap, as hit tests at a few points
   * there find them: null when they do not overlap or nothing of them is found there. The page's paint, not a model
   * of it (a transformed layer deep inside a group is drawn with the positioned ones, wherever its group is).
   */
  const drawnOver = (upper, lower) => {
    const doc = upper.ownerDocument;
    const a = upper.getBoundingClientRect();
    const b = lower.getBoundingClientRect();
    const l = Math.max(a.left, b.left), t = Math.max(a.top, b.top);
    const r = Math.min(a.right, b.right), bt = Math.min(a.bottom, b.bottom);
    if (r - l < 1 || bt - t < 1) return null;
    let over = 0;
    let under = 0;
    for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) {
      const hits = doc.elementsFromPoint(l + (r - l) * fx, t + (bt - t) * fy);
      const iu = hits.findIndex((h) => upper === h || upper.contains(h));
      const il = hits.findIndex((h) => lower === h || lower.contains(h));
      if (iu < 0 || il < 0) continue;
      if (iu < il) over += 1; else under += 1;
    }
    return over + under ? over > under : null;
  };
  const near = (p, q) => Math.abs(p.left - q.left) < 0.5 && Math.abs(p.top - q.top) < 0.5 && Math.abs(p.width - q.width) < 0.5 && Math.abs(p.height - q.height) < 0.5;
  /**
   * Restacking edits (override targets and styles) as they can be kept, or null. A position given to a layer the page
   * left static makes the offsets its CSS gave it count (top: 2em on a static block is nothing, on a relative one a
   * shift), so the edits are shown for a moment and every layer measured, then again with those offsets set back to
   * auto. `check`, asked while they are shown: whether they do what they were for.
   */
  const steady = (c, edits, check = () => true) => {
    const seen = layersOf(c.win.document);
    const before = seen.map((o) => o.getBoundingClientRect());
    const had = drafts.get(c.id);
    const kept = had && new Map(had.items);
    const holds = (list) => {
      for (const e of list) draft(c, e.target, { style: e.style });
      const ok = seen.every((o, i) => near(o.getBoundingClientRect(), before[i])) && check();
      if (had) { had.items = new Map(kept); drafts.set(c.id, had); show(c); } else release(c.id);
      return ok;
    };
    if (holds(edits)) return edits;
    const inset = { top: 'auto', right: 'auto', bottom: 'auto', left: 'auto' };
    const pinned = edits.map((e) => (e.style.position ? { ...e, style: { ...e.style, ...inset } } : e));
    return pinned.some((e) => e.style.position) && holds(pinned) ? pinned : null;
  };

  /* ── the Layers panel's tree ── */
  const ROWS = 800;
  /** Per element, whether the clip's kept overrides hide it (the panel's eye) or lock it: the last one to say counts. */
  const ownOverrides = (c) => {
    const out = new Map();
    for (const o of c.overrides ?? []) {
      const says = {
        ...(o.style && 'visibility' in o.style ? { hidden: o.style.visibility === 'hidden' } : {}),
        ...('lock' in o ? { locked: o.lock === true } : {}),
      };
      if (Object.keys(says).length) for (const el of matches(c.win.document, o)) out.set(el, { ...out.get(el), ...says });
    }
    return out;
  };
  const nameOf = (el) => {
    if (el.id) return `#${el.id}`;
    const cls = [...el.classList].find((k) => /^[A-Za-z_][\w-]*$/.test(k));
    return cls ? `${el.localName}.${cls}` : el.localName;
  };
  /**
   * A page's layers as rows: words, pictures and SVG drawings are rows without rows inside; an element around
   * several rows is a group row (its own paint, if any, makes it a box); one around a single row is no row of its
   * own (that row stands for it). `branch` is the handle of the child of the row's parent row that holds it: rows are
   * restacked by it. `off`: not drawn at this moment (faded out, hidden, no size).
   */
  const rowsOf = (c) => {
    let count = 0;
    const doc = c.win.document;
    const kept = ownOverrides(c);
    const collect = (parentEl) => {
      const out = [];
      for (const ch of parentEl.children) {
        if (count >= ROWS) break;
        const tag = ch.localName.toLowerCase();
        if (SKIP.has(tag) || ch.hasAttribute(EDITOR_ATTR)) continue;
        const kind = kindOf(ch) ?? (isGroup(ch) ? 'box' : null);
        const leaf = tag === 'svg' || kind === 'text' || kind === 'image';
        const inner = leaf ? [] : collect(ch);
        if (!kind && !leaf) {
          if (!inner.length) continue;
          if (inner.length === 1) { out.push({ ...inner[0], branch: handleOf(ch), at: ch }); continue; }
        }
        count += 1;
        const own = kept.get(ch) ?? {};
        const r = ch.getBoundingClientRect();
        const where = locOf(ch);
        const named = kind ? labelOf(ch, kind) : tag;
        out.push({
          handle: handleOf(ch),
          branch: handleOf(ch),
          at: ch,
          loc: where.loc,
          ...(where.instance ? { instance: where.instance } : {}),
          tag,
          kind: kind ?? (leaf ? 'shape' : 'group'),
          /* a layer with nothing better to go by than its tag goes by its id or class */
          label: named === tag ? nameOf(ch) : named,
          hidden: own.hidden === true,
          locked: own.locked === true,
          off: invisible(ch) || css(ch).visibility === 'hidden' || r.width < 1 || r.height < 1,
          children: inner,
        });
      }
      /* the one drawn on top first; `at` is the element each row is restacked by, dropped once sorted */
      const drawn = siblingOrder(out.map((r) => r.at));
      return out.sort((a, b) => drawn.indexOf(b.at) - drawn.indexOf(a.at)).map(({ at, ...row }) => row);
    };
    return collect(doc.body);
  };

  /* ── the ops ── */
  const ops = {
    /** The layer under a point: the smallest (Alt: the next one under `cycleFrom`); groups stand for their layers. */
    hit({ x, y, cycleFrom, includeLocked, from, enter, detail }) {
      const c = clipAt(x, y);
      if (!c || c.kind !== 'page' || !c.win) return null;
      const p = matrixOf(c).inverse().transformPoint(new DOMPoint(x, y));
      const all = layersAt(c, p.x, p.y, Boolean(includeLocked));
      let current = nodeOf(from);
      if (enter && current) current = current.firstElementChild;
      const cycle = nodeOf(cycleFrom);
      let hit;
      if (!cycle || all.length < 2) hit = all[0] ? liftToGroup(all[0], current) : null;
      else hit = all[(all.findIndex((h) => h.el === cycle) + 1) % all.length] ?? all[0];
      if (!hit) return null;
      if (detail) return describe(c, hit.el, hit.kind);
      const rect = hit.rect ?? rectOf(hit.el);
      return outline(c, { el: hit.el, rect, frame: hit.frame ?? frameOf(hit.el, rect) });
    },
    /** A layer again, by handle, else by its clip and selector (after the page was drawn anew). */
    /** `any`: a layer that paints nothing itself (a Layers panel group) is taken as a box. */
    layer(ref) {
      const found = layerOf(ref);
      if (!found) return null;
      return describe(found.c, found.el, kindOf(found.el) ?? (isGroup(found.el) || ref.any ? 'box' : null));
    },
    layers({ refs }) { return refs.map((ref) => { const found = layerOf(ref); return found ? describe(found.c, found.el) : null; }); },
    /**
     * The outermost layers wholly inside a stage box (a marquee): not locked, not faded out, not under a pixel. `all`:
     * every one of them, those inside others too (the words in a box drawn to point at).
     */
    box({ x, y, w, h, all }) {
      const out = [];
      for (const c of shown()) {
        if (c.kind !== 'page' || !c.win) continue;
        const M = matrixOf(c);
        const inside = layersOf(c.win.document).filter((el) => {
          if (!(kindOf(el) || isGroup(el))) return false;
          const r = mapRect(M, rectOf(el));
          if (r.width < 1 || r.height < 1) return false;
          if (r.left < x || r.top < y || r.left + r.width > x + w || r.top + r.height > y + h) return false;
          return !invisible(el) && !lockedOf(c, el);
        });
        for (const el of inside) if (all || !inside.some((other) => other !== el && other.contains(el))) out.push(describe(c, el));
      }
      return out.filter(Boolean);
    },
    /** What the snapping of a layer move can catch: the stage, and up to 80 other visible layers of its page. */
    snaps({ handle }) {
      const el = nodeOf(handle);
      const c = el && clipOfNode(el);
      const out = [{ x: 0, y: 0, w: document.body.offsetWidth, h: document.body.offsetHeight }];
      if (!el || !c) return out;
      const M = matrixOf(c);
      for (const other of layersOf(c.win.document)) {
        if (out.length > 80) break;
        if (other === el || other.contains(el) || el.contains(other)) continue;
        const r = other.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || invisible(other)) continue;
        const m = mapRect(M, r);
        out.push({ x: m.left, y: m.top, w: m.width, h: m.height });
      }
      return out;
    },
    /** The picture clips: whether each is on screen now, and its box on the stage. */
    clips() {
      const on = new Set(shown());
      return clips().filter((c) => c.el && c.kind !== 'sound').map((c) => {
        const r = mapRect(matrixOf(c), { left: 0, top: 0, width: c.w, height: c.h });
        return { id: c.id, visible: on.has(c), x: r.left, y: r.top, w: r.width, h: r.height };
      });
    },
    /** `pictures`: a video or a still only (a page is clicked by its layers; what is under its empty parts is found). */
    clipAt({ x, y, pictures }) { return clipAt(x, y, Boolean(pictures))?.id ?? null; },
    /** Show a clip placed in a box not kept yet (null: in its own again). */
    place({ clip, box }) { hooks()?.place(clip, box ?? null); return true; },
    /** Show a clip in CSS of its own not kept yet (null: its own again). */
    look({ clip, css }) { hooks()?.look?.(clip, typeof css === 'string' ? css : null); return true; },
    /** Show a layer's move / scale / turn; with `center` (stage px), its offset keeps its center there. */
    paint({ handle, g, center }) {
      const el = nodeOf(handle);
      const c = el && clipOfNode(el);
      if (!el || !c) return null;
      let out = g;
      if (center) {
        const p = matrixOf(c).inverse().transformPoint(new DOMPoint(center.x, center.y));
        out = paintAround(el, c, g, { x: p.x, y: p.y });
      } else paint(el, c, g);
      return { g: out, ...placed(el, c) };
    },
    paintMany({ items }) {
      return items.map(({ handle, g }) => {
        const el = nodeOf(handle);
        const c = el && clipOfNode(el);
        if (!el || !c) return null;
        paint(el, c, g);
        return placed(el, c);
      });
    },
    /** The inspector's live tweaks of a layer (named by clip and selector): style keys, words, geometry. */
    tweak({ clip, at, n, patch }) {
      const c = clipById(clip);
      if (!c || c.kind !== 'page') return false;
      draft(c, n ? { at, n } : { at }, patch);
      return true;
    },
    /**
     * The inspector's scale / turn of a layer about a pivot (a corner of its box, or its center): the offset that keeps
     * that point in place, shown.
     */
    pivot({ clip, at, n, base, patch, pivot }) {
      const c = clipById(clip);
      const el = c?.win ? matches(c.win.document, { at, n })[0] : null;
      if (!el || !c) return null;
      const b = { t: base.t ?? [0, 0], s: pair(base.s), r: base.r ?? 0 };
      paint(el, c, b);
      const f0 = measureFrame(el, b.s, totalTurn(el));
      const next = pair(patch.s ?? base.s);
      const center = pivotCenter(f0, { w: (f0.w * next[0]) / b.s[0], h: (f0.h * next[1]) / b.s[1] }, pivot);
      return paintAround(el, c, { t: patch.t ?? b.t, s: next, r: patch.r ?? b.r }, center).t;
    },
    /**
     * The person's changes inside pages whose element the page no longer has: per page clip with changes (or only
     * `clip`), the selectors (`at`) of the lost ones. A change is lost when its page is drawn, no frame drawn so far
     * found its element and the page does not have it now either (an element a page makes only at some moments is
     * not lost once a frame found it).
     */
    lostOverrides({ clip } = {}) {
      return clips()
        .filter((c) => c.kind === 'page' && c.win && c.drawn && c.overrides?.length && (clip == null || c.id === clip))
        .map((c) => ({
          clip: c.id,
          lost: c.overrides.filter((o, i) => o?.at && !c.found?.[i] && !matches(c.win.document, o).length).map((o) => o.at),
        }));
    },
    /** Stop showing what was not kept on a clip (a refused edit, a cancelled drag). */
    release({ clip }) { release(clip); return true; },
    /**
     * Bring a layer to the front of what it overlaps, or send it to the back of it, as Photoshop does — whatever part
     * of the page the other layer is in. A z-index orders only siblings, so for each layer it overlaps the order is
     * set where the two meet: on the two branches under their nearest common ancestor, the branch it is in is given a
     * z-index past the other's (with position: relative where it has none, which moves nothing). Sent back, a common
     * ancestor that is no stacking context is made one (isolation), or a negative z-index would go behind its
     * background. Answers the edits (an override target and its style) and, when there is nothing to do, why:
     * 'alone' (it overlaps nothing), 'already' (it is in front / at the back already), 'blocked' (a branch cannot be
     * given a position without moving what is placed inside it).
     */
    arrange({ handle, to }) {
      const el = nodeOf(handle);
      const c = el && clipOfNode(el);
      if (!el || !c) return null;
      const doc = el.ownerDocument;
      const front = to === 'front';
      const others = [];
      seeingAll(doc, () => {
        for (const o of layersOf(doc)) {
          if (o === el || o.contains(el) || el.contains(o) || invisible(o) || !kindOf(o)) continue;
          const above = drawnOver(o, el);
          if (above != null) others.push({ o, above });
        }
      });
      if (!others.length) return { edits: [], reason: 'alone' };
      const todo = others.filter((x) => (front ? x.above : !x.above));
      if (!todo.length) return { edits: [], reason: 'already' };
      /** per branch to restack: the z-index it needs */
      const want = new Map();
      const isolate = new Set();
      for (const { o } of todo) {
        let lca = el.parentElement;
        while (lca && !lca.contains(o)) lca = lca.parentElement;
        if (!lca) continue;
        const branch = (x) => { let n = x; while (n.parentElement !== lca) n = n.parentElement; return n; };
        const a = branch(el);
        const b = branch(o);
        const z = front ? Math.max(zOf(b) ?? 0, 0) + 1 : Math.min(zOf(b) ?? 0, 0) - 1;
        const prev = want.get(a);
        want.set(a, prev == null ? z : front ? Math.max(prev, z) : Math.min(prev, z));
        if (!front && !stackingContext(lca)) isolate.add(lca);
      }
      const edits = [];
      for (const [a, z] of want) {
        const needs = !placedIn(a);
        if (needs && unsafe(a)) return { edits: [], reason: 'blocked' };
        const now = zOf(a);
        if (now != null && (front ? now >= z : now <= z)) continue;
        edits.push({ target: targetOf(a), style: { zIndex: z, ...(needs ? { position: 'relative' } : {}) } });
      }
      for (const lca of isolate) edits.push({ target: targetOf(lca), style: { isolation: 'isolate' } });
      if (!edits.length) return { edits: [], reason: 'already' };
      const kept = steady(c, edits, () => seeingAll(doc, () => todo.every(({ o }) => drawnOver(front ? el : o, front ? o : el) !== false)));
      return kept ? { edits: kept, reason: null } : { edits: [], reason: 'blocked' };
    },
    /**
     * The layers of the picture clips shown now, the top clip first; a page's as a tree, each level in the order it
     * is drawn, the one on top first (the Layers panel). See rowsOf.
     */
    tree() {
      return shown().map((c) => ({ clip: c.id, kind: c.kind, layers: c.kind === 'page' && c.win?.document?.body ? rowsOf(c) : [] }));
    },
    /**
     * Restack siblings in the order a person put them in (the Layers panel): `order` the handles of the elements
     * under one parent, the top one first, `moved` the one that was moved. Only the moved one is given a z-index when
     * a z-index between its new neighbors puts it there; else all of them are numbered, bottom to top. Answers the
     * edits as arrange does, reason 'blocked' when they would move something, 'already' when the order is the page's.
     */
    restack({ order, moved }) {
      const items = (order ?? []).map(nodeOf);
      const m = nodeOf(moved);
      const parentEl = m?.parentElement;
      const c = m && clipOfNode(m);
      if (!c || !parentEl || items.some((x) => !x || x.parentElement !== parentEl) || !items.includes(m)) return null;
      const want = [...items].reverse();
      const now = siblingOrder(items);
      if (now.every((x, i) => x === want[i])) return { edits: [], reason: 'already' };
      const at = want.indexOf(m);
      const below = want[at - 1] ?? null;
      const above = want[at + 1] ?? null;
      /* where m would be drawn with z-index z (it is given a position where it has none) */
      const keyWith = (z) => [z, z < 0 ? 0 : z === 0 ? 1 : 2];
      const before = (ka, a, kb, b) => (ka[0] - kb[0] || ka[1] - kb[1] || (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)) < 0;
      /* m given a z-index is drawn all at once; its neighbors are drawn as far as what is in them reaches */
      const memo = new Map();
      const lowN = below && reachOf(below, memo);
      const highN = above && reachOf(above, memo);
      const fits = (z) => (!lowN || before(paintKey(lowN), lowN, keyWith(z), m)) && (!highN || before(keyWith(z), m, paintKey(highN), highN));
      const lo = lowN ? paintKey(lowN)[0] : (highN ? paintKey(highN)[0] - 1 : 0);
      const hi = highN ? paintKey(highN)[0] : lo + 1;
      /* the others keep their order among themselves: only m moves, by the first z-index that works (positive first:
         a z-index of 0 ties with the positioned layers, and a negative one needs its parent isolated) */
      const rest = want.filter((x) => x !== m);
      const others = now.filter((x) => x !== m);
      const sole = rest.every((x, i) => x === others[i])
        ? [...new Set([lo + 1, lo, hi, hi - 1, lo - 1, hi + 1])].filter(fits).sort((a, b) => (a <= 0) - (b <= 0) || Math.abs(a) - Math.abs(b))
        : [];
      const editsOf = (plan) => {
        const edits = [];
        for (const [node, z] of plan) {
          const needs = !placedIn(node);
          if (needs && unsafe(node)) return null;
          if (!needs && zOf(node) === z) continue;
          edits.push({ target: targetOf(node), style: { zIndex: z, ...(needs ? { position: 'relative' } : {}) } });
        }
        if (plan.some(([, z]) => z < 0) && !stackingContext(parentEl)) edits.push({ target: targetOf(parentEl), style: { isolation: 'isolate' } });
        /* drawn as wanted: by the model, and where two of them overlap, by what the page's hit tests find */
        return steady(c, edits, () => siblingOrder(items).every((x, i) => x === want[i])
          && seeingAll(parentEl.ownerDocument, () => want.every((lower, i) => want.slice(i + 1).every((upper) => drawnOver(upper, lower) !== false))));
      };
      let kept = null;
      for (const z of sole) if (!kept) kept = editsOf([[m, z]]);
      kept ??= editsOf(want.map((x, i) => [x, i + 1]));
      return kept ? { edits: kept, reason: null } : { edits: [], reason: 'blocked' };
    },
    textStart: startText,
    textFinish({ commit }) { finishText(Boolean(commit)); return true; },
  };

  window.addEventListener('message', async (e) => {
    if (e.origin !== EDITOR || e.source !== parent || e.data?.source !== 'openfilm-studio' || e.data.type !== 'stage') return;
    const { seq, op, ...args } = e.data;
    const fn = Object.hasOwn(ops, op) ? ops[op] : null;
    let result = null;
    try {
      if (window.film) await window.film.ready;
      listenAll();
      /* the line being typed was drawn anew (an undo, the page rewritten): what was typed is kept, the box closes */
      if (editing && !editing.el.isConnected) finishText(true);
      result = fn ? fn(args) ?? null : null;
    } catch (error) {
      post({ type: 'stage', seq, result: null, error: String(error?.message ?? error) });
      return;
    }
    post({ type: 'stage', seq, result });
  });
})();
