/**
 * What stands where the timeline is while a cover is open (lib/covers): the way back to the film, the film as a strip of
 * its moments to take the cover's picture from (a click takes that moment; the one taken is marked), the covers of the
 * film in their shapes, and what is done with this one: the platform's buttons drawn over it, its subject cut out of
 * its picture, a new picture made for it, and the picture exported.
 */
import React from 'react';
import { ChevronLeft, Download, Grid2x2, Scissors, Sparkles } from 'lucide-react';
import { useT } from '@/i18n';
import { coverThumb, filmThumb, safeAreas, shapeOf, type CoverInfo } from '@/lib/covers';

export interface CoverBarProps {
  /** the project the cover is of */
  outerId: string;
  outerName: string;
  /** this cover's folder (`covers/<name>`), its stage */
  folder: string;
  stage: { w: number; h: number };
  covers: readonly CoverInfo[];
  /** the film's length, in seconds (null: not known yet) */
  filmSeconds: number | null;
  /** the moment the picture was taken at, in seconds (null: it is none of the film's) */
  frameAt: number | null;
  /** what is being done now, said on its button */
  busy: 'frame' | 'cutout' | 'picture' | 'export' | null;
  safe: boolean;
  onSafe: (on: boolean) => void;
  onBack: () => void;
  onOpen: (cover: CoverInfo) => void;
  onMoment: (seconds: number) => void;
  onCutout: () => void;
  onPicture: (words: string) => void;
  onExport: (all: boolean) => void;
  /** a picture to cut out of, and to make a new one from */
  hasPicture: boolean;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function CoverBar(p: CoverBarProps) {
  const t = useT();
  const shape = shapeOf(p.stage);
  const strip = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  const [hover, setHover] = React.useState<number | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [words, setWords] = React.useState('');
  React.useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setWidth(el.clientWidth));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  const length = p.filmSeconds ?? 0;
  /* thumbnails 16:9 at the strip's height, as many as fit */
  const tile = 96;
  const count = width > 0 && length > 0 ? Math.max(1, Math.floor(width / tile)) : 0;
  const at = (clientX: number) => {
    const r = strip.current!.getBoundingClientRect();
    return Math.max(0, Math.min(length, ((clientX - r.left) / r.width) * length));
  };
  return (
    <div data-cover-bar="" className="flex h-full min-h-0 flex-col gap-2 bg-[var(--bg-panel)] px-3 py-2 text-[12px] text-[var(--text)]">
      <div className="flex h-8 shrink-0 items-center gap-2">
        <button type="button" data-cover-back="" onClick={p.onBack} title={t('covers.backTip')}
          className="flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <ChevronLeft size={15} className="shrink-0" />
          <span className="truncate">{p.outerName}</span>
        </button>
        <span className="text-[var(--text-faint)]">/</span>
        <span className="truncate font-medium">{t('covers.title')} · {t(`covers.shape_${shape.id}`)} <span className="font-normal text-[var(--text-faint)]">{shape.ratio}</span></span>
        <div className="ml-auto flex items-center gap-1">
          <Tool on={p.safe} onClick={() => p.onSafe(!p.safe)} icon={<Grid2x2 size={14} />} label={t('covers.safe')} tip={t('covers.safeTip')} />
          <Tool disabled={!p.hasPicture || p.busy != null} onClick={p.onCutout} icon={<Scissors size={14} />}
            label={p.busy === 'cutout' ? t('covers.working') : t('covers.cutout')} tip={t('covers.cutoutTip')} />
          <div className="relative">
            <Tool on={asking} disabled={p.busy != null} onClick={() => setAsking(!asking)} icon={<Sparkles size={14} />}
              label={p.busy === 'picture' ? t('covers.working') : t('covers.makePicture')} tip={t('covers.makePictureTip')} />
            {asking ? (
              <form data-cover-ask="" className="absolute bottom-[calc(100%+6px)] right-0 z-30 flex w-[300px] flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 shadow-xl"
                onSubmit={(e) => { e.preventDefault(); if (!words.trim()) return; p.onPicture(words.trim()); setAsking(false); }}>
                <textarea autoFocus value={words} onChange={(e) => setWords(e.target.value)} rows={3}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAsking(false); } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }}
                  placeholder={p.hasPicture ? t('covers.makeFromFrame') : t('covers.makeFromWords')}
                  className="resize-none rounded-md bg-[var(--bg-field)] px-2 py-1.5 text-[12px] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--accent)]" />
                <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">{t('covers.makeNote')}</p>
                <button type="submit" disabled={!words.trim()}
                  className="h-7 rounded-md bg-[var(--primary)] text-[12px] font-medium text-[var(--on-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50">{t('covers.makeGo')}</button>
              </form>
            ) : null}
          </div>
          <Tool disabled={p.busy != null} onClick={() => p.onExport(false)} icon={<Download size={14} />}
            label={p.busy === 'export' ? t('covers.working') : t('covers.export')} tip={t('covers.exportTip')} primary />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-faint)]">
            <span>{p.busy === 'frame' ? t('covers.takingFrame') : t('covers.pickFrame')}</span>
            <span className="tabular-nums">{hover != null ? mmss(hover) : p.frameAt != null ? `${t('covers.taken')} ${mmss(p.frameAt)}` : ''}</span>
          </div>
          <div ref={strip} data-cover-strip="" role="slider" aria-label={t('covers.pickFrame')} aria-valuemin={0} aria-valuemax={length} aria-valuenow={p.frameAt ?? 0} tabIndex={0}
            className={`relative min-h-[54px] flex-1 cursor-pointer overflow-hidden rounded-md bg-[var(--bg-field)] ${p.busy === 'frame' ? 'opacity-60' : ''}`}
            onPointerMove={(e) => length > 0 && setHover(at(e.clientX))}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => { if (length > 0 && p.busy == null) p.onMoment(at(e.clientX)); }}
            onKeyDown={(e) => {
              if (p.busy != null || length <= 0) return;
              const step = e.shiftKey ? 1 : 1 / 25;
              if (e.key === 'ArrowLeft') { e.preventDefault(); p.onMoment(Math.max(0, (p.frameAt ?? 0) - step)); }
              if (e.key === 'ArrowRight') { e.preventDefault(); p.onMoment(Math.min(length, (p.frameAt ?? 0) + step)); }
            }}>
            <div className="absolute inset-0 flex">
              {Array.from({ length: count }, (_, i) => (
                <img key={i} src={filmThumb(p.outerId, ((i + 0.5) / count) * length * 1000)} alt="" draggable={false}
                  className="h-full min-w-0 flex-1 object-cover" />
              ))}
            </div>
            {hover != null && length > 0 ? <span className="pointer-events-none absolute inset-y-0 w-px bg-white/70" style={{ left: `${(hover / length) * 100}%` }} /> : null}
            {p.frameAt != null && length > 0 ? (
              <span data-cover-taken="" className="pointer-events-none absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full bg-[var(--accent)] shadow-[0_0_0_1px_rgba(0,0,0,.5)]"
                style={{ left: `${(Math.min(p.frameAt, length) / length) * 100}%` }} />
            ) : null}
          </div>
        </div>
        <div className="flex w-[260px] max-w-[40%] shrink-0 flex-col gap-1">
          <span className="text-[11px] text-[var(--text-faint)]">{t('covers.others')}</span>
          <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto">
            {p.covers.map((c) => {
              const on = c.folder === p.folder;
              const s = shapeOf(c.stage);
              return (
                <button key={c.folder} type="button" onClick={() => !on && p.onOpen(c)} title={`${t(`covers.shape_${s.id}`)} ${s.ratio}`}
                  className={`flex shrink-0 flex-col items-center gap-0.5 rounded-md p-1 transition ${on ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}>
                  <span className="flex min-h-0 flex-1 items-center">
                    <img src={coverThumb(p.outerId, c, 240)} alt="" draggable={false}
                      className={`max-h-[64px] rounded-[3px] ${on ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-[var(--border)]'}`} />
                  </span>
                  <span className="text-[10.5px] text-[var(--text-muted)]">{s.ratio}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Tool({ icon, label, tip, onClick, on = false, disabled = false, primary = false }: {
  icon: React.ReactNode; label: string; tip: string; onClick: () => void; on?: boolean; disabled?: boolean; primary?: boolean;
}) {
  return (
    <button type="button" title={tip} onClick={onClick} disabled={disabled} aria-pressed={on}
      className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition disabled:opacity-50 ${primary
        ? 'bg-[var(--primary)] font-medium text-[var(--on-primary)] hover:bg-[var(--primary-hover)]'
        : on ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

/**
 * Over a cover's picture: where the platforms' own buttons and words cover a cover of its shape (lib/covers safeAreas),
 * shaded, and the part a profile's grid shows, outlined. Drawn only; nothing of it is in the cover.
 */
export function CoverSafeArea({ stage }: { stage: { w: number; h: number } }) {
  const t = useT();
  const { covered, crop } = safeAreas(shapeOf(stage).id);
  const pct = (n: number) => `${n * 100}%`;
  return (
    <div data-cover-safe="" className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {covered.map((r) => (
        <div key={r.label} className="absolute flex items-start justify-start border border-dashed border-white/70 bg-[repeating-linear-gradient(135deg,rgba(0,0,0,.38)_0_6px,rgba(0,0,0,.18)_6px_12px)]"
          style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}>
          <span className="m-1 rounded-[3px] bg-black/70 px-1 py-px text-[10px] leading-tight text-white/90">{t(`covers.safe_${r.label}`)}</span>
        </div>
      ))}
      {crop ? (
        <div className="absolute border-2 border-dashed border-[var(--accent)]" style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}>
          <span className="absolute left-1 top-1 rounded-[3px] bg-black/70 px-1 py-px text-[10px] leading-tight text-white/90">{t('covers.safe_grid')}</span>
        </div>
      ) : null}
    </div>
  );
}
