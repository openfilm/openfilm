/**
 * Everything the editor needs for subtitles, in one hook: the film's lines (from the server, worked out from film.html
 * and the transcripts; asked again whenever the film or its files change), the person's style, and translation.
 *
 *   cues            the lines as the style shows them (picked language, or both), for SubtitleOverlay
 *   count           how many lines the film has (0: the timeline's CC button is disabled and says why)
 *   style / setStyle / patchStyle / toggle / move   the person's style, kept in the project folder
 *   translate       for SubtitleInspector: translate the voices into a language, then ask for the lines again
 *   transcribe      for the timeline's CC button: transcribe the speech that has no transcript yet
 *   setLine         the person's correction of a line, written back into its transcript (or its translation)
 *   sourceLanguage  the voices' language, as far as the script tells
 *   captions        the server's answer as it is (the lines, the speech with no transcript, …)
 */
import * as React from 'react';

import { projectEvents } from '@/api';
import {
  fetchFilmCaptions,
  filmSubtitleShown,
  requestSubtitleTranscription,
  requestSubtitleTranslation,
  saveSubtitleLine,
  type FilmCaptions,
  type SubtitleCue,
  type SubtitleStyle,
  type SubtitleTranscribeResult,
  type SubtitleTranslateResult,
} from './subtitles';
import { useSubtitleStyle } from './use-subtitle-style';

/** Changes come in bursts (an agent writes several files): one request after they settle. */
const REFRESH_MS = 250;

export interface FilmSubtitles {
  cues: SubtitleCue[];
  count: number;
  style: SubtitleStyle;
  setStyle: React.Dispatch<React.SetStateAction<SubtitleStyle>>;
  patchStyle: (next: Partial<SubtitleStyle>) => void;
  toggle: () => void;
  move: (pos: { x: number; y: number }) => void;
  translate: (language: string) => Promise<SubtitleTranslateResult>;
  transcribe: () => Promise<SubtitleTranscribeResult>;
  /** Whether a transcription runs now. */
  transcribing: boolean;
  /** with a `language`, the line's translation into it */
  setLine: (cue: SubtitleCue, text: string, language?: string) => Promise<boolean>;
  sourceLanguage: string | null;
  captions: FilmCaptions | null;
  refresh: () => Promise<void>;
}

export function useFilmSubtitles(projectId: string): FilmSubtitles {
  const [captions, setCaptions] = React.useState<FilmCaptions | null>(null);
  const [style, setStyle] = useSubtitleStyle(projectId);
  const [transcribing, setTranscribing] = React.useState(false);

  const latest = React.useRef(0);
  const refresh = React.useCallback(async () => {
    const ask = ++latest.current;
    try {
      const next = await fetchFilmCaptions(projectId);
      if (ask === latest.current) setCaptions(next);
    } catch { /* keep what is shown; the next change asks again */ }
  }, [projectId]);

  React.useEffect(() => {
    setCaptions(null);
    void refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = projectEvents(projectId, (event) => {
      if (event.type !== 'film' && event.type !== 'files') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void refresh(); }, REFRESH_MS);
    });
    return () => { stop(); if (timer) clearTimeout(timer); };
  }, [projectId, refresh]);

  const cues = React.useMemo(() => filmSubtitleShown(captions?.cues ?? [], style), [captions, style]);
  const count = React.useMemo(() => (captions?.cues ?? []).filter((c) => c.durMs > 0).length, [captions]);
  const patchStyle = React.useCallback((next: Partial<SubtitleStyle>) => setStyle((v) => ({ ...v, ...next })), [setStyle]);
  const toggle = React.useCallback(() => setStyle((v) => ({ ...v, on: !v.on })), [setStyle]);
  const move = React.useCallback((pos: { x: number; y: number }) => setStyle((v) => ({ ...v, pos })), [setStyle]);
  const translate = React.useCallback(async (language: string) => {
    const result = await requestSubtitleTranslation(projectId, language);
    /* ask again even when nothing new came: lines may still lack translations made before */
    await refresh();
    return result;
  }, [projectId, refresh]);

  const transcribe = React.useCallback(async () => {
    setTranscribing(true);
    try {
      const result = await requestSubtitleTranscription(projectId);
      await refresh();
      if (result.ok) setStyle((v) => ({ ...v, on: true }));
      return result;
    } finally { setTranscribing(false); }
  }, [projectId, refresh, setStyle]);
  const setLine = React.useCallback(async (cue: SubtitleCue, text: string, language?: string) => {
    if (cue.src === undefined || cue.line === undefined) return false;
    const ok = await saveSubtitleLine(projectId, { src: cue.src, line: cue.line, ...(cue.part !== undefined ? { part: cue.part } : {}), text, ...(language ? { language } : {}) });
    await refresh();
    return ok;
  }, [projectId, refresh]);

  return {
    cues, count, style, setStyle, patchStyle, toggle, move, translate, transcribe, transcribing, setLine,
    sourceLanguage: captions?.sourceLanguage ?? null, captions, refresh,
  };
}
