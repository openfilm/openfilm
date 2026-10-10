/**
 * The subtitle row's edits, written: each one reads the source's subtitles as they are now, makes the edit there
 * (lib/subtitle-cues), writes them back (studio/server/subtitle-edits.mjs), and keeps a step in the editor's undo
 * (`record`): undo and redo put the transcript files back as the step found them or left them. Edits go one at a time,
 * in the order they were made.
 *
 * Every call takes film ms, and the cue as the film shows it (lib/subtitles SubtitleCue, from GET captions); it
 * resolves to null, or why it could not be done, in a sentence for the person.
 */
import * as React from 'react';

import type { Film } from '@/api';
import type { OutsideStep } from '@/editor/use-film';
import { useT } from '@/i18n';
import {
  addSource,
  clipSpanOf,
  cueEnd,
  findSourceCue,
  mergeSource,
  removeSource,
  retimeSource,
  splitSource,
  textSource,
  toSourceMs,
  type ClipSpan,
  type SourceCue,
} from './subtitle-cues';
import { fetchSourceSubtitles, restoreSubtitleFiles, saveSourceSubtitles, type SubtitleCue } from './subtitles';
import type { TimelineTrack } from './timeline-layout';

export interface SubtitleEdits {
  /** New times for a cue (a dragged edge, or the whole cue moved). */
  retime: (cue: SubtitleCue, startMs: number, endMs: number) => Promise<string | null>;
  split: (cue: SubtitleCue, atMs: number) => Promise<string | null>;
  /** `a` and the cue right after it as one. */
  merge: (a: SubtitleCue, b: SubtitleCue) => Promise<string | null>;
  remove: (cue: SubtitleCue) => Promise<string | null>;
  /** Its words typed again (empty: it goes). */
  setText: (cue: SubtitleCue, text: string) => Promise<string | null>;
  /** A new cue over [startMs, endMs), said by the clip `clipId` (one that can be heard there). */
  add: (clipId: string, src: string, startMs: number, endMs: number, text: string) => Promise<string | null>;
}

/** The sound or video clip under `atMs` whose words a new cue there would be, or null: one already with lines first. */
export function speakerAt(tracks: readonly TimelineTrack[], cues: readonly SubtitleCue[], atMs: number): { clipId: string; src: string; endMs: number } | null {
  const heard = tracks.filter((tr) => !tr.muted && !tr.hidden).flatMap((tr) => tr.blocks).filter((b) => b.clipId && b.src && b.loc
    && (b.kind === 'voice' || b.kind === 'video' || b.kind === 'sfx' || b.kind === 'music') && !b.silent && b.volume !== 0
    && b.startMs <= atMs && atMs < b.endMs);
  const said = new Set(cues.map((c) => c.clip));
  const best = heard.find((b) => said.has(b.clipId)) ?? heard.find((b) => b.kind === 'voice') ?? heard.find((b) => b.kind === 'video') ?? heard[0];
  return best ? { clipId: best.clipId!, src: best.src!, endMs: best.endMs } : null;
}

export function useSubtitleEdits(projectId: string, {
  film,
  refresh,
  record,
}: {
  film: Film | null;
  /** Ask the film's lines again (they changed). */
  refresh: () => Promise<void>;
  record: (label: string, step: OutsideStep) => void;
}): SubtitleEdits {
  const t = useT();
  const filmRef = React.useRef(film);
  filmRef.current = film;
  const queue = React.useRef<Promise<unknown>>(Promise.resolve());

  /** One edit of `src`'s subtitles through the clip `clipId`: `make` gets them and the clip's span, and gives them back changed (null: it cannot). */
  const change = React.useCallback((src: string, clipId: string | undefined, label: string, make: (list: SourceCue[], span: ClipSpan) => SourceCue[] | string) => {
    const run = async (): Promise<string | null> => {
      const clip = filmRef.current?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId);
      if (!clip) return t('subtitleRow.gone');
      try {
        const { cues } = await fetchSourceSubtitles(projectId, src);
        const next = make(cues, clipSpanOf(clip));
        if (typeof next === 'string') return next;
        const { before, after } = await saveSourceSubtitles(projectId, src, next);
        const put = (from: typeof before, to: typeof before) => async () => {
          try { await restoreSubtitleFiles(projectId, src, from, to); await refresh(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
        };
        record(label, { undo: put(after, before), redo: put(before, after) });
        await refresh();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    };
    const done = queue.current.then(run, run);
    queue.current = done;
    return done;
  }, [projectId, record, refresh, t]);

  /** The source subtitle a cue shows, or the reason it is not there any more. */
  const at = React.useCallback((list: SourceCue[], cue: SubtitleCue): number | string => {
    const i = findSourceCue(list, cue);
    return i < 0 ? t('subtitleRow.gone') : i;
  }, [t]);

  return React.useMemo<SubtitleEdits>(() => ({
    retime: (cue, startMs, endMs) => change(cue.src ?? '', cue.clip, 'history.stepSubtitleTimed', (list, span) => {
      const i = at(list, cue);
      if (typeof i === 'string') return i;
      const was = list[i]!;
      /* an edge not moved stays where the source has it (it may be past the clip's trim, out of sight) */
      const s = startMs !== cue.startMs ? toSourceMs(span, startMs) : was.startMs;
      const e = endMs !== cueEnd(cue) ? toSourceMs(span, endMs) : was.endMs;
      return retimeSource(list, i, s, e);
    }),
    split: (cue, atMs) => change(cue.src ?? '', cue.clip, 'history.stepSubtitleSplit', (list, span) => {
      const i = at(list, cue);
      return typeof i === 'string' ? i : splitSource(list, i, toSourceMs(span, atMs));
    }),
    merge: (a, b) => change(a.src ?? '', a.clip, 'history.stepSubtitleMerged', (list) => {
      const i = at(list, a), j = at(list, b);
      if (typeof i === 'string') return i;
      if (typeof j === 'string') return j;
      return j === i + 1 ? mergeSource(list, i) : t('subtitleRow.notNext');
    }),
    remove: (cue) => change(cue.src ?? '', cue.clip, 'history.stepSubtitleRemoved', (list) => {
      const i = at(list, cue);
      return typeof i === 'string' ? i : removeSource(list, i);
    }),
    setText: (cue, text) => change(cue.src ?? '', cue.clip, 'history.stepSubtitleText', (list) => {
      const i = at(list, cue);
      return typeof i === 'string' ? i : textSource(list, i, text);
    }),
    add: (clipId, src, startMs, endMs, text) => change(src, clipId, 'history.stepSubtitleAdded', (list, span) => {
      const next = addSource(list, { startMs: toSourceMs(span, startMs), endMs: toSourceMs(span, endMs), text });
      return next.length > list.length ? next : t('subtitleRow.noRoom');
    }),
  }), [change, at, t]);
}
