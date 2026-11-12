/**
 * A thing of the library tried in the viewer (a click in the assets drawer, LibraryDrawer), over the picture there and
 * nothing written: a page laid over it; a sticker, and a text look or motion on the words a new line says, in the box
 * it gets when put in (libraryBox), so the try looks as the drop will; a transition played once on the film's own
 * picture (OnPicture: its page over it, its dip or dissolve, its camera move), never on the library's sample, the film
 * free again when it has played; a filter grading
 * the whole picture through a backdrop-filter, as it will on its own track. A click on it lets it go. A template's
 * example plays in its place with its music, sharp, under controls of its own (TemplateTrial).
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, RotateCw } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { TEXT_COMPONENT, builtInItem, BUILT_IN, defaultTextWords, libraryBox, nameOf, pageUrl, previewUrl, templatePreviewUrl, type LibraryItem } from '@/lib/library';
import { TransitionOnPicture } from './OnPicture';
import { useAssetPlaybackKey } from './AudioList';
import { PANE_BAR, PANE_BTN, PANE_ICON } from '../dock-pane-bar';

/* a motion tried again and again: in, a while shown, out */
const MOTION_SECONDS = 2.6;

export type TemplatePreviewState = 'failed' | null;

export function LibraryTrial({ item, frame = null, target, onLetGo, onTemplateState, onDownloadFailed }: {
  item: LibraryItem;
  frame?: string | null;
  target: HTMLDivElement | null;
  onLetGo: () => void;
  onTemplateState: (id: string, state: TemplatePreviewState) => void;
  onDownloadFailed: () => void;
}) {
  const lang = useLanguage();
  if (item.kind === 'group') return <TemplateTrial item={item} target={target} onLetGo={onLetGo} onState={onTemplateState} onFailed={onDownloadFailed} />;
  const name = nameOf(item.name, lang);
  return <>
    <PictureTrial item={item} frame={frame} onLetGo={onLetGo} />
    {target ? createPortal(
      <div className={`${PANE_BAR} px-3`} data-library-picture-bar="">
        <span className="truncate text-[12px] text-[var(--text)]" title={name}>{name}</span>
      </div>, target,
    ) : null}
  </>;
}

function PictureTrial({ item, frame, onLetGo }: { item: LibraryItem; frame: string | null; onLetGo: () => void }) {
  const lang = useLanguage();
  /* a line of words in a look or a motion, or in the page's own */
  const text = item.kind === 'textstyle' || item.kind === 'textmotion' || item.id === TEXT_COMPONENT;
  const page = (item.kind === 'page' && item.cat !== 'transition') || text;
  const component = text ? builtInItem(`${BUILT_IN}/${TEXT_COMPONENT}`) : null;
  /* a sticker or a line of words has a shape of its own: shown in the box a drop gives it (a style without one in the
     line of words' own) */
  const shape = item.w && item.h ? item : text ? component : null;
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const seen = React.useRef<ResizeObserver | null>(null);
  const measure = React.useCallback((el: HTMLDivElement | null) => {
    seen.current?.disconnect();
    if (!el) return;
    const read = () => setSize((s) => (s && s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    read();
    seen.current = new ResizeObserver(read);
    seen.current.observe(el);
  }, []);
  const box = shape && size ? libraryBox(shape, size) : null;
  const [played, setPlayed] = React.useState(false);
  /* a motion is shown from its start again, each time it has gone */
  const [round, setRound] = React.useState(0);
  React.useEffect(() => {
    if (item.kind !== 'textmotion') return undefined;
    const timer = window.setInterval(() => setRound((r) => r + 1), (MOTION_SECONDS + 0.6) * 1000);
    return () => window.clearInterval(timer);
  }, [item]);
  const src = text && component
    ? `${pageUrl(component)}?vars=${encodeURIComponent(JSON.stringify({ '--clip-length': `${MOTION_SECONDS}s`, ...(item.vars ?? {}) }))}&words=${encodeURIComponent(defaultTextWords())}`
    : page ? pageUrl(item) : null;
  return (
    <div ref={measure} data-library-trial="" className={`absolute inset-0 z-[6] cursor-default overflow-hidden ${played ? 'pointer-events-none' : ''}`} onPointerDown={(e) => { e.stopPropagation(); onLetGo(); }}>
      {/* a filter: over the whole picture, grading every layer of it, as it will on its own track */}
      {item.kind === 'look' && item.filter ? <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backdropFilter: item.filter }} /> : null}
      {src && (!shape || box) ? (
        <iframe
          key={round}
          title={nameOf(item.name, lang)}
          src={src}
          className={`pointer-events-none absolute border-0 ${box ? '' : 'inset-0 h-full w-full'}`}
          style={box ? { left: box.x, top: box.y, width: box.w, height: box.h, colorScheme: 'normal' } : { colorScheme: 'normal' }}
        />
      ) : null}
      {/* a transition: on the film's own picture */}
      {item.cat === 'transition' ? <TransitionOnPicture item={item} picture={frame} playing live blur={0.35} onEnded={() => setPlayed(true)} /> : null}
    </div>
  );
}

const clock = (s: number) => { const n = Math.max(0, Math.floor(s)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };

/** A template plays over the film while its transport replaces the one beneath the viewer. */
function TemplateTrial({ item, target, onLetGo, onState, onFailed }: {
  item: LibraryItem; target: HTMLDivElement | null;
  onLetGo: () => void;
  onState: (id: string, state: TemplatePreviewState) => void;
  onFailed: () => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const video = React.useRef<HTMLVideoElement>(null);
  const [src, setSrc] = React.useState(() => templatePreviewUrl(item));
  const [playing, setPlaying] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const wanted = React.useRef(true);
  const [time, setTime] = React.useState(0);
  const [length, setLength] = React.useState((item.durationMs ?? 0) / 1000);
  React.useEffect(() => {
    const v = video.current;
    /* StrictMode replays effect cleanup on the same element. Restore the source before its second setup. */
    if (v && !v.hasAttribute('src')) v.src = src;
    return () => { if (v) { v.pause(); v.removeAttribute('src'); v.load(); } };
  }, []);
  React.useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    const tick = () => { if (video.current) setTime(video.current.currentTime); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (!failed && (loading || !v.paused)) { wanted.current = false; v.pause(); setLoading(false); return; }
    wanted.current = true;
    setLoading(true);
    setFailed(false);
    if (failed) v.load();
    void v.play().catch((error) => { if (wanted.current && error?.name !== 'AbortError') { setLoading(false); setFailed(true); } });
  };
  useAssetPlaybackKey(Boolean(target), toggle);
  React.useEffect(() => {
    onState(item.id, failed ? 'failed' : null);
  }, [item.id, failed, onState]);
  const reportFailure = React.useRef(onFailed);
  reportFailure.current = onFailed;
  React.useEffect(() => { if (failed) reportFailure.current(); }, [failed]);
  const seek = (s: number) => { const v = video.current; if (v) { v.currentTime = s; setTime(s); } };
  const name = nameOf(item.name, lang);
  const label = t(failed ? 'assetDrawer.previewRetry' : playing || loading ? 'assetDrawer.pause' : 'assetDrawer.play');
  return (<>
    <div data-library-trial="" data-template-trial={item.id} className="absolute inset-0 z-[6] grid cursor-default grid-cols-1 grid-rows-1 place-items-center overflow-hidden bg-black"
      onPointerDown={(e) => { e.stopPropagation(); onLetGo(); }}>
      <video
        ref={video}
        data-asset-preview-control=""
        onPointerDown={(e) => { e.stopPropagation(); toggle(); }}
        src={src}
        autoPlay={wanted.current}
        loop
        playsInline
        onLoadStart={() => { if (wanted.current) setLoading(true); }}
        onPlaying={(e) => {
          if (!wanted.current) { e.currentTarget.pause(); return; }
          setPlaying(true); setLoading(false); setFailed(false);
        }}
        onWaiting={() => { if (wanted.current) { setLoading(true); setPlaying(false); } }}
        onPause={() => { setPlaying(false); setLoading(false); }}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) setLength(e.currentTarget.duration);
        }}
        /* the example not had (offline, not published yet): the card's own preview */
        onError={() => {
          if (src !== previewUrl(item)) { setSrc(previewUrl(item)); if (wanted.current) setLoading(true); }
          else { setLoading(false); setPlaying(false); setFailed(true); }
        }}
        className="block max-h-full max-w-full object-contain"
      />
    </div>
    {target ? createPortal(
      <div data-template-trial-bar="" className={`${PANE_BAR} gap-2 px-2 text-[11px] tabular-nums text-[var(--text)]`}>
        <button type="button" data-template-trial-play={playing ? 'playing' : 'paused'} title={label} aria-label={label}
          onMouseDown={(e) => e.preventDefault()} onClick={toggle} className={PANE_BTN}>
          {failed ? <RotateCw size={PANE_ICON} />
            : playing || loading ? <Pause size={PANE_ICON} fill="currentColor" /> : <Play size={PANE_ICON} fill="currentColor" />}
        </button>
        <span className="min-w-0 max-w-[36%] truncate text-[12px]" title={name}>{name}</span>
        <span data-template-trial-time="" className="shrink-0 text-[var(--text-muted)]">{clock(time)}</span>
        <input
          type="range"
          min={0}
          max={length || 1}
          step={0.01}
          value={Math.min(time, length || 1)}
          aria-label={t('assetDrawer.seek')}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={loading || failed || !length}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--accent)] disabled:opacity-40"
        />
        <span className="shrink-0 text-[var(--text-faint)]">{clock(length)}</span>
      </div>, target,
    ) : null}
  </>);
}
