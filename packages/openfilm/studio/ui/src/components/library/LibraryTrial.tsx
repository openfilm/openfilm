/**
 * A thing of the library tried in the viewer (a click in the assets drawer, LibraryDrawer), over the picture there and
 * nothing written: a page laid over it; a sticker, and a text look or motion on the words a new line says, in the box
 * it gets when put in (libraryBox), so the try looks as the drop will; a transition played on the film's own picture
 * (OnPicture: its page over it, its dip or dissolve, its camera move), never on the library's sample; a filter grading
 * the whole picture through a backdrop-filter, as it will on its own track. A click on it lets it go. A template's
 * example plays in its place with its music, sharp, under controls of its own (TemplateTrial).
 */
import * as React from 'react';
import { Pause, Play, X } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { TEXT_COMPONENT, builtInItem, BUILT_IN, defaultTextWords, libraryBox, libraryUrl, nameOf, pageUrl, previewUrl, type LibraryItem } from '@/lib/library';
import { TransitionOnPicture } from './OnPicture';

/* a motion tried again and again: in, a while shown, out */
const MOTION_SECONDS = 2.6;

export function LibraryTrial({ item, frame = null, onLetGo }: {
  item: LibraryItem;
  /** the film's picture at the playhead (else the person's own in the project), for what moves the picture itself */
  frame?: string | null;
  onLetGo: () => void;
}) {
  if (item.kind === 'group') return <TemplateTrial key={item.id} item={item} onLetGo={onLetGo} />;
  return <PictureTrial item={item} frame={frame} onLetGo={onLetGo} />;
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
    <div ref={measure} data-library-trial="" className="absolute inset-0 z-[6] cursor-default overflow-hidden" onPointerDown={(e) => { e.stopPropagation(); onLetGo(); }}>
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
      {item.cat === 'transition' ? <TransitionOnPicture item={item} picture={frame} playing live blur={0.35} /> : null}
    </div>
  );
}

const clock = (s: number) => { const n = Math.max(0, Math.floor(s)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };

/**
 * A template's example in the viewer, as it plays put in: the whole of it at 1280×720 with its music (a published part
 * of the library, fetched the first time; its card's small silent preview while that cannot be had), over the film,
 * which it hides. Its own controls: what is previewed and a close, play and pause (a click on it, Space), where it is
 * and how long it runs, a bar to move in it. Esc, the close or the film played lets it go.
 */
function TemplateTrial({ item, onLetGo }: { item: LibraryItem; onLetGo: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const video = React.useRef<HTMLVideoElement>(null);
  const [src, setSrc] = React.useState(() => libraryUrl(`examples/${item.id}.mp4`));
  const [playing, setPlaying] = React.useState(true);
  const [time, setTime] = React.useState(0);
  const [length, setLength] = React.useState((item.durationMs ?? 0) / 1000);
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
    if (v.paused) void v.play().catch(() => {}); else v.pause();
  };
  const toggleRef = React.useRef(toggle);
  toggleRef.current = toggle;
  const letGo = React.useRef(onLetGo);
  letGo.current = onLetGo;
  /* Space plays and pauses it, not the film; Esc lets it go (before the editor's own keys) */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const at = e.target as HTMLElement | null;
      if (at && (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName))) return;
      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); toggleRef.current(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); letGo.current(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const seek = (s: number) => { const v = video.current; if (v) { v.currentTime = s; setTime(s); } };
  return (
    <div data-library-trial="" data-template-trial={item.id} className="absolute inset-0 z-[6] cursor-default overflow-hidden bg-black" onPointerDown={(e) => { e.stopPropagation(); toggle(); }}>
      <video
        ref={video}
        src={src}
        autoPlay
        loop
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration)) setLength(e.currentTarget.duration); }}
        /* the example not had (offline, not published yet): the card's own preview */
        onError={() => setSrc((was) => (was === previewUrl(item) ? was : previewUrl(item)))}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
      />
      <div onPointerDown={stop} className="absolute left-2 top-2 flex h-7 items-center gap-1.5 rounded-md bg-black/60 pl-2.5 pr-1 text-[12px] text-white/90 backdrop-blur-sm">
        <span>{t('assetDrawer.previewing')}</span>
        <span className="text-white/40">·</span>
        <span className="max-w-[16em] truncate">{nameOf(item.name, lang)}</span>
        <button type="button" data-template-trial-close="" title={t('assetDrawer.closePreview')} aria-label={t('assetDrawer.closePreview')} onClick={onLetGo} className="ml-0.5 grid h-5 w-5 place-items-center rounded text-white/70 hover:bg-white/15 hover:text-white">
          <X size={13} strokeWidth={2.2} />
        </button>
      </div>
      <div onPointerDown={stop} className="absolute inset-x-2 bottom-2 flex h-8 items-center gap-2 rounded-md bg-black/60 px-1.5 text-[11px] tabular-nums text-white/85 backdrop-blur-sm">
        <button type="button" data-template-trial-play={playing ? 'playing' : 'paused'} title={t(playing ? 'assetDrawer.pause' : 'assetDrawer.play')} aria-label={t(playing ? 'assetDrawer.pause' : 'assetDrawer.play')} onClick={toggle} className="grid h-6 w-6 shrink-0 place-items-center rounded text-white hover:bg-white/15">
          {playing ? <Pause size={13} strokeWidth={2.4} fill="currentColor" /> : <Play size={13} strokeWidth={2.4} fill="currentColor" />}
        </button>
        <span data-template-trial-time="">{clock(time)}</span>
        <input
          type="range"
          min={0}
          max={length || 1}
          step={0.01}
          value={Math.min(time, length || 1)}
          aria-label={nameOf(item.name, lang)}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--accent)]"
        />
        <span className="text-white/55">{clock(length)}</span>
      </div>
    </div>
  );
}
