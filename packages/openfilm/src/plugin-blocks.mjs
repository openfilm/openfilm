/**
 * The blocks a workbench is laid out in (a plugin's openfilm.json `blocks`), read the same in Studio's server and its
 * page. A workbench drawn among the page's panels (the edit's viewer, layers, inspector and timeline, the canvas's
 * board) declares each block it draws; Studio's page arranges them with its own (the chat, the library) and with
 * blocks of other workbenches' the plugin names, and the plugin draws each into the place Studio gives it.
 *
 *   "blocks": [
 *     { "id": "scopes", "title": { "en": "Scopes" }, "edge": "left", "size": 320 },
 *     { "id": "wheels", "title": { "en": "Wheels" }, "edge": "center" },
 *     "edit:viewer", "edit:timeline"
 *   ]
 *
 * A block: `id`; `title` by language; `edge`, where it is docked: `center` (the main block, one), `left`, `right`, `top`
 * or `bottom` (beside it, above or below it); `size`, its width beside the main block or its height above or below it
 * as it first opens (none: as the plugin fits it); `open: false` when it first opens hidden; `min`, the smallest it is
 * drawn where the panels float (`[width, height]`); `range`, the sizes a person may give it (`[smallest, largest]`).
 * `"owner:id"` is a block another workbench draws (its own declared there). `"blocks": "<workbench>"` instead: this
 * workbench is laid out in that one's arrangement (Motion, a view of the edit, is laid out as the edit is).
 */

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const BORROWED = /^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$/;
const EDGES = ['center', 'left', 'right', 'top', 'bottom'];

/** The words of a field by language (`en`, `zh-CN`…); anything else is none. */
const byLanguage = (/** @type {unknown} */ v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).filter(([k, w]) => /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(k) && typeof w === 'string' && w.trim()).map(([k, w]) => [k, String(w).trim().slice(0, 80)])) : {});

const pair = (/** @type {unknown} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi)
  ? /** @type {[number, number]} */ ([Math.round(v[0]), Math.round(v[1])]) : null);

/**
 * @typedef {{ id: string, title?: Record<string, string>, edge: 'center' | 'left' | 'right' | 'top' | 'bottom',
 *   size?: number, open?: false, min?: [number, number], range?: [number, number] }} BlockDecl
 */

/**
 * A manifest's `blocks`, as Studio takes them: another workbench's name (laid out in its arrangement), or the blocks
 * declared, each checked (`"owner:id"` for another workbench's); undefined when it says none that can be used.
 * @param {unknown} raw @returns {string | (BlockDecl | string)[] | undefined}
 */
export function readBlocks(raw) {
  if (typeof raw === 'string') return NAME.test(raw) ? raw : undefined;
  if (!Array.isArray(raw)) return undefined;
  /** @type {(BlockDecl | string)[]} */
  const out = [];
  const seen = new Set();
  let center = false;
  for (const entry of raw.slice(0, 12)) {
    if (typeof entry === 'string') {
      if (BORROWED.test(entry) && !seen.has(entry)) { seen.add(entry); out.push(entry); }
      continue;
    }
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !NAME.test(entry.id) || seen.has(entry.id)) continue;
    const edge = EDGES.includes(entry.edge) && !(entry.edge === 'center' && center) ? entry.edge : center ? 'right' : 'center';
    if (edge === 'center') center = true;
    seen.add(entry.id);
    const title = byLanguage(entry.title);
    const min = pair(entry.min, 40, 2000);
    const range = pair(entry.range, 40, 4000);
    out.push({
      id: entry.id, edge, ...(Object.keys(title).length ? { title } : {}),
      ...(typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 40 && entry.size <= 4000 ? { size: Math.round(entry.size) } : {}),
      ...(entry.open === false ? { open: false } : {}), ...(min ? { min } : {}), ...(range && range[0] <= range[1] ? { range } : {}),
    });
  }
  return out.length ? out : undefined;
}
