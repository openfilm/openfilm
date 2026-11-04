/**
 * What is said in the film, for the timeline's button that makes captions of it (components/Timeline
 * AutoCaptionsButton): the lines its voices' transcripts give (from the server, worked out from film.html and the
 * transcripts; asked again whenever the film or its files change), and the speech with no transcript yet, which
 * `transcribe` transcribes. The captions themselves are a caption track (lib/caption-tracks).
 */
import * as React from 'react';

import { projectEvents } from '@/api';
import { fetchFilmCaptions, requestSubtitleTranscription, type FilmCaptions, type SubtitleTranscribeResult } from './subtitles';
import { historyMoved } from './project-history';

/** Changes come in bursts (an agent writes several files): one request after they settle. */
const REFRESH_MS = 250;

export interface FilmSubtitles {
  /** `srcs`: those files alone. */
  transcribe: (srcs?: readonly string[]) => Promise<SubtitleTranscribeResult>;
  /** Whether a transcription runs now. */
  transcribing: boolean;
  captions: FilmCaptions | null;
}

export function useFilmSubtitles(projectId: string): FilmSubtitles {
  const [captions, setCaptions] = React.useState<FilmCaptions | null>(null);
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
      /* a version restored may bring other corrections of the lines (Studio's own file, which no folder event tells) */
      if (event.type !== 'film' && event.type !== 'files' && !historyMoved(event)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void refresh(); }, REFRESH_MS);
    });
    return () => { stop(); if (timer) clearTimeout(timer); };
  }, [projectId, refresh]);

  const transcribe = React.useCallback(async (srcs?: readonly string[]) => {
    setTranscribing(true);
    try {
      const result = await requestSubtitleTranscription(projectId, srcs);
      await refresh();
      return result;
    } finally { setTranscribing(false); }
  }, [projectId, refresh]);

  return { transcribe, transcribing, captions };
}
