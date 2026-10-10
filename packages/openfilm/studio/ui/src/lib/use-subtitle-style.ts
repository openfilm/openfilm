/**
 * The project's subtitle style: read from the project folder (`.film/subtitles.json`, via the server), written back
 * 500 ms after the last change. It is the person's look of this film, kept with the project and used by its exports,
 * and not in film.html, so an agent rewriting the film never resets it.
 *
 * A project whose style was never changed starts from the look this person used last (this browser remembers it,
 * see readLastSubtitleStyle), else the default; nothing is written for it until the person changes something.
 */
import * as React from 'react';

import {
  fetchSubtitleStyle,
  readLastSubtitleStyle,
  saveSubtitleStyle,
  SUBTITLE_DEFAULT,
  writeLastSubtitleStyle,
  type SubtitleStyle,
} from './subtitles';

/** Dragging a color slider makes dozens of values: one write for all of them. */
const SAVE_DEBOUNCE_MS = 500;

const startingStyle = (): SubtitleStyle => readLastSubtitleStyle() ?? SUBTITLE_DEFAULT;

export function useSubtitleStyle(projectId: string): [SubtitleStyle, React.Dispatch<React.SetStateAction<SubtitleStyle>>] {
  const [style, setStyle] = React.useState<SubtitleStyle>(startingStyle);
  /* the JSON last known to match the project's file (null: not loaded yet; '': unknown, the next change is written) */
  const saved = React.useRef<string | null>(null);
  const styleRef = React.useRef(style);
  styleRef.current = style;

  React.useEffect(() => {
    saved.current = null;
    const start = startingStyle();
    const startJson = JSON.stringify(start);
    setStyle(start);
    const ask = new AbortController();
    fetchSubtitleStyle(projectId, ask.signal).then((kept) => {
      /* changed in the meantime: the person's change wins, and is written now */
      const dirty = JSON.stringify(styleRef.current) !== startJson;
      if (kept && !dirty) setStyle(kept);
      saved.current = dirty ? '' : JSON.stringify(kept ?? start);
      if (dirty) setStyle((s) => ({ ...s }));
    }, () => {
      if (!ask.signal.aborted) saved.current = '';
    });
    return () => ask.abort();
  }, [projectId]);

  React.useEffect(() => {
    /* not loaded yet: writing now could overwrite the project's own style */
    if (saved.current === null) return undefined;
    const next = JSON.stringify(style);
    if (next === saved.current) return undefined;
    const timer = setTimeout(() => {
      saved.current = next;
      writeLastSubtitleStyle(style);
      saveSubtitleStyle(projectId, style).catch(() => {
        /* a failed save must not interrupt the person styling: the picture still shows their style, and the next
           change tries again */
        saved.current = '';
      });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [projectId, style]);

  return [style, setStyle];
}
