/**
 * Using a template of the library: before it goes in, the person's own videos and pictures for its places. Its places
 * numbered in the order they play, each with its length, the one being filled lit; the project's videos and pictures
 * under them, a click putting one in the place lit and going on to the next empty one (a click on a place lights it
 * again, its × empties it); their own from this computer, put in as they come; Fill, the empty places from those the
 * film does not use yet first; and Use, once every place has one: the template goes in with them (lib/template-instance
 * filledTemplate). Nothing is copied into the project before that.
 */
import * as React from 'react';
import { ImagePlus, Plus, X } from 'lucide-react';
import { useT } from '@/i18n';
import { fillFor } from '@/lib/template-instance';

export interface PickerFile { path: string; name: string; kind: 'video' | 'image'; durationMs?: number; thumb: string }

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

export function TemplatePicker({ name, slots, media, used, onImport, onUse, onClose }: {
  name: string;
  /** each place's length (ms), in the order they play */
  slots: readonly number[];
  /** the project's own videos and pictures */
  media: readonly PickerFile[];
  /** the files the film uses already */
  used: ReadonlySet<string>;
  /** files from this computer, into the project: the paths they landed at */
  onImport: () => Promise<string[]>;
  onUse: (paths: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [picks, setPicks] = React.useState<(string | null)[]>(() => slots.map(() => null));
  const [at, setAt] = React.useState(0);
  const [importing, setImporting] = React.useState(false);
  /* files imported, waiting to be listed before they go in the places */
  const [waiting, setWaiting] = React.useState<string[]>([]);
  const byPath = React.useMemo(() => new Map(media.map((f) => [f.path, f])), [media]);
  const nextEmpty = (list: (string | null)[], from: number) => {
    for (let k = 0; k < list.length; k++) { const i = (from + k) % list.length; if (!list[i]) return i; }
    return -1;
  };
  /* into the place lit, then the next empty ones; the next empty one lit after them */
  const put = (paths: string[]) => {
    const next = [...picks];
    let i = at;
    for (const p of paths) {
      if (i < 0) break;
      next[i] = p;
      i = nextEmpty(next, i + 1);
    }
    setPicks(next);
    setAt(i < 0 ? at : i);
  };
  /* imported files go in once they are listed */
  React.useEffect(() => {
    if (!waiting.length) return;
    const there = waiting.filter((p) => byPath.has(p));
    if (!there.length) return;
    put(there);
    setWaiting((w) => w.filter((p) => !there.includes(p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, byPath]);
  const fill = () => {
    const empty = picks.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
    const chosen = new Set([...used, ...picks.filter((p): p is string => Boolean(p))]);
    const files = fillFor(empty.length, media, chosen);
    setPicks((had) => {
      const next = [...had];
      empty.forEach((i, k) => { if (files[k]) next[i] = files[k]!.path; });
      return next;
    });
  };
  const ready = picks.every(Boolean);
  const importOwn = async () => {
    setImporting(true);
    try { const landed = await onImport(); if (landed.length) setWaiting((w) => [...w, ...landed]); } finally { setImporting(false); }
  };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Enter' && ready) { e.preventDefault(); onUse(picks as string[]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, picks, onClose, onUse]);
  const count = (path: string) => picks.filter((p) => p === path).length;
  return (
    <div data-template-picker="" className="fixed inset-0 z-[80] grid place-items-center bg-black/55" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={name} className="flex max-h-[min(640px,90vh)] w-[min(760px,92vw)] flex-col overflow-hidden rounded-[10px] bg-[var(--bg-raised)] shadow-[0_18px_60px_rgba(0,0,0,0.55)] ring-1 ring-[var(--border)]">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-4">
          <span className="truncate text-[13px] font-semibold text-[var(--text)]">{name}</span>
          <span className="text-[12px] text-[var(--text-muted)]">{t('template.pickTitle').replace('{n}', String(slots.length))}</span>
          <button type="button" aria-label={t('template.cancel')} onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-[6px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><X size={15} /></button>
        </div>
        {/* its places, in the order they play */}
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-[var(--border)] px-4 py-3">
          {slots.map((durMs, i) => {
            const f = picks[i] ? byPath.get(picks[i]!) : null;
            return (
              <div key={i} className="relative shrink-0">
                <button type="button" data-picker-slot={i + 1} onClick={() => setAt(i)}
                  className={`relative grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-[6px] bg-[var(--bg-field)] bg-cover bg-center ${i === at ? 'ring-2 ring-[var(--accent)]' : picks[i] ? 'ring-1 ring-[var(--border)]' : 'border border-dashed border-[var(--border-strong)]'}`}
                  style={f ? { backgroundImage: `url(${JSON.stringify(f.thumb)})` } : undefined}>
                  {f ? <span className="absolute left-1 top-1 rounded-[3px] bg-black/60 px-1 text-[10px] font-semibold leading-[14px] text-white">{i + 1}</span>
                    : <span className="text-[18px] font-semibold text-[var(--text-muted)]">{i + 1}</span>}
                  <span className="absolute bottom-1 right-1 rounded-[3px] bg-black/60 px-1 text-[10px] tabular-nums leading-[14px] text-white">{secs(durMs)}</span>
                </button>
                {picks[i] ? (
                  <button type="button" aria-label={t('template.clear')} onClick={() => { setPicks((had) => had.map((p, k) => (k === i ? null : p))); setAt(i); }}
                    className="absolute -right-1.5 -top-1.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-[var(--bg-raised,#2a2a2a)] text-[var(--text)] ring-1 ring-[var(--border-strong)] hover:bg-[var(--bg-hover)]"><X size={11} /></button>
                ) : null}
              </div>
            );
          })}
        </div>
        {/* the project's own videos and pictures */}
        <div className="min-h-[200px] flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-2 text-[11.5px] text-[var(--text-muted)]">{t('template.pickHint')}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5">
            <button type="button" data-picker-import="" disabled={importing} onClick={() => void importOwn()}
              className="grid aspect-square place-items-center rounded-[6px] border border-dashed border-[var(--border-strong)] text-[var(--text-muted)] hover:border-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-50">
              <span className="flex flex-col items-center gap-1.5 text-[11.5px]"><ImagePlus size={18} />{t('template.import')}</span>
            </button>
            {media.map((f) => {
              const n = count(f.path);
              return (
                <button key={f.path} type="button" data-picker-file={f.path} title={f.name} onClick={() => { if (at >= 0) put([f.path]); }} className="group min-w-0 text-left">
                  <span className={`relative block aspect-square overflow-hidden rounded-[6px] bg-[var(--bg-field)] bg-cover bg-center ${n ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-transparent group-hover:ring-[var(--text-faint)]'}`}
                    style={{ backgroundImage: `url(${JSON.stringify(f.thumb)})` }}>
                    {f.kind === 'video' && f.durationMs ? <span className="absolute bottom-1 right-1 rounded-[3px] bg-black/60 px-1 text-[10px] tabular-nums leading-[14px] text-white">{secs(f.durationMs)}</span> : null}
                    {n ? <span className="absolute left-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold text-black">{n}</span>
                      : <span className="absolute right-1 top-1 hidden h-[18px] w-[18px] place-items-center rounded-full bg-black/60 text-white group-hover:grid"><Plus size={12} /></span>}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-[var(--text-muted)]">{f.name}</span>
                </button>
              );
            })}
          </div>
          {!media.length ? <p className="mt-6 text-center text-[12px] text-[var(--text-muted)]">{t('template.noMedia')}</p> : null}
        </div>
        <div className="flex h-14 shrink-0 items-center gap-2 border-t border-[var(--border)] px-4">
          {media.length && !ready ? (
            <button type="button" data-picker-fill="" onClick={fill} className="h-8 rounded-[6px] bg-[var(--bg-field)] px-3 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--bg-pressed)]">{t('template.fill')}</button>
          ) : null}
          <span className="text-[11.5px] tabular-nums text-[var(--text-muted)]">{picks.filter(Boolean).length} / {slots.length}</span>
          <button type="button" onClick={onClose} className="ml-auto h-8 rounded-[6px] px-3 text-[12px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">{t('template.cancel')}</button>
          <button type="button" data-picker-use="" disabled={!ready} onClick={() => onUse(picks as string[])}
            className="h-8 rounded-[6px] bg-[var(--accent)] px-4 text-[12px] font-semibold text-black hover:brightness-110 disabled:cursor-default disabled:opacity-40 disabled:hover:brightness-100">{t('template.use')}</button>
        </div>
      </div>
    </div>
  );
}
