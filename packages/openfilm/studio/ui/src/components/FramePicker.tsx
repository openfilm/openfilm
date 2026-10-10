/**
 * The aspect ratio button beside the picture. What it changes depends on how far the film has got.
 *
 * Canvas mode (`mode='canvas'`, nothing made yet): it changes the stage itself. No coordinate can break yet, and a
 * person picking 9:16 now means "this film is vertical" — so the film's stage really changes (`onCanvas`), and the
 * agent lays out vertically from then on.
 *
 * Delivery mode (`mode='delivery'`, the film has content): it changes the frame around the film. The film is fitted
 * in with black bars; film.html is untouched (see lib/film-frame). The choice is kept per project
 * (`useDeliveryFrame`).
 *
 * Each item draws its shape rather than only a ratio: a row of small boxes tells landscape from portrait at a glance.
 */
import * as React from 'react';
import { Check, Proportions } from 'lucide-react';
import { useT } from '@/i18n';
import {
  FILM_FRAME_IDS,
  filmFrameOf,
  filmFrameRatio,
  filmFrameStage,
  readFilmFrame,
  writeFilmFrame,
  type FilmFrameId,
} from '@/lib/film-frame';
import { Tooltip } from './Tooltip';

/** Which layer the button changes: the film's canvas, or the delivery frame around it. */
export type FramePickerMode = 'canvas' | 'delivery';

export function FramePicker({
  stage, value, mode, busy, onDelivery, onCanvas,
}: {
  stage: { w: number; h: number };
  /** The delivery frame now. Ignored in canvas mode, where the current one is the canvas's own shape. */
  value: FilmFrameId;
  mode: FramePickerMode;
  /** The canvas change is being written: no second one meanwhile (two requests would race for one file). */
  busy?: boolean;
  /** Delivery mode: a frame was picked (persist it with `useDeliveryFrame`). */
  onDelivery: (next: FilmFrameId) => void;
  /**
   * Canvas mode: change the film's stage to this ratio; `size` is the stage it should become (1080p family, see
   * filmFrameStage). If the film has gained content meanwhile, fall back to the delivery frame instead.
   */
  onCanvas: (next: FilmFrameId, size: { w: number; h: number }) => void;
}): React.ReactElement {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement | null>(null);
  const canvas = mode === 'canvas';
  /* the canvas has no "native" to pick: the canvas is native. The tick goes on the item shaped like it. */
  const items = canvas ? FILM_FRAME_IDS.filter((id) => id !== 'native') : FILM_FRAME_IDS;
  const current = canvas ? filmFrameOf(stage) : value;

  React.useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  const pick = (id: FilmFrameId) => {
    if (canvas) onCanvas(id, filmFrameStage(stage, id));
    else onDelivery(id);
  };

  return (
    <div ref={box} className="relative flex items-center">
      <Tooltip label={t(canvas ? 'viewer.canvas' : 'viewer.frame')}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          /* no focus on click: the next Space would land on this button instead of playing */
          onMouseDown={(e) => e.preventDefault()}
          className={`flex h-[22px] items-center gap-1 rounded-md px-1.5 text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${
            busy ? 'opacity-50' : ''
          }`}
          aria-label={t(canvas ? 'viewer.canvas' : 'viewer.frame')}
          aria-expanded={open}
        >
          <Proportions size={14} />
          {/* the ratio is printed on the button: "this film is vertical now" must be visible without opening it */}
          {current !== 'native' ? (
            <span className="text-[12px] leading-none tabular-nums">{current}</span>
          ) : null}
        </button>
      </Tooltip>
      {open ? (
        <div
          className="absolute bottom-[28px] right-0 z-50 w-[164px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-lg)]"
        >
          {/* picking does not close the menu: a ratio is judged by looking at the result, often two or three in a row */}
          {items.map((id) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => pick(id)}
              onMouseDown={(e) => e.preventDefault()}
              className="flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left text-[12px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-40"
            >
              <ShapeChip ratio={filmFrameRatio(id, stage)} />
              <span className="flex-1">{id === 'native' ? t('viewer.frameNative') : id}</span>
              {current === id ? <Check size={13} className="shrink-0 text-[var(--accent)]" /> : null}
            </button>
          ))}
          {canvas ? (
            <p className="px-2 pb-1 pt-1.5 text-[10.5px] leading-snug text-[var(--text-faint)]">
              {t('viewer.canvasNote')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A small box drawn to the ratio: the long side 16px, the short side follows. */
function ShapeChip({ ratio }: { ratio: number }) {
  const w = ratio >= 1 ? 16 : 16 * ratio;
  const h = ratio >= 1 ? 16 / ratio : 16;
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      <span
        className="rounded-[2px] border border-current opacity-70"
        style={{ width: Math.max(4, w), height: Math.max(4, h) }}
      />
    </span>
  );
}

/** The project's delivery frame, kept in localStorage `openfilm.frame.<projectId>`. */
export function useDeliveryFrame(projectId: string): [FilmFrameId, (next: FilmFrameId) => void] {
  const [frame, setFrame] = React.useState<FilmFrameId>(() => readFilmFrame(projectId));
  React.useEffect(() => { setFrame(readFilmFrame(projectId)); }, [projectId]);
  const set = React.useCallback((next: FilmFrameId) => {
    setFrame(next);
    writeFilmFrame(projectId, next);
  }, [projectId]);
  return [frame, set];
}
