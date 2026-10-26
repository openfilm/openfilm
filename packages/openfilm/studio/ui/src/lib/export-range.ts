import { exactRate, timecodeSeconds } from './timecode.ts';
import type { ExportRequest } from './export-jobs.ts';

export type ExportRangeDraft = { id: string; from: string; to: string };
export type RangeDelivery = 'separate' | 'merged';
export const EXPORT_RANGE_MAX = 100;

export function readExportRanges(parts: readonly ExportRangeDraft[], totalMs: number, fps: number): [number, number][] | null {
  if (!parts.length || parts.length > EXPORT_RANGE_MAX) return null;
  const ranges: [number, number][] = [];
  for (const part of parts) {
    const value = readExportRange(part.from, part.to, totalMs, fps);
    if (!value || Math.round(value.toMs * exactRate(fps) / 1000) <= Math.round(value.fromMs * exactRate(fps) / 1000)) return null;
    ranges.push([value.fromMs / 1000, value.toMs / 1000]);
  }
  return ranges;
}

/** Each destination gets either one job per stretch or one job with an ordered selection. */
export function applyRangeDelivery(jobs: readonly ExportRequest[], ranges: [number, number][], delivery: RangeDelivery): ExportRequest[] {
  if (delivery === 'merged' && ranges.length > 1) return jobs.map((job) => ({ ...job, ranges }));
  return ranges.flatMap((range, i) => jobs.map((job) => ({ ...job, range, label: [job.label, String(i + 1)].filter(Boolean).join(' · ') })));
}

export function requestDurationMs(request: ExportRequest, totalMs: number): number {
  if (request.ranges) return request.ranges.reduce((n, [from, to]) => n + (to - from) * 1000, 0);
  return request.range ? (request.range[1] - request.range[0]) * 1000 : totalMs;
}

/** Export points accept seconds, a clock (M:SS or H:MM:SS), or the player's H:MM:SS:FF timecode. */
export function parseExportTime(raw: string, fps = 30): number | null {
  const text = raw.trim();
  if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    const ms = Number(text) * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 4 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  if (parts.slice(0, -1).some((part) => !/^\d+$/.test(part))) return null;
  const values = parts.map(Number);
  if (values.some((part) => !Number.isFinite(part))) return null;
  if (values.length === 4) {
    const [hours, minutes, seconds, frames] = values as [number, number, number, number];
    if (minutes >= 60 || seconds >= 60 || !Number.isInteger(frames) || frames >= Math.ceil(exactRate(fps))) return null;
    const time = timecodeSeconds(hours * 3600 + minutes * 60 + seconds, frames, fps) * 1000;
    return Number.isFinite(time) ? time : null;
  }
  const seconds = values.at(-1)!;
  const minutes = values.at(-2)!;
  if (seconds >= 60 || (values.length === 3 && minutes >= 60)) return null;
  const time = ((values.length === 3 ? values[0]! * 3600 : 0) + minutes * 60 + seconds) * 1000;
  return Number.isFinite(time) ? time : null;
}

/** An invalid partial export must never silently fall back to exporting the whole film. */
export function readExportRange(from: string, to: string, totalMs: number, fps = 30): { fromMs: number; toMs: number } | null {
  const fromMs = parseExportTime(from, fps);
  const toMs = parseExportTime(to, fps);
  /* Dividing an exact clip edge by 1,000 and reading it back can differ by a floating-point rounding error. */
  if (!Number.isFinite(totalMs) || fromMs == null || toMs == null || fromMs < 0 || toMs > totalMs + 1e-6) return null;
  const end = Math.min(toMs, totalMs);
  return end > fromMs ? { fromMs, toMs: end } : null;
}
