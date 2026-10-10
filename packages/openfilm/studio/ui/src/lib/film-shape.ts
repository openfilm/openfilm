/**
 * film.html as the timeline reads it (`TimelineFilm`, see timeline-layout's layoutTracks): every clip placed in
 * film milliseconds, with its location in the file (`film.html#<track>.<clip>`), its id, how far it can be trimmed,
 * and its track's flags. The preview reports what film.html can't say on its own: each clip's span on the film and
 * its source's own length and picture size (`spans`); media facts (whether a video has sound) come from probing.
 */
import type { ClipLook } from './clip-look.ts';
import { fileStem, filmAudioRoleOf, filmClipKind, filmDocLoc, filmSrcIsStill, filmTrackKind, type FilmDoc, type FilmTrack } from './film.ts';
import type { TimelineFilm, TimelineBlock } from './timeline-layout.ts';

/** Where the preview says a clip is: seconds on the film, and its source's own length (none for a still) and size. */
export type ClipSpan = {
  id: string; src: string; at: number; end: number; native: number | null; w?: number; h?: number;
  /** a picture's look, as the film's CSS makes it (see clip-look) */
  look?: ClipLook;
};

/** What probing a media file told: whether a video carries sound, and the file's own length (s). */
export type MediaFacts = ReadonlyMap<string, { audio?: boolean; duration?: number }>;

type Track = TimelineFilm['scenes'][number]['track'];

const ms = (sec: number) => Math.round(sec * 1000);

/** The source seconds a clip starts at and plays to, and its speed (film.html `time`, `speed`). */
function trimOf(clip: Record<string, unknown>) {
  const time = Array.isArray(clip.time) ? (clip.time as number[]) : [];
  const speed = typeof clip.speed === 'number' && clip.speed > 0 ? clip.speed : 1;
  return { from: time[0] ?? 0, speed };
}

/** How long a clip whose length the preview never told (the preview failed) is drawn, when film.html says none. */
const GUESS_SEC = 5;

/**
 * Where film.html alone puts a clip, for when the preview has not placed it: its `at`, and its `time`'s length at its
 * speed; without an end in `time`, up to the end of its file as probing found it (`native`, s), else GUESS_SEC. The
 * clip can then still be found, selected and removed.
 */
function guessedSpan(clip: Record<string, unknown> & { id?: string; src: string }, native?: number): ClipSpan {
  const at = typeof clip.at === 'number' && clip.at >= 0 ? clip.at : 0;
  const time = Array.isArray(clip.time) ? (clip.time as number[]) : [];
  const speed = typeof clip.speed === 'number' && clip.speed > 0 ? clip.speed : 1;
  const from = time[0] ?? 0;
  const length = time.length === 2 && time[1] > from ? (time[1] - from) / speed
    : time.length < 2 && native != null && native > from ? (native - from) / speed : GUESS_SEC;
  return { id: String(clip.id ?? ''), src: clip.src, at, end: at + length, native: native ?? null };
}

export function filmShape(
  doc: FilmDoc,
  spans: readonly ClipSpan[],
  media: MediaFacts = new Map(),
  /** the preview could not draw the film: clips it never placed are drawn where film.html alone puts them */
  guess = false,
): TimelineFilm {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const scenes: TimelineFilm['scenes'][number][] = [];
  const videos: TimelineFilm['videos'][number][] = [];
  const sounds: TimelineFilm['sounds'][number][] = [];

  doc.tracks.forEach((track: FilmTrack, ti: number) => {
    const ref: NonNullable<Track> = {
      index: ti,
      name: filmTrackKind(track),
      kind: filmTrackKind(track),
      ...(track.hidden ? { hidden: true } : {}),
      ...(track.muted ? { muted: true } : {}),
      ...(track.locked ? { locked: true } : {}),
    };
    track.clips.forEach((clip, ci) => {
      const known = clip.id ? byId.get(clip.id) : undefined;
      /* the file's own length as probing found it (a still has none) */
      const probed = filmSrcIsStill(clip.src) ? undefined : media.get(clip.src)?.duration;
      const placed = clip.at == null || typeof clip.at === 'number';
      /* not drawn by the preview yet (an undo just put it back, a split's second half, a drop, a page still loading):
         where film.html says it is when its `time` gives its length, or its file's does (a clip to the end of its
         file); a gap would show where it goes, to click into. Else not on the timeline yet */
      const plain = placed && ((Array.isArray(clip.time) && clip.time.length === 2 && clip.time[1] > clip.time[0])
        || (!(Array.isArray(clip.time) && clip.time.length === 2) && probed != null && probed > 0));
      /* the preview could not draw the film, and this clip has no length at all: no `time` to say one, and nothing of
         its own (a still, a page without a duration). That is why it could not; the length it was drawn with before
         is gone with the `time`, so it is drawn where film.html puts it and marked (`noLength`), not at the old one */
      const noLength = guess && !(Array.isArray(clip.time) && clip.time.length === 2)
        && (filmSrcIsStill(clip.src) || (filmClipKind(clip.src) === 'mg' && known != null && known.native == null));
      const span = known && known.end > known.at && !noLength ? known : guess || plain ? guessedSpan(clip as unknown as Record<string, unknown> & { src: string }, probed) : undefined;
      if (!span || !(span.end > span.at)) return;
      const raw = clip as unknown as Record<string, unknown>;
      const loc = filmDocLoc(ti, ci);
      const kind = filmClipKind(clip);
      const startMs = ms(span.at);
      const durMs = ms(span.end - span.at);
      const { from, speed } = trimOf(raw);
      const inMs = from ? ms(from) : undefined;
      const still = filmSrcIsStill(clip.src);
      const anchor: TimelineBlock['anchor'] = { move: 'at', resize: 'end', trimFrom: from, ...(still ? { still } : {}), parentStartMs: 0 };
      const volume = typeof raw.volume === 'number' ? raw.volume : undefined;
      const silent = volume != null && volume <= 0;
      const box = raw.box as TimelineBlock['box'] | undefined;
      const size = span.w && span.h ? { w: span.w, h: span.h } : undefined;
      /* rounded down: a limit worked out from it (a trim's end, the inspector's longest length) must stay inside the
         file; rounded to the nearest, 10.010667 s became 10.011 and the film refused the trim written up to it */
      const sourceDurMs = span.native != null && Number.isFinite(span.native) ? Math.floor(span.native * 1000 + 1e-6) : undefined;
      const shared = {
        key: `${fileStem(clip.src)}#${ti}.${ci}`,
        ...(noLength ? { meta: { noLength: true } } : {}),
        startMs,
        durMs,
        loc,
        track: ref,
        clipId: clip.id,
        ...(volume != null ? { volume } : {}),
        ...(silent ? { silent: true } : {}),
      };

      if (kind === 'audio') {
        sounds.push({
          ...shared,
          kind: filmAudioRoleOf(clip.src),
          src: clip.src,
          anchor,
          ...(sourceDurMs != null ? { sourceDurMs } : {}),
          ...(inMs ? { inMs } : {}),
          ...(speed !== 1 ? { speed } : {}),
        });
        return;
      }

      /* every picture clip is a window on the film (a scene); a video or a still is also the footage in it. Named by its
         id, as the timeline names its block */
      const label = clip.id || fileStem(clip.src);
      scenes.push({
        ...shared,
        label,
        z: -ti,
        anchor,
        ...(kind === 'mg' ? { src: clip.src } : {}),
        ...(box ? { box } : {}),
        ...(size ? { size } : {}),
        ...(sourceDurMs != null && kind === 'mg' ? { sourceDurMs } : {}),
        ...(inMs ? { inMs } : {}),
      });
      if (kind === 'video') {
        videos.push({
          ...shared,
          src: clip.src,
          ...(inMs ? { inMs } : {}),
          ...(speed !== 1 ? { speed } : {}),
          ...(!still && sourceDurMs != null ? { sourceDurMs } : {}),
          label,
          ...(box ? { box } : {}),
          z: -ti,
        });
        /* the footage's own sound: the timeline draws it on the video block, not as a block of its own (at volume 0
           too: it is still there, turned down, and the inspector turns it up again) */
        if (!still && media.get(clip.src)?.audio) {
          sounds.push({ ...shared, kind: 'voice', src: clip.src, ...(inMs ? { inMs } : {}), ...(speed !== 1 ? { speed } : {}) });
        }
      }
    });
  });

  /* the timeline also draws tracks with nothing on them (somewhere to drop), named by their kind */
  return { scenes, videos, sounds, captions: [], doc: { ...doc, tracks: doc.tracks.map((t) => ({ ...t, kind: filmTrackKind(t) })) } };
}
