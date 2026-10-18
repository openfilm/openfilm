/**
 * Preview renders, the editor's side: the stretches that play late (measured as the film plays, lib/preview-renders)
 * are asked to be rendered once the film has stopped for a moment (studio/server/preview-cache.mjs, in the
 * background), followed while they are made, and told to the preview when they are, to play in the film's place.
 * Anything changed in the project (film.html, a page, a file) and those renders are not played until the server names
 * them for the project as it is now. `bar`: what the timeline's ruler shows of them.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { addHeat, joinStretches, lateStretches, sameStretches, type Heat } from '@/lib/preview-renders';
import type { PlayedReport, PreviewHandle, PreviewRender } from './Preview';

/** A stretch on the ruler: plays late (not rendered), being rendered, rendered, or one that could not be. */
export type PreviewBarRange = { a: number; b: number; state: 'late' | 'making' | 'ready' | 'failed'; ratio?: number };
type Made = { a: number; b: number; key: string; state: 'waiting' | 'making' | 'ready' | 'failed'; ratio?: number };

/** How long the film stays stopped (and unchanged) before what plays late is rendered (ms). */
const IDLE_MS = 2000;
/** How often renders being made are asked after (ms). */
const FOLLOW_MS = 1500;

export function usePreviewRenders({ projectId, folder, fps, playing, on, film, files, preview }: {
  projectId: string;
  /** the project's folder on the film's origin (the preview's address of it) */
  folder: string;
  /** the film's frame rate: renders are made at it */
  fps: number;
  playing: boolean;
  /** Settings → Playback: render what plays late */
  on: boolean;
  /** film.html as it is now, and the project's files' version: either changing makes the renders made before stale */
  film: unknown;
  files: unknown;
  preview: RefObject<PreviewHandle | null>;
}) {
  const heat = useRef<Heat>(new Map());
  /* known late before this session (the server keeps them with the renders), and found late as it plays */
  const known = useRef<[number, number][]>([]);
  const [late, setLate] = useState<[number, number][]>([]);
  const [made, setMade] = useState<Made[]>([]);
  const madeRef = useRef(made);
  madeRef.current = made;
  const lateNow = () => joinStretches([...known.current, ...lateStretches(heat.current)]);
  const onPlayed = useCallback((report: PlayedReport) => {
    /* a half second played from its render says nothing of how the film itself plays there */
    const rendered = madeRef.current.filter((r) => r.state === 'ready');
    addHeat(heat.current, report.spans.filter(([t]) => !rendered.some((r) => t + 0.5 > r.a && t < r.b)));
    const next = lateNow();
    setLate((had) => (sameStretches(had, next) ? had : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* another project: what is known of how it plays, from the server (an earlier session's), and its renders */
  useEffect(() => {
    heat.current = new Map();
    known.current = [];
    setLate([]);
    setMade([]);
    if (!on || !(fps > 0)) return undefined;
    let alive = true;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/preview-cache?fps=${fps}`).then((r) => (r.ok ? r.json() : null), () => null)
      .then((answer: { late?: [number, number][]; ranges?: Made[] } | null) => {
        if (!alive || !answer?.late?.length) return;
        known.current = answer.late;
        setLate(lateNow());
        setMade(answer.ranges ?? []);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, on, fps]);
  /* the project changed: what was rendered of it is not played until it is named for the project as it is now */
  useEffect(() => { setMade([]); }, [film, files]);
  useEffect(() => {
    if (!on || playing || !late.length || !(fps > 0)) return undefined;
    let alive = true;
    let timer = 0;
    const ask = async () => {
      const answer = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preview-cache`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ranges: late, fps }),
      }).then((r) => (r.ok ? r.json() : null), () => null) as { ranges?: Made[] } | null;
      if (!alive || !answer?.ranges) return;
      setMade(answer.ranges);
      if (answer.ranges.some((r) => r.state === 'waiting' || r.state === 'making')) timer = window.setTimeout(() => { void ask(); }, FOLLOW_MS);
    };
    timer = window.setTimeout(() => { void ask(); }, IDLE_MS);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [on, playing, late, fps, projectId, film, files]);
  const list = useMemo<PreviewRender[]>(() => (on
    ? made.filter((r) => r.state === 'ready').map((r) => ({ a: r.a, b: r.b, src: `${folder}__film/preview/${r.key}.mp4` }))
    : []), [on, made, folder]);
  useEffect(() => { preview.current?.renders?.(list); }, [list, preview]);
  const bar = useMemo<PreviewBarRange[]>(() => {
    if (!on) return [];
    /* the server's answer is the stretches as asked, put on the frame grid; a stretch found late since is late */
    const asked = made.map((r): PreviewBarRange => ({ a: r.a, b: r.b, state: r.state === 'waiting' ? 'making' : r.state, ...(r.state === 'making' ? { ratio: r.ratio ?? 0 } : {}) }));
    const since = late.filter(([a, b]) => !made.some((r) => r.a < b && a < r.b)).map(([a, b]): PreviewBarRange => ({ a, b, state: 'late' }));
    return [...asked, ...since].sort((x, y) => x.a - y.a);
  }, [on, late, made]);
  return { onPlayed, bar };
}
