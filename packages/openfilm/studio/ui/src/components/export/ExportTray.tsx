/**
 * The export tray: the small stack of cards at the bottom right of the project.
 *
 * Once exports are queued the dialog closes and the person keeps editing; this says how far each one has got (which
 * frame, frames per second, how long is left, which encoder), opens or shows what it made, and shows a failure in
 * its own words. It is there only while there are exports to show; the project's event stream tells it every change.
 */
import { Ban, Check, ChevronDown, ChevronUp, CircleAlert, FolderOpen, Loader2, Play, X } from 'lucide-react';
import React from 'react';

import { projectEvents, studioConnection } from '@/api';
import { useT } from '@/i18n';
import {
  basenameOf,
  cancelExport,
  endedHeadline,
  formatBytes,
  formatDuration,
  jobIsActive,
  listExports,
  openExport,
  revealExport,
  type ExportJob,
} from '@/lib/export-jobs';

/** A finished export's card stays this long after the last one ends. */
const AUTO_HIDE_MS = 12_000;
/** Reopening the project shows exports that ended this recently (a failure a little longer). */
const DONE_KEPT_MS = 2 * 60_000;
const FAILED_KEPT_MS = 10 * 60_000;

export interface ExportTrayHandle {
  /** Exports were just queued: show them now. */
  push: (jobs: ExportJob[]) => void;
}

/** Only what is running or just ended: exports finished long ago are in the export folder, not a card. */
const recent = (job: ExportJob, now: number) => jobIsActive(job)
  || (job.finishedAt != null && now - job.finishedAt < (job.status === 'failed' ? FAILED_KEPT_MS : DONE_KEPT_MS));

/** `onError`: a finished export that could not be opened or shown (its file moved or deleted since), in a sentence. */
export const ExportTray = React.forwardRef<ExportTrayHandle, { projectId: string; onError?: (message: string) => void }>(function ExportTray({ projectId, onError }, ref) {
  const t = useT();
  const fileAction = (run: Promise<void>) => { void run.catch(() => onError?.(t('exportTray.fileGone'))); };
  const [jobs, setJobs] = React.useState<ExportJob[]>([]);
  const [collapsed, setCollapsed] = React.useState(false);
  const [dismissed, setDismissed] = React.useState<Set<string>>(() => new Set());
  /* Cancel was pressed: said at once, before the server's word that it is stopping arrives */
  const [cancelAsked, setCancelAsked] = React.useState<Set<string>>(() => new Set());
  const cancelling = (job: ExportJob) => jobIsActive(job) && (job.cancelling || cancelAsked.has(job.id));
  const cancel = (job: ExportJob) => {
    setCancelAsked((s) => new Set(s).add(job.id));
    void cancelExport(projectId, job.id).catch(() => setCancelAsked((s) => { const next = new Set(s); next.delete(job.id); return next; }));
  };

  const merge = React.useCallback((incoming: readonly ExportJob[]) => {
    setJobs((prev) => {
      /* an export can end before the answer that queued it arrives (a subtitle file takes milliseconds): an ended
         job is never put back to waiting by older news */
      const ended = new Map(prev.filter((j) => !jobIsActive(j)).map((j) => [j.id, j]));
      const next = incoming.map((j) => (jobIsActive(j) && ended.get(j.id)) || j);
      const ids = new Set(next.map((j) => j.id));
      return [...next, ...prev.filter((j) => !ids.has(j.id))];
    });
  }, []);

  React.useImperativeHandle(ref, () => ({
    push: (queued) => {
      setCollapsed(false);
      merge(queued);
    },
  }), [merge]);

  /* when the project opens: exports still running from before are still shown; then every change as it happens */
  React.useEffect(() => {
    setJobs([]);
    setDismissed(new Set());
    setCancelAsked(new Set());
    let live = true;
    void listExports(projectId).then((r) => {
      if (!live) return;
      const now = Date.now();
      setJobs((prev) => {
        const known = new Set(prev.map((j) => j.id));
        return [...prev, ...r.exports.filter((j) => !known.has(j.id) && recent(j, now))];
      });
    }).catch(() => {});
    const stop = projectEvents(projectId, (event) => {
      if (event.type !== 'export') return;
      const job = event.job;
      if (job.project === projectId) merge([job]);
    });
    return () => { live = false; stop(); };
  }, [projectId, merge]);

  /* Studio back after it was away: what it says now, and an export it no longer knows (it stopped while that ran, and
     its exports went with it) ended, said so, instead of "preparing" for ever */
  React.useEffect(() => {
    let was = studioConnection.get();
    return studioConnection.subscribe(() => {
      const now = studioConnection.get();
      const back = now === 'up' && was !== 'up';
      was = now;
      if (!back) return;
      void listExports(projectId).then((r) => {
        const there = new Map(r.exports.map((j) => [j.id, j]));
        setJobs((prev) => prev.map((j) => {
          if (!jobIsActive(j)) return j;
          const known = there.get(j.id);
          if (known) return known;
          return { ...j, status: 'failed', phase: null, etaMs: null, cancelling: false, error: t('exportTray.studioStopped'), finishedAt: Date.now() };
        }));
      }).catch(() => {});
    });
  }, [projectId, t]);

  const visible = jobs.filter((j) => !dismissed.has(j.id));
  /* All done and none failed: the card goes by itself after a moment (not while the pointer is on it). A failure
     stays until it is closed: that one needs reading. */
  const [hovered, setHovered] = React.useState(false);
  const settled = visible.length > 0 && !visible.some(jobIsActive) && !visible.some((j) => j.status === 'failed');
  /* the cards shown, as a string: `visible` is a new array on every render (many a second while the film plays),
     which would start the timer over each time */
  const shownIds = visible.map((j) => j.id).join('\n');
  React.useEffect(() => {
    if (!settled || hovered) return undefined;
    const timer = window.setTimeout(() => setDismissed((d) => new Set([...d, ...shownIds.split('\n')])), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [settled, hovered, shownIds]);
  if (!visible.length) return null;

  const active = visible.filter(jobIsActive);
  const stopping = active.filter(cancelling).length;
  const ended = active.length ? null : endedHeadline(visible, t);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="pointer-events-auto fixed bottom-4 right-4 z-[120] w-[340px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3.5 py-2.5">
        {!ended ? <Loader2 size={14} className="shrink-0 animate-spin text-[var(--text-muted)]" />
          : ended.tone === 'err' ? <CircleAlert size={14} className="shrink-0 text-[var(--err)]" />
            : ended.tone === 'muted' ? <Ban size={14} className="shrink-0 text-[var(--text-faint)]" />
              : <Check size={14} className="shrink-0 text-[var(--ok)]" />}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text)]">
          {ended ? ended.text
            : stopping === active.length ? t('exportTray.cancelling')
              : t('exportTray.running').replace('{n}', String(active.length - stopping))}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t('exportTray.expand') : t('exportTray.collapse')}
          className="rounded-md p-1 text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {!active.length && (
          <button
            type="button"
            onClick={() => setDismissed(new Set(jobs.map((j) => j.id)))}
            aria-label={t('exportTray.close')}
            className="rounded-md p-1 text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {!collapsed && (
        <ul className="max-h-[320px] overflow-y-auto">
          {visible.map((job) => (
            <li key={job.id} className="border-b border-[var(--border-soft)] px-3.5 py-2.5 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--text)]">{job.label || job.kind}</span>
                {jobIsActive(job) ? (
                  <button
                    type="button"
                    disabled={cancelling(job)}
                    onClick={() => cancel(job)}
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] text-[var(--text-muted)] transition enabled:hover:bg-[var(--bg-hover)] enabled:hover:text-[var(--err)] disabled:cursor-default disabled:opacity-50"
                  >
                    {t('exportTray.cancel')}
                  </button>
                ) : job.status === 'done' && job.outputs[0] ? (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => fileAction(openExport(projectId, job.id))}
                      title={t('exportTray.open')}
                      aria-label={t('exportTray.open')}
                      className="rounded-md p-1 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                    >
                      <Play size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => fileAction(revealExport(projectId, job.id))}
                      title={t('exportTray.reveal')}
                      aria-label={t('exportTray.reveal')}
                      className="rounded-md p-1 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                    >
                      <FolderOpen size={13} />
                    </button>
                  </span>
                ) : null}
              </div>
              <JobLine job={job} cancelling={cancelling(job)} t={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

function JobLine({ job, cancelling, t }: { job: ExportJob; cancelling: boolean; t: (k: string) => string }) {
  const [whole, setWhole] = React.useState(false);
  if (cancelling) {
    return <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">{t('exportTray.cancelling')}</p>;
  }
  if (job.status === 'waiting') {
    return <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">{t('exportTray.queued')}</p>;
  }
  if (job.status === 'running') {
    const pct = Math.round(job.progress * 100);
    const parts = [
      job.phase ? t(`exportTray.phase.${job.phase}`) : '',
      job.framesTotal ? `${job.framesDone}/${job.framesTotal}` : '',
      job.rate ? `${job.rate.toFixed(job.rate < 10 ? 1 : 0)} fps` : '',
      job.etaMs != null ? `${t('exportTray.eta')} ${formatDuration(job.etaMs)}` : '',
    ].filter(Boolean);
    return (
      <div className="mt-1.5">
        <div className="h-[3px] overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div className="h-full rounded-full bg-[var(--text)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] tabular-nums text-[var(--text-faint)]">
          <span className="min-w-0 flex-1 truncate">{parts.join(' · ')}</span>
          {job.encoder ? <span className="shrink-0 rounded bg-[var(--surface-2)] px-1 py-px font-mono text-[10px]">{job.encoder}</span> : null}
          <span className="shrink-0">{pct}%</span>
        </p>
      </div>
    );
  }
  if (job.status === 'done') {
    const took = job.startedAt && job.finishedAt ? formatDuration(job.finishedAt - job.startedAt) : '';
    /* a transparent export with nothing see-through: the file is fine, the element paints its own background */
    const opaque = job.alpha != null && !job.alpha.any;
    return (
      <>
        {opaque && <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--warn)]">{t('exportTray.notTransparent')}</p>}
        <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-faint)]" title={job.outputs.join('\n')}>
          {[job.outputs.length === 1 ? basenameOf(job.outputs[0]!) : t('exportTray.files').replace('{n}', String(job.outputs.length)),
            job.bytes ? formatBytes(job.bytes) : '', took ? t('exportTray.took').replace('{time}', took) : ''].filter(Boolean).join(' · ')}
        </p>
      </>
    );
  }
  if (job.status === 'cancelled') {
    return <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">{t('exportTray.cancelled')}</p>;
  }
  /* a long failure is cut to three lines: a click (or the pointer resting on it) shows all of it */
  const error = job.error || t('exportTray.failed');
  return (
    <p
      role="button"
      tabIndex={0}
      aria-expanded={whole}
      title={whole ? undefined : error}
      onClick={() => { if (!window.getSelection()?.toString()) setWhole((w) => !w); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWhole((w) => !w); } }}
      className={`mt-0.5 cursor-pointer whitespace-pre-wrap break-words text-[11.5px] leading-snug text-[var(--err)] ${whole ? 'select-text' : 'line-clamp-3'}`}
    >
      {error}
    </p>
  );
}
