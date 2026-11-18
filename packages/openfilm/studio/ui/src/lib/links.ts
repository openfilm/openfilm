/**
 * Links: a thing of the project named by a path in its folder and, after `#`, what in that file. The same link whoever
 * writes it (an agent in its reply, a command's output, a plugin sending the person somewhere, the app's chat):
 *
 *   film.html#<clip-id>          a clip of the film, by its id (`film.html#0.2`, a clip by its place, as the edit
 *                                writes a clip without one)
 *   film.html#t=12.5             a moment of the film, in seconds
 *   film.html#t=3,6              a stretch of it
 *   film.html#t=12.5&xywh=640,200,320,180
 *                                a part of the picture then: x, y, width, height in the stage's pixels
 *   assets/a.mp4                 a file of the project (`#t=3,6` a stretch of it, `#xywh=…` a part of its picture)
 *   .film/canvas.json#<node-id>  a thing in a plugin's own file, by its id
 *
 * After `#`, only what the web already has: an element's id (HTML), and a time and a part of the picture as W3C Media
 * Fragments write them (`t=`, `xywh=`, joined by `&`), the `#t=` film.html's own sources are cut with. Agents know
 * them without being taught a form of ours, and every plugin points at its things the same way.
 *
 * The shell opens one (shell/ProjectFrame): the workbench that claims its file (openfilm/studio `provide`'s `opens`)
 * is shown and told to show it; a file no workbench claims is shown in the library. The app's commands that name a
 * thing (lib/host.ts StudioCommand) are opened as the link they stand for (`linkOfCommand`). Pure, so `node --test`
 * runs it (links.test.ts).
 */
import type { StudioCommand } from './host';

/** A link read: the file's path in the project, and what in it (null: the file itself). */
export interface Link { path: string; fragment: string | null }

/** The film's own file: the edit's. */
export const FILM = 'film.html';

const decode = (text: string) => { try { return decodeURIComponent(text); } catch { return text; } };

/**
 * A link read, or null when it names nothing in the project: an address (`https:`, `mailto:`), a path from the
 * disk's root, one out of the project (`..`), or nothing.
 */
export function parseLink(link: string): Link | null {
  const text = link.trim().replace(/^\.\//, '');
  if (!text || /[\u0000-\u001f\u007f]/.test(text) || /^(?:[a-z][a-z0-9+.-]*:|[\\/#?])/i.test(text)) return null;
  const hash = text.indexOf('#');
  const path = decode(hash < 0 ? text : text.slice(0, hash));
  if (!path || /^[\\/]/.test(path) || path.split(/[\\/]/).some((part) => part === '..')) return null;
  const fragment = hash < 0 ? '' : decode(text.slice(hash + 1));
  return { path, fragment: fragment || null };
}

/** A path in a link: `#` and `%` written so that it reads back as the same path. */
const pathInLink = (path: string) => path.replace(/%/g, '%25').replace(/#/g, '%23');

/** A number of seconds as a link writes it: at most six decimals, no exponent. */
const seconds = (t: number) => String(Number(t.toFixed(6)));

const SECONDS = '(\\d+(?:\\.\\d+)?)';
const TIME = new RegExp(`^t=${SECONDS}(?:,${SECONDS})?$`);

/** A fragment's media-fragment parts (`t=…&xywh=…`), by name; an id is none. */
function partsOf(fragment: string | null): Map<string, string> {
  const parts = new Map<string, string>();
  for (const part of (fragment ?? '').split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) parts.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return parts;
}

/** What `#t=…` names (a media fragment): a moment, or a stretch that ends after it starts; null when it is not one. */
export function timeOf(fragment: string | null): { at: number } | { start: number; end: number } | null {
  const t = partsOf(fragment).get('t');
  const m = t != null ? TIME.exec(`t=${t}`) : null;
  if (!m) return null;
  const start = Number(m[1]);
  if (m[2] == null) return { at: start };
  const end = Number(m[2]);
  return end > start ? { start, end } : null;
}

const XYWH = new RegExp(`^(?:pixel:)?${SECONDS},${SECONDS},${SECONDS},${SECONDS}$`);

/** What `#xywh=x,y,w,h` names (a media fragment, in pixels): a part of the picture, or null when it is not one. */
export function boxOf(fragment: string | null): { x: number; y: number; w: number; h: number } | null {
  const m = XYWH.exec(partsOf(fragment).get('xywh') ?? '');
  if (!m) return null;
  const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * Whether a path of the project is one a pattern names. A pattern is a path in the project: `*` stands for any
 * characters in a name, `**` for any in several folders (`assets/**` is all that is under assets), `?` for one; it is
 * matched against the whole path (`**` + `/*.cube` for a .cube in any folder).
 */
export function matchesPattern(pattern: string, path: string): boolean {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      /* `**` and a slash after it: no folder or any; at the end: anything */
      if (pattern[i + 2] === '/') { source += '(?:.*/)?'; i += 2; } else { source += '.*'; i += 1; }
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`).test(path);
}

/** How closely a pattern names a path: the path itself first, then the pattern with the most that is not a wildcard. */
const closeness = (pattern: string, path: string) => (pattern === path ? Infinity : pattern.replace(/\*|\?/g, '').length);

/**
 * The workbench that shows `path`: among those on, the one whose pattern names it most closely (the first of them on
 * a tie); null when none does.
 */
export function claimantOf(path: string, claims: Iterable<readonly [string, readonly string[]]>, on: readonly string[]): string | null {
  let best: { name: string; score: number } | null = null;
  for (const [name, patterns] of claims) {
    if (!on.includes(name)) continue;
    for (const pattern of patterns) {
      if (!matchesPattern(pattern, path)) continue;
      const score = closeness(pattern, path);
      if (!best || score > best.score) best = { name, score };
    }
  }
  return best?.name ?? null;
}

/** Where a link takes the person: a workbench, told the link; or a file of the project, shown in the library. */
export type LinkRoute = { workbench: string; link: string } | { file: string };

/** Where `link` goes, with the workbenches' claims (`claims`) and those on (`on`); null: it names nothing of the project. */
export function routeLink(link: string, claims: Iterable<readonly [string, readonly string[]]>, on: readonly string[]): LinkRoute | null {
  const read = parseLink(link);
  if (!read) return null;
  const workbench = claimantOf(read.path, claims, on);
  if (workbench) return { workbench, link: link.trim().replace(/^\.\//, '') };
  return { file: read.path };
}

/**
 * What the edit does for a link to the film (the app's command it stands for): a moment sought, a stretch lit with the
 * playhead at its start, a clip selected (by its id, else by its place) and the playhead at its start. Null for the
 * film itself, or `#t=` that is not a time.
 */
export function filmCommandOf(fragment: string | null): StudioCommand | null {
  if (!fragment) return null;
  if (/(?:^|&)(?:t|xywh)=/.test(fragment)) {
    const time = timeOf(fragment);
    if (!time) return null;
    const box = boxOf(fragment);
    if (box) return { type: 'show-box', time: 'at' in time ? time.at : time.start, box };
    return 'at' in time ? { type: 'seek', time: time.at } : { type: 'show-range', start: time.start, end: time.end };
  }
  return { type: 'select-clip', id: fragment, loc: `${FILM}#${fragment}`, seek: true };
}

/** The canvas's board files: its own, and the others a project keeps. */
export const CANVAS_FILES = ['.film/canvas.json', '.film/canvases/*.json'] as const;

/**
 * The link an app's command stands for, when it names a thing a link names: a clip selected with the playhead taken to
 * it, a moment, a stretch, a part of the picture at a moment, a canvas's node, a file. Null for the others (what a
 * chat points at, a track, a subtitle line, a clip selected where the playhead is), which are the edit's as they were.
 */
export function linkOfCommand(command: StudioCommand): string | null {
  switch (command.type) {
    case 'select-clip':
      if (!command.seek) return null;
      if (command.id) return `${FILM}#${encodeURIComponent(command.id)}`;
      return command.loc?.startsWith(`${FILM}#`) ? command.loc : null;
    case 'seek':
      return Number.isFinite(command.time) ? `${FILM}#t=${seconds(Math.max(0, command.time))}` : null;
    case 'show-range': {
      if (!Number.isFinite(command.start) || !Number.isFinite(command.end)) return null;
      const start = Math.max(0, Math.min(command.start, command.end)), end = Math.max(0, command.start, command.end);
      return end > start ? `${FILM}#t=${seconds(start)},${seconds(end)}` : `${FILM}#t=${seconds(start)}`;
    }
    case 'show-box': {
      const { time, box } = command;
      if (!Number.isFinite(time) || !box || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || !(box.w > 0 && box.h > 0)) return null;
      return `${FILM}#t=${seconds(Math.max(0, time))}&xywh=${[box.x, box.y, box.w, box.h].map((v) => seconds(Math.round(v * 100) / 100)).join(',')}`;
    }
    case 'show-node':
      return typeof command.id === 'string' && command.id ? `${CANVAS_FILES[0]}#${encodeURIComponent(command.id)}` : null;
    case 'show-file':
      return typeof command.path === 'string' && command.path ? pathInLink(command.path) : null;
    default:
      return null;
  }
}
