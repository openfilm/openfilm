// @ts-check
/**
 * A clip's grade as film.html says it: its style's `--of-lut` (SPEC.md), the color transform files it goes through in
 * order. OpenFilm's own grades put them in three parts, each a file of the project:
 *
 *   input     `looks/in-<footage>.ctf`: the footage into the working space, ACEScct (a camera's log, HDR, or the
 *             exact inverse of the output for ordinary video), one for each kind of footage
 *   layers    any other files: what the grade does, a layer each, in ACEScct; a layer clips share grades them together
 *   output    `looks/out-<display>.ctf`: ACEScct to the screen, the same for the whole film
 *
 *   after     anything after the output: a LUT made for what the screen shows (most `.cube` looks are), kept last;
 *             the library's filters (`looks/filter-<name>-<strength>.ctf`, adjust.mjs) are said to be by their name,
 *             so ordinary video with nothing else graded names its filter alone
 *
 * The part a file plays is said by its name, so a person, an agent and the workbench all read a clip's grade the same
 * way, from film.html alone. A list that is not in parts (a LUT someone added) is kept as it is: a layer goes in
 * before an output, after an input, or at the end. Nothing here reads files; it works on the style's text.
 */
import { declarations } from '../film-doc.mjs';

/** Where OpenFilm keeps a project's color transform files. */
export const LOOKS = 'looks';
/** The output every film's clips end with unless it says another, and the input of ordinary (SDR) footage. */
export const OUTPUT = `${LOOKS}/out-rec709.ctf`;
export const SDR_INPUT = `${LOOKS}/in-rec709.ctf`;

/** A file's part in a grade, by its name: `screen` is made for what the screen shows. @param {string} url @returns {'input' | 'output' | 'layer' | 'screen'} */
export function roleOf(url) {
  const name = url.split(/[?#]/)[0].split('/').pop() ?? '';
  return /^in-[\w.-]*\.ctf$/i.test(name) ? 'input' : /^out-[\w.-]*\.ctf$/i.test(name) ? 'output' : /^filter-[\w.-]*\.ctf$/i.test(name) ? 'screen' : 'layer';
}

/** The files a style grades by, in order, as written (`url(…)`); none without `--of-lut`. @param {string | null | undefined} style */
export function chainOf(style) {
  const value = declarations(style ?? '').findLast(([prop]) => prop === '--of-lut')?.[1] ?? '';
  return [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi)].map((m) => (m[1] ?? m[2] ?? m[3]).trim()).filter(Boolean);
}

/**
 * `style` grading by `chain` (none: `--of-lut` taken out), its other declarations as they were. Null when nothing is
 * left of it. @param {string | null | undefined} style @param {readonly string[]} chain
 */
export function withChain(style, chain) {
  const kept = declarations(style ?? '').filter(([p]) => p !== '--of-lut');
  if (chain.length) kept.push(['--of-lut', chain.map((u) => `url(${u})`).join(' ')]);
  const text = kept.map(([p, v]) => (v ? `${p}: ${v}` : p)).join('; ');
  return text || null;
}

/**
 * A chain's parts: its input, its layers in order, its output (each null when it has none), and what comes after the
 * output. @param {readonly string[]} chain
 */
export function partsOf(chain) {
  const input = chain[0] && roleOf(chain[0]) === 'input' ? chain[0] : null;
  const from = input ? 1 : 0;
  const out = chain.findLastIndex((u, i) => i >= from && roleOf(u) === 'output');
  if (out >= 0) return { input, layers: chain.slice(from, out), output: chain[out], after: chain.slice(out + 1) };
  /* no output: what is made for the screen at its end is after it all the same */
  let end = chain.length;
  while (end > from && roleOf(chain[end - 1]) === 'screen') end--;
  return { input, layers: chain.slice(from, end), output: null, after: chain.slice(end) };
}

/**
 * A chain with `layer` in it, the parts it needs around it: an input (`input`, or the chain's own, else SDR_INPUT)
 * and an output (the chain's own, else OUTPUT). A layer it has already stays where it is.
 * @param {readonly string[]} chain @param {string} layer @param {{ input?: string }} [how]
 */
export function withLayer(chain, layer, { input } = {}) {
  const p = partsOf(chain);
  const layers = p.layers.includes(layer) ? [...p.layers] : [...p.layers, layer];
  return [input ?? p.input ?? SDR_INPUT, ...layers, p.output ?? OUTPUT, ...p.after];
}

/** A chain with its input changed to `input`: the rest as it was (OUTPUT when it has none). @param {readonly string[]} chain @param {string} input */
export function withInput(chain, input) {
  const p = partsOf(chain);
  return [input, ...p.layers, p.output ?? OUTPUT, ...p.after];
}

/**
 * A chain without `layer`; with nothing left between ordinary footage's input and the output, neither (the clip plays
 * as it is, exactly, through what it has for the screen). @param {readonly string[]} chain @param {string} layer
 */
export function withoutLayer(chain, layer) {
  const p = partsOf(chain);
  const layers = p.layers.filter((l) => l !== layer), after = p.after.filter((l) => l !== layer);
  if (!layers.length && (!p.input || p.input === SDR_INPUT)) return after;
  return [...(p.input ? [p.input] : []), ...layers, ...(p.output ? [p.output] : []), ...after];
}

/**
 * A chain with `screen` (a file made for the screen) in place of those of its own for the screen that `mine` says are
 * (a library filter's), last; null takes those out. Ordinary video with nothing else graded names it alone.
 * @param {readonly string[]} chain @param {string | null} screen @param {(url: string) => boolean} mine
 */
export function withScreen(chain, screen, mine) {
  const p = partsOf(chain);
  const after = [...p.after.filter((u) => !mine(u)), ...(screen ? [screen] : [])];
  if (!p.layers.length && (!p.input || p.input === SDR_INPUT)) return after;
  return [...(p.input ? [p.input] : []), ...p.layers, p.output ?? OUTPUT, ...after];
}

/** The layer a clip's own changes go in: `looks/shot-<clip id>.ctf` (a file name from its id, as any system allows; never
    taken for an input or an output). @param {string} id */
export const ownLayer = (id) => `${LOOKS}/shot-${id.replace(/[\\/:*?"<>|#%\s]+/g, '-')}.ctf`;
