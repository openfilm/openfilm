/**
 * Replace a clip: another file in its place, as Premiere's replace edit. The clip keeps its id, its place, its length
 * and its look (box, class, style); the new file plays from its start for that long, at the clip's speed. A file
 * shorter than that makes the clip shorter (`shortMs` says by how much); a still or a page without an end lasts the
 * clip's length. A picture is replaced by a picture (a video, a still, a page), a sound by a sound (a sound file, or a
 * video's own sound).
 */
import type { Clip, PropValue } from '../api.ts';
import { filmSrcIsPage, filmSrcIsStill } from './film.ts';

export type ReplaceFile = { path: string; kind: string; durationMs?: number; endless?: boolean };

export type ReplacePlan =
  | { edits: { prop: string; value: PropValue }[]; shortMs: number }
  | { error: 'kind' | 'same' };

type Family = 'picture' | 'sound';

const isSoundFile = (f: ReplaceFile) => f.kind === 'audio';
const familyOfClip = (clip: Pick<Clip, 'src' | 'sound'>): Family => (clip.sound || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|aif|aiff)$/i.test(clip.src) ? 'sound' : 'picture');

/** Whether `file` can take the place of `clip`. */
export function canReplace(clip: Pick<Clip, 'src' | 'sound'>, file: ReplaceFile): boolean {
  if (file.path === clip.src) return false;
  if (familyOfClip(clip) === 'sound') return isSoundFile(file) || file.kind === 'video';
  return file.kind === 'video' || file.kind === 'image' || file.kind === 'page' || filmSrcIsPage(file.path);
}

/** The edits that put `file` in `clip`'s place, `durMs` long on the film. */
export function replaceClip(clip: Clip, durMs: number, file: ReplaceFile): ReplacePlan {
  if (file.path === clip.src) return { error: 'same' };
  if (!canReplace(clip, file)) return { error: 'kind' };
  const sound = familyOfClip(clip) === 'sound';
  const page = filmSrcIsPage(file.path);
  const endless = filmSrcIsStill(file.path) || file.kind === 'image' || (page && (file.endless || !(file.durationMs! > 0)));
  const edits: { prop: string; value: PropValue }[] = [{ prop: 'src', value: file.path }];
  const secs = (ms: number) => Math.round(ms) / 1000;
  let shortMs = 0;
  if (endless) {
    /* a still has no length of its own: it lasts the clip's; it has no speed, and no sound */
    edits.push({ prop: 'time', value: [0, secs(durMs)] }, { prop: 'speed', value: null }, { prop: 'volume', value: null });
  } else {
    const speed = page ? 1 : clip.speed ?? 1;
    const wanted = durMs * speed;
    const has = file.durationMs && file.durationMs > 0 ? file.durationMs : wanted;
    const plays = Math.min(wanted, has);
    shortMs = Math.max(0, Math.round((wanted - plays) / speed));
    edits.push({ prop: 'time', value: [0, secs(plays)] });
    if (page) edits.push({ prop: 'speed', value: null }, { prop: 'volume', value: null });
  }
  /* a page's tweaks are of that page's elements: another file has none of them. Its fades (the entry without `at`) are
     the clip's own, and stay */
  if (clip.overrides) {
    const own = (clip.overrides as readonly { at?: unknown }[]).filter((o) => o.at === undefined);
    if (own.length !== clip.overrides.length) edits.push({ prop: 'overrides', value: own.length ? own as unknown as PropValue : null });
  }
  if (sound) edits.push({ prop: 'sound', value: isSoundFile(file) ? null : true });
  return { edits, shortMs };
}
