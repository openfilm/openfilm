/** Precise preview renders are explicit, observable, cancellable, and yield to playback. */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { addHeat, joinStretches, lateStretches, sameStretches, type Heat } from '@/lib/preview-renders';
import type { PlayedReport, PreviewHandle, PreviewRender } from './Preview';
export type MadePreview = { a: number; b: number; key: string; state: 'waiting' | 'making' | 'ready' | 'failed'; ratio?: number; reason?: string };
export type PreviewRenderControl = {
  render(clipId?: string): void; cancel(): void; clear(): void;
  phase: 'idle' | 'waiting' | 'making' | 'ready' | 'failed' | 'paused'; progress: number; ready: number; total: number; error?: string;
};
const chunks = (ranges: [number, number][]) => ranges.flatMap(([a, b]) => {
  const result: [number, number][] = [];
  for (let start = a; start < b - .000001 && result.length < 1000; start += 4) result.push([start, Math.min(b, start + 4)]);
  return result;
});
export function usePreviewRenders({ projectId, folder, fps, playing, on, film, files, preview, duration: filmDuration }: {
  projectId: string; folder: string; fps: number; playing: boolean; on: boolean; film: unknown; files: unknown; preview: RefObject<PreviewHandle | null>; duration?: number;
}) {
  const end = useRef(filmDuration); end.current = filmDuration;
  const [editing, setEditing] = useState(false);
  const heat = useRef<Heat>(new Map()), known = useRef<[number, number][]>([]), stopped = useRef(false), revision = useRef(0);
  const [late, setLate] = useState<[number, number][]>([]), [made, setMade] = useState<MadePreview[]>([]), [error, setError] = useState(false);
  const madeRef = useRef(made); madeRef.current = made;
  const lateNow = () => chunks(joinStretches([...known.current, ...lateStretches(heat.current)]).map(([a,b]) => [a, Math.min(end.current ?? Infinity, b)] as [number,number]).filter(([a,b])=>b>a));
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/preview-cache`;
  const command = useCallback(async (action: string) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
    if (!response.ok) throw new Error('Preview command failed');
  }, [endpoint]);
  const onPlayed = useCallback((report: PlayedReport) => {
    if (stopped.current) return;
    const rendered = madeRef.current.filter((r) => r.state === 'ready');
    addHeat(heat.current, report.spans.filter(([t]) => !rendered.some((r) => t + .5 > r.a && t < r.b)));
    for (const [a] of report.detailSpans ?? []) { if (!rendered.some((r) => a >= r.a && a < r.b)) addHeat(heat.current, [[a, 20, 20]]); }
    const next = lateNow(); setLate((old) => sameStretches(old, next) ? old : next);
  }, []);
  useEffect(() => {
    heat.current = new Map(); known.current = []; stopped.current = false; setLate([]); setMade([]); setError(false);
    if (!(fps > 0)) return;
    let alive = true;
    void fetch(`${endpoint}?fps=${fps}`).then((r) => r.ok ? r.json() : null).then((answer) => {
      if (!alive || !answer?.late?.length) return;
      known.current = answer.late; setLate(lateNow()); setMade(answer.ranges ?? []);
    }).catch(() => {});
    return () => { alive = false; };
  }, [endpoint, fps]);
  useEffect(() => { revision.current++; setMade([]); }, [film, files]);
  useEffect(() => {
    let timer = 0;
    const idle = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setEditing(false), 1200); };
    const active = () => { setEditing(true); idle(); };
    window.addEventListener('pointerdown', active, true); window.addEventListener('pointerup', idle, true);
    window.addEventListener('keydown', active, true); window.addEventListener('wheel', active, true);
    return () => { window.clearTimeout(timer); window.removeEventListener('pointerdown', active, true); window.removeEventListener('pointerup', idle, true); window.removeEventListener('keydown', active, true); window.removeEventListener('wheel', active, true); };
  }, []);
  useEffect(() => { if (!on || playing || editing) void command('pause').catch(() => setError(true)); }, [on, playing, editing, command]);
  useEffect(() => {
    if (!on || !late.length || !(fps > 0) || stopped.current) return;
    let alive = true, timer = 0;
    const version = revision.current;
    const ask = async () => {
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ranges: late, fps, playing: playing || editing }) });
        if (!response.ok) throw new Error();
        const answer = await response.json();
        if (!alive || version !== revision.current) return;
        setMade(answer.ranges ?? []); setError(false);
        if (answer.ranges?.some((r: MadePreview) => r.state === 'waiting' || r.state === 'making')) timer = window.setTimeout(() => void ask(), 800);
      } catch { if (alive) setError(true); }
    };
    timer = window.setTimeout(() => void ask(), playing || editing ? 0 : 1200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [on, late, fps, playing, editing, endpoint, film, files]);
  const request = useCallback((ranges: [number, number][]) => {
    stopped.current = false; void command('retry').catch(() => {}); known.current = joinStretches([...known.current, ...ranges]); setLate(lateNow()); setError(false);
  }, [command]);
  const stop = useCallback((clear: boolean) => {
    stopped.current = true; revision.current++; known.current = []; heat.current.clear(); setLate([]); setMade(clear ? [] : madeRef.current.filter((r) => r.state === 'ready')); setError(false);
    void command(clear ? 'clear' : 'cancel').catch(() => setError(true));
    if (clear) void preview.current?.stage?.('visionClear');
  }, [command, preview]);
  const list = useMemo<PreviewRender[]>(() => on ? made.filter((r) => r.state === 'ready').map((r) => ({ a: r.a, b: r.b, src: `${folder}__film/preview/${r.key}.mp4` })) : [], [on, made, folder]);
  useEffect(() => { preview.current?.renders?.(list); }, [list, preview]);
  const total = made.length || late.length, ready = made.filter((r) => r.state === 'ready').length;
  const duration = made.reduce((n, r) => n + r.b - r.a, 0);
  const progress = duration ? made.reduce((n, r) => n + (r.b - r.a) * (r.state === 'ready' ? 1 : r.ratio ?? 0), 0) / duration : 0;
  const phase: PreviewRenderControl['phase'] = error || made.some((r) => r.state === 'failed') ? 'failed' : total && ready === total ? 'ready' : (playing || editing) && total ? 'paused' : made.some((r) => r.state === 'making') ? 'making' : total ? 'waiting' : 'idle';
  return { onPlayed, request, cancel: () => stop(false), clear: () => stop(true), phase, progress, ready, total, made, error: made.find((r) => r.reason)?.reason };
}
