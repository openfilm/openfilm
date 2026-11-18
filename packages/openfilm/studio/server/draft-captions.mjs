// @ts-check
import { readFileSync } from 'node:fs';
import { cssRules, readVtt } from '../../src/captions.mjs';
import { inProject } from './files.mjs';

/** Static caption pictures change only when a cue enters or leaves. All boundaries are on the same frame grid
 * used by the player (start <= t < end). Anything time-dependent keeps the ordinary every-frame renderer.
 * @param {string} root @param {import('../../src/film-doc.mjs').FilmDoc} doc
 * @param {{markup:string,fps:number,frames:number}} options */
export function staticCaptionFrames(root, doc, { markup, fps, frames }) {
  if (!Number.isInteger(frames) || frames <= 0 || /<script\b|<link\b[^>]*\brel\s*=\s*["']?stylesheet/i.test(markup)) return null;
  const dynamic = /animation|transition|@|\\|--(?:in|out|loop)(?:-[\w-]+)?\s*:|url\s*\(/i;
  for (const m of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    if (dynamic.test(m[1]) || cssRules(m[1]).some((r) => /[\[(:@]|\b(?:past|future)\b/i.test(r.prelude))) return null;
  }
  const boundaries = new Set([0, frames - 1]);
  let tracks = 0;
  try {
    for (const track of doc.tracks) {
      if (!track.captions || track.hidden) continue;
      tracks++;
      const path = inProject(root, track.captions.src.replace(/^\/+/, ''));
      if (!path) return null;
      const vtt = readVtt(readFileSync(path, 'utf8'));
      // Timestamp spans toggle past/future classes, but have no visible change with global static ::cue rules.
      // Subselectors and motion variables retain the full renderer, including word highlighting and library motions.
      if (vtt.regions.some((r) => /\bscroll\s*:/i.test(r))
        || vtt.styles.some((s) => dynamic.test(s) || cssRules(s).some((r) => r.prelude.trim() !== '::cue'))) return null;
      for (const cue of vtt.cues) for (const seconds of [cue.start, cue.end]) {
        const frame = Math.ceil(seconds * fps - 1e-7);
        if (frame >= 0 && frame < frames) boundaries.add(frame);
      }
    }
  } catch { return null; }
  return tracks ? [...boundaries].sort((a, b) => a - b) : null;
}
