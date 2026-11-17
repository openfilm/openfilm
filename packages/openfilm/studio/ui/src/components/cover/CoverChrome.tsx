/**
 * The cover design's own parts around the picture (lib/covers): the tile beside the edit's main track that opens it,
 * its top bar (a tab for each shape the film has a cover in, the safe areas, the feed preview), what is under the
 * picture (undo, a picture of this computer or made with AI, the strip of the film a moment is taken from, Cancel and
 * Set as cover), the cover as a feed shows it, and the places a platform's buttons cover it.
 */
import React from 'react';
import { Grid2x2, Maximize, PanelTopOpen, PenLine, Plus, Redo2, Sparkles, Undo2 } from 'lucide-react';
import { useT } from '@/i18n';
import { ContextMenu, type ContextMenuEntry } from '../ContextMenu';
import { COVER_SHAPES, FEED_WIDTH, coverThumb, filmThumb, safeAreas, shapeOf, type CoverInfo, type CoverShape } from '@/lib/covers';

const clock = (s: number, fine = false) => {
  const m = Math.floor(s / 60), sec = s - m * 60;
  return fine ? `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}` : `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
};

/** A shape drawn as a small outline, its ratio at a glance. */
export function ShapeMark({ shape, size = 14 }: { shape: CoverShape; size?: number }) {
  const k = size / Math.max(shape.w, shape.h);
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden>
      <span className="block rounded-[2px] border-[1.5px] border-current" style={{ width: Math.round(shape.w * k), height: Math.round(shape.h * k) }} />
    </span>
  );
}

/**
 * In a column of the heads' side, right of the track heads and left of the line before the clips, by the main track: a square, the film's cover (its picture, or a
 * dashed box with a pen and "Cover" while it has none). A click opens the cover design; its menu opens it, makes the
 * frame at the playhead the cover's picture, or exports the covers.
 */
export function CoverTile({ thumb, size, gutter, onOpen, menu }: {
  thumb: string | null; size: number; gutter: number; onOpen: () => void; menu: () => ContextMenuEntry[];
}) {
  const t = useT();
  const [at, setAt] = React.useState<{ x: number; y: number } | null>(null);
  /* a square, in the middle of its column */
  const w = size;
  return (
    <>
      <button type="button" data-cover-tile="" onClick={(e) => { e.stopPropagation(); onOpen(); }}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setAt({ x: e.clientX, y: e.clientY }); }}
        title={thumb ? t('covers.tileTip') : t('covers.tileNewTip')}
        className={`group absolute top-1/2 z-10 flex -translate-y-1/2 flex-col items-center justify-center overflow-hidden rounded-[7px] text-[11.5px] transition ${thumb
          ? 'bg-black text-white shadow-[0_0_0_1px_var(--border-strong)] hover:shadow-[0_0_0_1.5px_var(--accent)]'
          : 'gap-1 border border-dashed border-[var(--border-strong)] bg-[var(--bg-field)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text)]'}`}
        style={{ width: w, height: size, left: `calc(100% + ${Math.round((gutter - w) / 2)}px)` }}>
        {thumb ? (
          <>
            <img src={thumb} alt="" draggable={false} className="min-h-0 w-full flex-1 object-cover" />
            <span className="flex h-[17px] w-full shrink-0 items-center justify-center bg-black/75 text-[10.5px] leading-none">{t('covers.title')}</span>
          </>
        ) : <><PenLine size={15} strokeWidth={1.8} /><span>{t('covers.title')}</span></>}
      </button>
      {at ? <ContextMenu x={at.x} y={at.y} items={menu()} onClose={() => setAt(null)} /> : null}
    </>
  );
}

/** The cover design's header (its window's top): its name, a tab for each shape the film has a cover in (the main one first), a new shape, the safe areas, the feed preview. */
export function CoverTopBar({ covers, current, main, thumbOf, safe, feed, onOpen, onAddShape, onMain, onExport, onSafe, onFeed }: {
  covers: readonly CoverInfo[];
  current: string;
  main: string | null;
  thumbOf: (cover: CoverInfo) => string;
  safe: boolean;
  feed: boolean;
  onOpen: (cover: CoverInfo) => void;
  onAddShape: (shape: CoverShape) => void;
  onMain: (cover: CoverInfo) => void;
  onExport: (folders: string[]) => void;
  onSafe: (on: boolean) => void;
  onFeed: (on: boolean) => void;
}) {
  const t = useT();
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const tabMenu = (cover: CoverInfo): ContextMenuEntry[] => [
    { id: 'main', label: t('covers.setMain'), checked: cover.folder === main, onSelect: () => onMain(cover) },
    { id: 'export', label: t('covers.exportThis'), onSelect: () => onExport([cover.folder]) },
    { id: 'all', label: t('covers.menuExport'), onSelect: () => onExport(covers.map((c) => c.folder)) },
  ];
  const addMenu = (): ContextMenuEntry[] => COVER_SHAPES.map((s) => ({
    id: s.id, label: `${t(`covers.shape_${s.id}`)} ${s.ratio}`, note: t(`covers.where_${s.id}`), onSelect: () => onAddShape(s),
  }));
  return (
    <div data-cover-topbar="" className="@container flex h-[60px] shrink-0 items-center gap-1 px-5 text-[12.5px]">
      <span className="mr-4 shrink-0 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">{t('covers.designTitle')}</span>
      <div role="tablist" aria-label={t('covers.shapes')} className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {[...covers].sort((a, b) => Number(b.folder === main) - Number(a.folder === main)
          || COVER_SHAPES.indexOf(shapeOf(a.stage)) - COVER_SHAPES.indexOf(shapeOf(b.stage))).map((c) => {
          const s = shapeOf(c.stage);
          const on = c.folder === current;
          return (
            <button key={c.folder} type="button" role="tab" aria-selected={on} data-cover-tab={c.folder}
              onClick={() => { if (!on) onOpen(c); }}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: tabMenu(c) }); }}
              title={`${t(`covers.shape_${s.id}`)} ${s.ratio} · ${t(`covers.where_${s.id}`)}${c.folder === main ? ` · ${t('covers.mainTip')}` : ''}`}
              className={`group flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 transition ${on ? 'bg-[var(--bg-pressed)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
              <img src={thumbOf(c)} alt="" draggable={false} className="h-[18px] max-w-[32px] rounded-[2px] object-contain" />
              <span className="whitespace-nowrap"><span className="hidden @[900px]:inline">{t(`covers.shape_${s.id}`)} </span><span className={on ? '' : 'text-[var(--text-faint)]'}>{s.ratio}</span></span>
              {c.folder === main ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-label={t('covers.mainTip')} /> : null}
            </button>
          );
        })}
        <button type="button" data-cover-add="" title={t('covers.addShapeTip')}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, items: addMenu() }); }}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <Plus size={13} /><span className="hidden @[640px]:inline">{t('covers.addShape')}</span>
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
        <Toggle on={safe} onClick={() => onSafe(!safe)} icon={<Grid2x2 size={14} />} label={t('covers.safe')} tip={t('covers.safeTip')} />
        <Toggle on={feed} onClick={() => onFeed(!feed)} icon={<PanelTopOpen size={14} />} label={t('covers.feed')} tip={t('covers.feedTip')} />
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

function Toggle({ on, onClick, icon, label, tip }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; tip: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={tip}
      className={`flex h-7 items-center gap-1.5 rounded-md px-2 transition ${on ? 'bg-[var(--bg-pressed)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
      {icon}<span className="hidden @[760px]:inline">{label}</span>
    </button>
  );
}

/**
 * Under the cover: undo, redo and the picture fitted again; a picture of this computer, one made with AI, or the film as
 * a strip of its moments (a click, or ← → once it has the keyboard, Shift a second at a time, takes that moment; the one
 * taken is marked); and Cancel (the cover put back as it was when the design began) or Set as cover.
 */
export function CoverBottom({ outerId, filmSeconds, frameAt, busy, canUndo, canRedo, onUndo, onRedo, onFill, onMoment, onLocal, onAi, onCancel, onDone }: {
  outerId: string;
  filmSeconds: number | null;
  frameAt: number | null;
  busy: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFill: () => void;
  onMoment: (seconds: number) => void;
  onLocal: (file: File) => void;
  onAi: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const strip = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const [width, setWidth] = React.useState(0);
  const [hover, setHover] = React.useState<number | null>(null);
  React.useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setWidth(el.clientWidth));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  const length = filmSeconds ?? 0;
  const count = width > 0 && length > 0 ? Math.max(1, Math.floor(width / 72)) : 0;
  const at = (clientX: number) => {
    const r = strip.current!.getBoundingClientRect();
    return Math.max(0, Math.min(length, ((clientX - r.left) / r.width) * length));
  };
  const icon = 'flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-35';
  const square = 'flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-[var(--bg-field)] text-[10.5px] transition hover:bg-[var(--bg-hover)] disabled:opacity-50';
  return (
    <div data-cover-bottom="" className="flex shrink-0 flex-col gap-2 px-3 pb-3 pt-1">
      <div className="flex h-7 items-center gap-1 text-[11.5px]">
        <button type="button" className={icon} disabled={!canUndo} onClick={onUndo} title={t('covers.undo')} aria-label={t('covers.undo')}><Undo2 size={15} /></button>
        <button type="button" className={icon} disabled={!canRedo} onClick={onRedo} title={t('covers.redo')} aria-label={t('covers.redo')}><Redo2 size={15} /></button>
        <button type="button" className={`${icon} w-auto gap-1 px-1.5`} onClick={onFill} title={t('covers.fillTip')}><Maximize size={14} />{t('covers.fill')}</button>
        <span className="ml-3 tabular-nums text-[var(--text-faint)]">
          {busy === 'frame' ? t('covers.takingFrame') : hover != null ? clock(hover, true) : frameAt != null ? `${t('covers.ofFilm')} ${clock(frameAt, true)}` : t('covers.pickFrame')}
        </span>
      </div>
      <div className="flex items-stretch gap-2">
        <button type="button" className={`${square} text-[var(--text-muted)] hover:text-[var(--text)]`} disabled={busy != null} onClick={() => input.current?.click()} title={t('covers.localTip')}>
          <Plus size={16} /><span>{t('covers.localShort')}</span>
        </button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onLocal(f); }} />
        <button type="button" data-cover-ai-open="" className={`${square} text-[var(--accent)]`} disabled={busy === 'picture'} onClick={onAi} title={t('covers.aiTitle')}>
          <Sparkles size={16} /><span>{busy === 'picture' ? t('covers.working') : t('covers.aiShort')}</span>
        </button>
        <div ref={strip} role="slider" tabIndex={0} aria-label={t('covers.pickFrame')} aria-valuemin={0} aria-valuemax={length} aria-valuenow={frameAt ?? 0} data-cover-strip=""
          className={`relative h-14 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-lg bg-[var(--bg-field)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${busy === 'frame' ? 'opacity-60' : ''}`}
          onPointerMove={(e) => length > 0 && setHover(at(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => { if (length > 0 && busy == null) onMoment(at(e.clientX)); }}
          onKeyDown={(e) => {
            if (busy != null || length <= 0 || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
            e.preventDefault();
            e.stopPropagation();
            const step = (e.shiftKey ? 1 : 1 / 25) * (e.key === 'ArrowLeft' ? -1 : 1);
            onMoment(Math.max(0, Math.min(length, (frameAt ?? 0) + step)));
          }}>
          <div className="absolute inset-0 flex">
            {Array.from({ length: count }, (_, i) => (
              <img key={i} src={filmThumb(outerId, ((i + 0.5) / count) * length * 1000)} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
            ))}
          </div>
          {hover != null && length > 0 ? <span className="pointer-events-none absolute inset-y-0 w-px bg-white/80" style={{ left: `${(hover / length) * 100}%` }} /> : null}
          {frameAt != null && length > 0 ? (
            <span data-cover-taken="" className="pointer-events-none absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full bg-[#ffcc00] shadow-[0_0_0_1px_rgba(0,0,0,.6)]"
              style={{ left: `${(Math.min(frameAt, length) / length) * 100}%` }} />
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" data-cover-cancel="" onClick={onCancel} disabled={busy === 'finish'}
          className="h-8 rounded-md bg-[var(--bg-field)] px-4 text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50">{t('covers.cancel')}</button>
        <button type="button" data-cover-done="" onClick={onDone} disabled={busy === 'finish'}
          className="h-8 rounded-md bg-[var(--accent)] px-4 text-[12.5px] font-semibold text-black transition hover:brightness-110 disabled:opacity-50">{t('covers.setAsCover')}</button>
      </div>
    </div>
  );
}

/** The cover as a feed shows it: at the size it is seen there, its title under it. */
export function CoverFeed({ projectId, cover, title, inline = false }: { projectId: string; cover: CoverInfo; title: string;
  /** in a column of its own (the design's side), not over the picture's corner */
  inline?: boolean }) {
  const t = useT();
  const shape = shapeOf(cover.stage);
  const w = FEED_WIDTH[shape.id];
  return (
    <div data-cover-feed="" className={inline ? 'mx-auto max-w-full rounded-lg bg-[var(--bg-field)] p-2'
      : 'pointer-events-none absolute right-3 top-3 z-20 hidden rounded-lg @[760px]:block bg-[var(--bg-raised)] p-2 shadow-[0_8px_24px_rgba(0,0,0,.45),0_0_0_1px_var(--border)]'} style={{ width: w + 16 }}>
      <div className="mb-1.5 text-[10.5px] text-[var(--text-faint)]">{t('covers.feedTitle')}</div>
      <img src={coverThumb(projectId, cover, 480)} alt="" className="w-full rounded-[4px]" />
      <div className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-[var(--text)]">{title}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 rounded-full bg-[var(--bg-field)]" /><span className="h-1.5 w-12 rounded bg-[var(--bg-field)]" />
      </div>
    </div>
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
        <div key={r.label} className="absolute flex items-start justify-start border border-dashed border-white/70 bg-[repeating-linear-gradient(135deg,rgba(0,0,0,.34)_0_6px,rgba(0,0,0,.16)_6px_12px)]"
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
