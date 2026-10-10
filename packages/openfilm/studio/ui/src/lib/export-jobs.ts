/**
 * Exports run on this machine, in Studio's server (studio/server/exports.mjs): the dialog queues them, the tray
 * follows them (the project's event stream says every change of a job), cancels them, and opens what they made.
 */
import type { FilmFrameFill, FilmFrameId } from '@/lib/film-frame';
import type { ExportQuality, ExportVideoCodec } from '@/lib/export-spec';

/** `burnSubtitles`: the film's subtitles drawn into the picture, as the editor shows them. */
type Framing = { frame?: FilmFrameId; fill?: FilmFrameFill; burnSubtitles?: boolean };

/** One export, as the server takes it. `range` is [from, to] in seconds. */
export type ExportRequest = { range?: [number, number]; label?: string } & (
  | (Framing & { kind: 'video'; codec: ExportVideoCodec; shortEdge?: number; fps: number; quality: ExportQuality; audio: boolean;
    clip?: string; scale?: number; preset?: string; sidecar?: 'srt' | 'vtt' })
  | (Framing & { kind: 'gif'; width: number; fps: number })
  | { kind: 'audio'; format: 'wav' | 'm4a' | 'mp3'; mix: boolean; stems: boolean }
  | (Framing & { kind: 'stills'; format: 'png' | 'jpg'; shortEdge: number; at?: number[] })
  | (Framing & { kind: 'poster'; format: 'png' | 'jpg'; shortEdge: number; at?: number })
  | { kind: 'subtitles'; format: 'srt' | 'vtt' | 'txt' }
  | (Framing & { kind: 'slides'; format: 'pptx' | 'pdf'; shortEdge: number; at?: number[] })
  /* for an editing program: an xmeml folder; `media: 'link'` points at the sources where they are instead of cloning them */
  | { kind: 'nle'; fps: number; audio: 'clips' | 'stems'; media?: 'copy' | 'link'; subtitles: boolean }
  /* the project itself: its work, and the parts of its .film asked; a zip of its folder, or the folder */
  | { kind: 'project'; parts: ProjectPart[]; as: 'zip' | 'folder' }
);

/** What a project's export may take besides its work (studio/server/projects.mjs PROJECT_PARTS). */
export type ProjectPart = 'history' | 'chat' | 'logs';
export const PROJECT_PARTS: readonly ProjectPart[] = ['history', 'chat', 'logs'];

/** How big a project's export is: its work, and each part it has (null: none), in bytes. */
export type ProjectSizes = { work: number } & Record<ProjectPart, number | null>;

export type ExportJobStatus = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ExportJob {
  id: string;
  project: string;
  /** The project's name. */
  name: string;
  /** What the dialog called it ("YouTube", "ProRes 4444", "Full mix"…); empty for an export asked elsewhere. */
  label: string;
  kind: ExportRequest['kind'];
  status: ExportJobStatus;
  phase: 'preparing' | 'audio' | 'rendering' | 'encoding' | 'copying' | 'finishing' | null;
  /** 0 to 1. */
  progress: number;
  framesDone: number;
  framesTotal: number;
  /** Frames per second drawn. */
  rate: number;
  etaMs: number | null;
  encoder: string | null;
  /** Absolute paths of the files made (one, or the mix and its stems). */
  outputs: string[];
  bytes: number | null;
  /** Whether a transparent export lets anything through (sampled frames); null when not measured. */
  alpha: { any: boolean } | null;
  error?: string;
  /** Cancel was asked and the export is stopping (still `running` until it has). */
  cancelling?: boolean;
  at: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** What this machine's ffmpeg encodes, for the choices that depend on it. */
export interface ExportCapabilities {
  h264: boolean;
  hevc: boolean;
  hevcAlpha: boolean;
  vp9: boolean;
  prores: boolean;
  mp3: boolean;
}

const endpoint = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/exports`;

async function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    ...(init?.json !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.json) } : {}),
  });
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(body.error || `Studio answered ${res.status}`);
  return body as T;
}

/**
 * The project's exports, where they go by default, what this machine encodes, how many subtitle cues the film has, and
 * how big the project and its parts are.
 */
export function listExports(projectId: string): Promise<{ exports: ExportJob[]; folder: string; can: ExportCapabilities; subtitles?: number; project?: ProjectSizes }> {
  return call(endpoint(projectId), { cache: 'no-store' });
}

/** A video file's frame rate (`media?what=probe`); null when it has none or can't be read. */
export async function probeFps(projectId: string, path: string): Promise<number | null> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/media?what=probe&path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null) as { fps?: number } | null;
  return typeof body?.fps === 'number' && body.fps > 0 ? body.fps : null;
}

/** Queue exports, all or none. `folder`: where to write them (absolute, or ~/…); missing = the default folder. */
export async function startExports(projectId: string, jobs: readonly ExportRequest[], folder?: string): Promise<ExportJob[]> {
  const body = await call<{ exports: ExportJob[] }>(endpoint(projectId), { method: 'POST', json: { jobs, ...(folder ? { folder } : {}) } });
  return body.exports;
}

export async function cancelExport(projectId: string, jobId: string): Promise<void> {
  await call(`${endpoint(projectId)}/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
}

/** Show the export's file in the system's file manager. */
export async function revealExport(projectId: string, jobId: string): Promise<void> {
  await call(`${endpoint(projectId)}/${encodeURIComponent(jobId)}/reveal`, { method: 'POST', json: {} });
}

/** Open the export's file in the app the system opens it with. */
export async function openExport(projectId: string, jobId: string): Promise<void> {
  await call(`${endpoint(projectId)}/${encodeURIComponent(jobId)}/open`, { method: 'POST', json: {} });
}

export function jobIsActive(job: ExportJob): boolean {
  return job.status === 'waiting' || job.status === 'running';
}

export function basenameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * A moment or a length of the film in the export dialog: m:ss, with tenths where it is not a whole second (0:07.5),
 * so a film of 7.5 s doesn't read as 0:08.
 */
export function formatFilmTime(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const whole = formatDuration(Math.floor(tenths / 10) * 1000);
  return tenths % 10 ? `${whole}.${tenths % 10}` : whole;
}

/**
 * What the tray's head says once nothing runs: how the exports ended, in the person's words. `tone` picks its mark:
 * a failure needs reading; all cancelled is neither good nor bad; anything made is done.
 */
export function endedHeadline(jobs: readonly ExportJob[], t: (key: string) => string): { tone: 'ok' | 'err' | 'muted'; text: string } {
  const n = (status: ExportJobStatus) => jobs.filter((j) => j.status === status).length;
  const done = n('done');
  const cancelled = n('cancelled');
  const failed = n('failed');
  if (failed === jobs.length) return { tone: 'err', text: t(failed === 1 ? 'exportTray.failedOne' : 'exportTray.failedAll') };
  if (cancelled === jobs.length) return { tone: 'muted', text: t(cancelled === 1 ? 'exportTray.cancelledOne' : 'exportTray.cancelledAll') };
  if (done === jobs.length) return { tone: 'ok', text: t('exportTray.finished') };
  const parts = [
    done ? t('exportTray.countDone').replace('{n}', String(done)) : '',
    cancelled ? t('exportTray.countCancelled').replace('{n}', String(cancelled)) : '',
    failed ? t('exportTray.countFailed').replace('{n}', String(failed)) : '',
  ].filter(Boolean);
  return { tone: failed ? 'err' : done ? 'ok' : 'muted', text: parts.join(', ') };
}
