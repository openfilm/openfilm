// @ts-check
/**
 * Driving a tab of the app's browser (browser.mjs) for an agent (browser-door.mjs): reading its page, and the mouse and
 * the keyboard on it, as a person's would be.
 *
 *   · reading       a script of the app's own, run in an isolated world of the page (`WORLD`): it shares the page's
 *                   document but none of its scripts, so a page cannot see it, change what it reads, or call it. It
 *                   gives each element it names a ref (`e12`), kept in that world, for the actions after.
 *   · acting        real input through the DevTools protocol (`webContents.debugger`): a click is a mouse pressed and
 *                   let go at a point, a key a key; never a script of the page's.
 *   · a form sent   a form an action of the agent's sends by POST is held in the page, before anything leaves it, and
 *                   sent only once the person says so (`act` → `held`); a GET form asks nothing the agent could not ask
 *                   by going to its address. One the page sends some other way is held on the network (browser.mjs).
 *
 * Reads no Electron module (the tab's WebContents is given), so the door's tests can stand a page in for it.
 */

/** The isolated world the app's script runs in: none of the page's, nor Electron's own (999). */
export const WORLD = 1077;
/** the longest side of a screenshot, in its pixels (the page's own pixels when it is smaller) */
const SHOT_MOST = 1280;
/** how long the page's script is waited for */
const PAGE_MS = 8000;
const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/**
 * The script of the isolated world: put there once per document, and kept there (`globalThis.__openfilmDrive`). Its
 * functions return plain values only.
 */
export const PAGE = String.raw`(() => {
if (globalThis.__openfilmDrive) return;
const refs = new Map(), ids = new WeakMap();
let next = 1;
const refOf = (el) => { let r = ids.get(el); if (!r) { r = 'e' + next++; ids.set(el, r); refs.set(r, new WeakRef(el)); } return r; };
const byRef = (ref) => { const el = refs.get(String(ref))?.deref(); return el && el.isConnected ? el : null; };
const clean = (s, n = 100) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const INPUT = { button: 'button', submit: 'button', reset: 'button', image: 'button', file: 'button', color: 'button', checkbox: 'checkbox', radio: 'radio', range: 'slider', search: 'searchbox', number: 'spinbutton' };
const TAGS = { button: 'button', textarea: 'textbox', option: 'option', nav: 'navigation', main: 'main', aside: 'complementary', form: 'form', dialog: 'dialog', ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row', th: 'columnheader', td: 'cell', p: 'paragraph', summary: 'button', details: 'group', fieldset: 'group', iframe: 'iframe', video: 'video', audio: 'audio', article: 'article', blockquote: 'blockquote', hr: 'separator', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', header: 'banner', footer: 'contentinfo' };
const ACTS = new Set(['link', 'button', 'checkbox', 'radio', 'slider', 'searchbox', 'textbox', 'spinbutton', 'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'treeitem']);
/* their name is what they say: read whole, and only their elements looked in after */
const SAYS = new Set(['link', 'button', 'heading', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'cell', 'columnheader', 'listitem', 'paragraph', 'treeitem', 'blockquote', 'switch', 'checkbox', 'radio']);
const roleOf = (el) => {
  const own = el.getAttribute('role');
  if (own) return own.trim().split(/\s+/)[0];
  const tag = el.localName;
  if (tag === 'a' || tag === 'area') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'input') return el.type === 'hidden' ? null : INPUT[el.type] ?? 'textbox';
  if (tag === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
  if (tag === 'img') return el.getAttribute('alt') === '' ? null : 'img';
  if (tag === 'section') return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : null;
  if (el.isContentEditable && !el.parentElement?.isContentEditable) return 'textbox';
  return TAGS[tag] ?? null;
};
const acts = (el, role) => ACTS.has(role) || el.hasAttribute('onclick') || (el.hasAttribute('tabindex') && el.tabIndex >= 0);
const nameOf = (el, role) => {
  const label = el.getAttribute('aria-label');
  if (label && clean(label)) return clean(label);
  const by = el.getAttribute('aria-labelledby');
  if (by) { const t = clean(by.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' ')); if (t) return t; }
  if (el.localName === 'img' || (el.localName === 'input' && el.type === 'image')) return clean(el.getAttribute('alt') || el.title);
  if (el.localName === 'input' && ['submit', 'button', 'reset'].includes(el.type)) return clean(el.value || (el.type === 'submit' ? 'Submit' : el.type === 'reset' ? 'Reset' : ''));
  if (el.labels?.length) { const t = clean([...el.labels].map((l) => l.innerText).join(' ')); if (t) return t; }
  if (['textbox', 'searchbox', 'combobox', 'spinbutton', 'listbox'].includes(role)) return clean(el.getAttribute('placeholder') || el.title);
  if (role === 'iframe') return clean(el.title || el.name);
  if (SAYS.has(role) || acts(el, role)) return clean(el.innerText || el.textContent, role === 'paragraph' || role === 'listitem' || role === 'cell' || role === 'blockquote' ? 300 : 100);
  return clean(el.title);
};
const short = (href) => { try { const u = new URL(href, location.href); return clean(u.origin === location.origin ? u.pathname + u.search + u.hash : u.href, 90); } catch { return ''; } };
const extras = (el, role) => {
  const out = [];
  if (role === 'heading') out.push('[level=' + (Number(el.getAttribute('aria-level')) || Number(el.localName.slice(1)) || 2) + ']');
  if (role === 'link' && el.getAttribute('href')) out.push('→ ' + short(el.getAttribute('href')));
  if ('value' in el && ['textbox', 'searchbox', 'spinbutton', 'combobox', 'slider'].includes(role) && el.localName !== 'button') {
    const v = el.localName === 'select' ? [...el.selectedOptions].map((o) => o.label).join(', ') : el.value;
    if (v) out.push('value=' + (el.type === 'password' ? '"••••"' : JSON.stringify(clean(v, 80))));
  } else if (el.isContentEditable && role === 'textbox' && clean(el.innerText)) out.push('value=' + JSON.stringify(clean(el.innerText, 80)));
  if (el.checked === true || el.getAttribute('aria-checked') === 'true') out.push('[checked]');
  if (el.selected === true || el.getAttribute('aria-selected') === 'true') out.push('[selected]');
  if (el.getAttribute('aria-expanded') === 'true' || (el.localName === 'details' && el.open)) out.push('[expanded]');
  if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') out.push('[disabled]');
  if (el.required === true) out.push('[required]');
  if (role === 'iframe') out.push('(what it holds is not read)');
  return out;
};
const describe = (el) => { const role = roleOf(el) ?? el.localName; const name = nameOf(el, role); return role + (name ? ' "' + clean(name, 60) + '"' : ''); };
/* what is drawn of an element's children: its shadow tree's (with what its slots show) where it has one */
const kids = (node) => {
  const from = node.shadowRoot ?? node;
  const out = [];
  for (const child of from.childNodes) {
    if (child.localName === 'slot') out.push(...child.assignedNodes({ flatten: true }));
    else out.push(child);
  }
  return out;
};
const shown = (el) => {
  if (el.getAttribute('aria-hidden') === 'true' || el.localName === 'script' || el.localName === 'style' || el.localName === 'template' || el.localName === 'noscript') return 'none';
  if (el.checkVisibility({ visibilityProperty: true })) return 'yes';
  return getComputedStyle(el).display === 'none' ? 'none' : 'inside';
};
/* the page as an outline: each element that means something on a line of its own, with its ref; text between them */
const outline = ({ filter = 'all', ref = null, most = 30000 } = {}) => {
  const root = ref ? byRef(ref) : document.body ?? document.documentElement;
  if (!root) return { error: ref ? 'gone' : 'empty' };
  const lines = [];
  let size = 0, cut = false;
  const put = (line) => { if (size + line.length > most) { cut = true; return false; } lines.push(line); size += line.length + 1; return true; };
  const walk = (node, depth, inName) => {
    if (cut) return;
    if (node.nodeType === 3) {
      if (filter !== 'all' || inName) return;
      const t = clean(node.textContent, 300);
      if (t && node.parentElement?.checkVisibility({ visibilityProperty: true }) !== false) put('  '.repeat(depth) + '- text ' + JSON.stringify(t));
      return;
    }
    if (node.nodeType !== 1) return;
    const seen = shown(node);
    if (seen === 'none') return;
    const own = seen === 'yes' ? roleOf(node) : null;
    const act = seen === 'yes' && acts(node, own ?? '');
    const role = own ?? (act ? 'clickable' : null);
    let deeper = depth, named = inName;
    if (role && (filter === 'all' || act)) {
      const name = nameOf(node, role);
      if (!put((filter === 'all' ? '  '.repeat(depth) : '') + '- ' + role + (name ? ' ' + JSON.stringify(name) : '') + extras(node, role).map((x) => ' ' + x).join('') + ' [ref=' + refOf(node) + ']')) return;
      if (filter === 'all') deeper = depth + 1;
      if (SAYS.has(role) || act) named = true;
    }
    if (role === 'iframe') return;
    for (const child of kids(node)) walk(child, deeper, named);
  };
  walk(root, 0, false);
  return { text: lines.join('\n'), cut, title: document.title, address: location.href };
};
const find = ({ query, most = 20 }) => {
  const words = clean(query, 200).toLowerCase().split(' ').filter(Boolean);
  /* what can be acted on first, then what holds the words (a paragraph round a link that says them comes after it) */
  const found = [];
  const walk = (node) => {
    if (found.length >= 400 || node.nodeType !== 1) return;
    const seen = shown(node);
    if (seen === 'none') return;
    const own = seen === 'yes' ? roleOf(node) : null;
    const act = seen === 'yes' && acts(node, own ?? '');
    const role = own ?? (act ? 'clickable' : null);
    if (role) {
      const name = nameOf(node, role);
      const hay = (role + ' ' + name + ' ' + (node.getAttribute('placeholder') ?? '') + ' ' + (node.getAttribute('href') ?? '') + ' ' + (node.id ?? '') + ' ' + (node.getAttribute('name') ?? '')).toLowerCase();
      if (words.every((w) => hay.includes(w))) found.push({ act, line: '- ' + role + (name ? ' ' + JSON.stringify(name) : '') + extras(node, role).map((x) => ' ' + x).join('') + ' [ref=' + refOf(node) + ']' });
    }
    for (const child of kids(node)) walk(child);
  };
  walk(document.body ?? document.documentElement);
  const ranked = [...found.filter((f) => f.act), ...found.filter((f) => !f.act)].slice(0, most);
  return { text: ranked.map((f) => f.line).join('\n'), count: ranked.length };
};
const text = ({ most = 30000 } = {}) => {
  const t = String((document.body ?? document.documentElement).innerText ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: t.length > most ? t.slice(0, most) : t, cut: t.length > most, title: document.title, address: location.href };
};
/* where an element is, brought into view first: the middle of its first box, and what lies over it there */
const point = ({ ref }) => {
  const el = byRef(ref);
  if (!el) return { error: 'gone' };
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const boxes = [...el.getClientRects()].filter((b) => b.width >= 1 && b.height >= 1);
  const b = boxes[0] ?? el.getBoundingClientRect();
  if (b.width < 1 || b.height < 1) return { error: 'unseen', what: describe(el) };
  const x = Math.round(Math.min(Math.max(b.left + b.width / 2, 0), innerWidth - 1)), y = Math.round(Math.min(Math.max(b.top + b.height / 2, 0), innerHeight - 1));
  const top = document.elementFromPoint(x, y);
  /* what the point finds is the element, one inside it, or the host of the shadow tree it is in */
  let mine = !top || top === el || el.contains(top);
  for (let n = el; !mine && n; n = n.parentNode ?? n.host) if (n === top) mine = true;
  const over = mine ? null : describe(top);
  return { x, y, what: describe(el), over };
};
const at = ({ x, y }) => { const el = document.elementFromPoint(x, y); return el ? { what: describe(el), ref: refOf(el) } : { what: null }; };
/* what is typed replaces what a field holds */
const selectAll = ({ ref }) => {
  const el = ref ? byRef(ref) : document.activeElement;
  if (!el) return { error: ref ? 'gone' : 'nothing' };
  if (typeof el.select === 'function') { el.select(); return { ok: true }; }
  if (el.isContentEditable) { getSelection()?.selectAllChildren(el); return { ok: true }; }
  return { error: 'not a field' };
};
const focused = () => { const el = document.activeElement; return el && el !== document.body ? describe(el) : null; };
const view = () => ({ width: innerWidth, height: innerHeight, title: document.title, address: location.href });

/* ── a form an action of the agent's sends: held here until the person says (only while the agent acts: until) ── */
let until = 0, approved = null, held = null;
addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (approved === form) { approved = null; return; }
  if (Date.now() > until) return;
  const submitter = event.submitter ?? null;
  const method = String(submitter?.getAttribute('formmethod') || form.getAttribute('method') || 'get').toLowerCase();
  if (method !== 'post') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  held = { form, submitter };
}, true);
const arm = ({ ms }) => { until = Date.now() + ms; held = null; return true; };
const disarm = () => { until = 0; return true; };
const heldForm = () => {
  if (!held) return null;
  const { form, submitter } = held;
  const fields = [...form.elements].filter((e) => e.name && !['submit', 'button', 'reset', 'image', 'hidden'].includes(e.type) && e.localName !== 'fieldset' && e.localName !== 'button' && e.localName !== 'output')
    .slice(0, 30).map((e) => ({ name: clean(e.name, 60), value: e.type === 'password' ? (e.value ? '••••' : '') : e.type === 'checkbox' || e.type === 'radio' ? (e.checked ? 'on' : '') : e.type === 'file' ? [...(e.files ?? [])].map((f) => f.name).join(', ') : clean(e.value, 80) }));
  /* a button's own formaction, where it has one (without, its formAction is the page's address, not the form's) */
  return { action: String(submitter?.hasAttribute('formaction') ? submitter.formAction : form.action || location.href), button: submitter ? describe(submitter) : null, fields };
};
const send = () => {
  if (!held) return false;
  const { form, submitter } = held;
  held = null;
  if (!form.isConnected) return false;
  approved = form;
  if (submitter && submitter.form === form) form.requestSubmit(submitter); else form.requestSubmit();
  return true;
};
const drop = () => { held = null; return true; };
globalThis.__openfilmDrive = { outline, find, text, point, at, selectAll, focused, view, arm, disarm, heldForm, send, drop };
})()`;

/** Keys by the names an agent writes them: what the protocol needs of each. */
const KEYS = /** @type {Record<string, { key: string, code: string, keyCode: number, text?: string }>} */ ({
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' }, return: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 }, escape: { key: 'Escape', code: 'Escape', keyCode: 27 }, esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 }, delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }, arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }, arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }, down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }, right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 }, end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 }, pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, { key: `F${i + 1}`, code: `F${i + 1}`, keyCode: 112 + i }])),
});
const MODIFIERS = /** @type {Record<string, number>} */ ({ alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, super: 4, shift: 8 });
/** macOS's editing commands, which a key with ⌘ reaches only through the menu: given to the protocol by name */
const MAC_COMMANDS = /** @type {Record<string, string>} */ ({ a: 'selectAll', c: 'copy', x: 'cut', z: 'undo', 'shift+z': 'redo' });

/**
 * A key as an agent names it (`Enter`, `ArrowDown`, `cmd+a`, `ctrl+shift+Tab`, `a`) → what is pressed, or an error.
 * Pasting is the person's: it would give the page what they copied.
 * @param {string} combo @param {{ mac?: boolean }} [o]
 * @returns {{ error: string } | { key: string, code: string, keyCode: number, text?: string, modifiers: number, commands: string[] }}
 */
export function parseKey(combo, { mac = process.platform === 'darwin' } = {}) {
  const parts = String(combo ?? '').trim().split(/\+(?!$)/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { error: 'No key named.' };
  const last = /** @type {string} */ (parts.pop());
  let modifiers = 0;
  for (const m of parts) {
    const bit = MODIFIERS[m.toLowerCase()];
    if (!bit) return { error: `"${m}" is no modifier (cmd, ctrl, alt, shift).` };
    modifiers |= bit;
  }
  const named = KEYS[last.toLowerCase()];
  let def;
  if (named) def = { ...named };
  else if ([...last].length === 1) {
    const ch = last;
    const upper = ch.toUpperCase();
    const code = /[a-z]/i.test(ch) ? `Key${upper}` : /\d/.test(ch) ? `Digit${ch}` : '';
    def = { key: modifiers & 8 && /[a-z]/i.test(ch) ? upper : ch, code, keyCode: /[a-z0-9]/i.test(ch) ? upper.charCodeAt(0) : 0, text: modifiers & 8 && /[a-z]/i.test(ch) ? upper : ch };
  } else return { error: `"${last}" is no key this knows (Enter, Tab, Escape, Backspace, Delete, arrows, Home, End, PageUp, PageDown, Space, F1–F12, or one character).` };
  const lower = last.toLowerCase();
  if ((modifiers & 6) && lower === 'v') return { error: 'Pasting is the person’s to do (it would give the page what they copied). Type the text instead.' };
  /* a key with ⌘ or Ctrl types nothing */
  if (modifiers & 6) delete def.text;
  const commands = mac && (modifiers & 4) ? [MAC_COMMANDS[`${modifiers & 8 ? 'shift+' : ''}${lower}`]].filter(Boolean) : [];
  return { ...def, modifiers, commands };
}

/**
 * The driver of one tab's page. `contents`: its WebContents (or what stands in for it in a test).
 * @param {any} contents
 */
export function driverOf(contents) {
  /** @type {Promise<void> | null} */
  let attaching = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let idle = null;
  const dbg = contents.debugger;

  /** The DevTools protocol on the page, attached the first time and let go once the agent leaves it a while. */
  async function cdp(/** @type {string} */ method, /** @type {any} */ params = {}) {
    if (!dbg.isAttached()) {
      attaching ??= (async () => {
        try { dbg.attach('1.3'); } catch (error) { if (!dbg.isAttached()) throw error; }
        /* the page behaves as one in front, whatever has the keyboard (the person may be writing in the chat) */
        await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
      })().finally(() => { attaching = null; });
      await attaching;
    }
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => { try { if (dbg.isAttached()) dbg.detach(); } catch { /* gone */ } }, 120_000);
    idle.unref?.();
    return dbg.sendCommand(method, params);
  }

  /** One of the isolated world's functions, with its arguments. */
  async function page(/** @type {string} */ fn, /** @type {any} */ args = {}) {
    if (contents.isDestroyed()) throw new Error('The tab is gone.');
    /* a page that goes somewhere else meanwhile may never answer */
    let timer;
    const late = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('The page did not answer (it may be loading). Wait for it, then try again.')), PAGE_MS); });
    try {
      return await Promise.race([contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `${PAGE};globalThis.__openfilmDrive.${fn}(${JSON.stringify(args)})` }], false), late]);
    } finally { clearTimeout(timer); }
  }

  const mouse = (/** @type {any} */ e) => cdp('Input.dispatchMouseEvent', e);

  const api = {
    page,
    /** The page as an outline with refs. */
    outline: (/** @type {{ filter?: string, ref?: string | null, most?: number }} */ o) => page('outline', o),
    find: (/** @type {{ query: string, most?: number }} */ o) => page('find', o),
    text: (/** @type {{ most?: number }} */ o) => page('text', o),
    point: (/** @type {string} */ ref) => page('point', { ref }),
    at: (/** @type {number} */ x, /** @type {number} */ y) => page('at', { x, y }),
    view: () => page('view'),
    focused: () => page('focused'),
    selectAll: (/** @type {string | null} */ ref) => page('selectAll', { ref }),

    /**
     * An action of the agent's: input to the page, with a form it sends by POST held (`held`: what it would send, for
     * the person to see). `run` does the input.
     * @param {() => Promise<void>} run
     */
    async act(run) {
      await page('arm', { ms: 2500 });
      try { await run(); } finally { await sleep(150); }
      const held = await page('heldForm').catch(() => null);
      await page('disarm').catch(() => {});
      return { held };
    },
    /** The form held, sent as it would have been (the person said yes), or let go (no). */
    send: () => page('send'),
    drop: () => page('drop'),

    async click(/** @type {number} */ x, /** @type {number} */ y, { button = 'left', count = 1, modifiers = 0 } = {}) {
      await mouse({ type: 'mouseMoved', x, y, modifiers });
      for (let n = 1; n <= count; n++) {
        await mouse({ type: 'mousePressed', x, y, button, clickCount: n, buttons: button === 'left' ? 1 : button === 'right' ? 2 : 4, modifiers });
        await mouse({ type: 'mouseReleased', x, y, button, clickCount: n, buttons: 0, modifiers });
      }
    },
    hover: (/** @type {number} */ x, /** @type {number} */ y) => mouse({ type: 'mouseMoved', x, y }),
    wheel: (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ deltaX, /** @type {number} */ deltaY) => mouse({ type: 'mouseWheel', x, y, deltaX, deltaY }),
    insertText: (/** @type {string} */ text) => cdp('Input.insertText', { text }),
    /** A key pressed and let go (parseKey's). */
    async key(/** @type {Exclude<ReturnType<typeof parseKey>, { error: string }>} */ k) {
      const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: k.modifiers };
      await cdp('Input.dispatchKeyEvent', { ...base, type: k.text ? 'keyDown' : 'rawKeyDown', ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}), ...(k.commands.length ? { commands: k.commands } : {}) });
      await cdp('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
    },

    /**
     * The page as it is drawn, at its own size in CSS pixels (at most SHOT_MOST on its longest side): coordinates in
     * it are where `click` presses, times `scale`. A tab out of sight is drawn for it all the same.
     * @param {{ hidden?: boolean }} [o]
     */
    async screenshot({ hidden = false } = {}) {
      const size = await page('view');
      const image = await contents.capturePage(undefined, { stayHidden: hidden, stayAwake: true });
      if (!image || image.isEmpty()) throw new Error('The page has not been drawn yet. Wait for it to load, then try again.');
      const width = Math.max(1, Number(size?.width) || image.getSize().width);
      const height = Math.max(1, Number(size?.height) || image.getSize().height);
      const fit = Math.min(1, SHOT_MOST / Math.max(width, height));
      const w = Math.max(1, Math.round(width * fit)), h = Math.max(1, Math.round(height * fit));
      const out = image.resize({ width: w, height: h, quality: 'good' });
      return { data: out.toJPEG(82).toString('base64'), mimeType: 'image/jpeg', width: w, height: h, scale: 1 / fit };
    },

    /** Done with the page: the protocol let go. */
    release() {
      if (idle) clearTimeout(idle);
      try { if (!contents.isDestroyed() && dbg.isAttached()) dbg.detach(); } catch { /* gone */ }
    },
  };
  return api;
}
