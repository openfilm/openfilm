/**
 * Subtitles in the editor, from before caption tracks: the look the person used last, which a new project starts in;
 * and the server calls that say what is said in the film and transcribe it (studio/server/captions.mjs).
 *
 * Kept free of React and of `@/` imports so the editor's tests can import it as it is.
 */
import { parseFilmSubtitleStyle } from '../../../server/film-subtitle.mjs';
import type { FilmSubtitleCue, FilmSubtitleStyle } from '../../../server/film-subtitle.mjs';

export type SubtitleCue = FilmSubtitleCue;
export type SubtitleStyle = FilmSubtitleStyle;

/* ── the look this person used last ──────────────────────────────────────── */

/**
 * The style was kept per project (in the project folder, `.film/subtitles.json`); this browser also remembers the look
 * last used, the look a new project starts in (written to it as it is made, see api.newProject): someone who set up
 * large yellow subtitles wants them in the next film too.
 */
const STORE_KEY = 'openfilm.subtitles';

/** The look used last, switched on: the switch belongs to each film (subtitles off in one do not hide another's). */
export function readLastSubtitleStyle(): SubtitleStyle | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...parseFilmSubtitleStyle(JSON.parse(raw)), on: true } : null;
  } catch {
    return null;
  }
}

/* ── Studio's API (studio/server/captions.mjs) ───────────────────────────── */

/** The film's subtitles as the server works them out (`GET /api/projects/:id/captions`). */
export type FilmCaptions = {
  cues: SubtitleCue[];
  /** The voices' language, by script (null: a Latin script, or nothing said). */
  sourceLanguage: string | null;
  /** Languages any line has a translation in. */
  languages: string[];
  /** The speech heard in the film with no transcript yet (POST subtitles/transcribe makes them). */
  untranscribed: string[];
};

const subtitlesApi = (projectId: string, rest: string) => `/api/projects/${encodeURIComponent(projectId)}/${rest}`;

export async function fetchFilmCaptions(projectId: string, signal?: AbortSignal): Promise<FilmCaptions> {
  const res = await fetch(subtitlesApi(projectId, 'captions'), { signal });
  if (!res.ok) throw new Error(`Studio answered ${res.status}`);
  return await res.json() as FilmCaptions;
}

/** How making subtitles went: `needsTranscriber` when no service can transcribe (the error says so). */
export type SubtitleTranscribeResult = { ok: boolean; error?: string; needsTranscriber?: boolean };

/** Transcribe the speech heard in the film that has no transcript yet (each gets a WebVTT beside it); `srcs`: those files alone. */
export async function requestSubtitleTranscription(projectId: string, srcs?: readonly string[]): Promise<SubtitleTranscribeResult> {
  try {
    const res = await fetch(subtitlesApi(projectId, 'subtitles/transcribe'), {
      method: 'POST', ...(srcs ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ srcs }) } : {}),
    });
    const body = await res.json().catch(() => null) as { failed?: { error: string }[]; error?: string; code?: string } | null;
    if (!res.ok) return { ok: false, error: body?.failed?.[0]?.error ?? body?.error ?? `HTTP ${res.status}`, ...(body?.code === 'no-transcriber' ? { needsTranscriber: true } : {}) };
    return body?.failed?.length ? { ok: false, error: body.failed[0]!.error } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
