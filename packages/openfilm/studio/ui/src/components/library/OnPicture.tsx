/**
 * A transition of the library played on a picture: the person's own (the film's at the playhead, else theirs in the
 * project), else a plain one, never the library's sample. A dissolve into the picture turned round, a dip to black or
 * white and back, a cut's camera move (out, then in: lib/clip-presets cutCardKeyframes), two shots moving at once (a
 * push, a wipe: the picture going out by the move's `out` while the picture turned round comes in by its `in`, over
 * black), a transition's page over it.
 * On a card (LibraryDrawer) the picture is drawn under it; over the viewer (LibraryTrial, `live`) the film is, and only
 * what moves is drawn. Played again and again while `playing`, a moment between; with `onEnded`, once.
 */
import * as React from 'react';
import { pageUrl, type LibraryItem } from '@/lib/library';
import { cardBody, cutCardKeyframes } from '@/lib/clip-presets';

/** The picture with none of the person's own: a quiet light on a gradient. */
export const PLAIN = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><defs>'
  + '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34404f"/><stop offset="0.55" stop-color="#6a5d55"/><stop offset="1" stop-color="#c79f77"/></linearGradient>'
  + '<radialGradient id="s" cx="0.68" cy="0.32" r="0.36"><stop offset="0" stop-color="#ffe8c4" stop-opacity="0.85"/><stop offset="1" stop-color="#ffe8c4" stop-opacity="0"/></radialGradient>'
  + '</defs><rect width="320" height="320" fill="url(#g)"/><rect width="320" height="320" fill="url(#s)"/></svg>',
)}`;

const STYLE = `
@keyframes of-dissolve { 0%, 15% { opacity: 0 } 65%, 100% { opacity: 1 } }
@keyframes of-dip { 0%, 10% { opacity: 0 } 50% { opacity: 1 } 90%, 100% { opacity: 0 } }`;

/** How long one round of it takes, s. */
/** How long a two-shot move waits before it starts and after it ends, s. */
const LAP_HOLD = 0.35;

function secsOf(item: LibraryItem): number {
  if (item.kind === 'motion' && item.lap) return (item.motion?.in?.secs ?? 0.6) + 2 * LAP_HOLD;
  if (item.kind === 'motion') return (item.motion?.out?.secs ?? 0.35) + (item.motion?.in?.secs ?? 0.35);
  if (item.kind === 'fade') return 1.2;
  return (item.durationMs ?? 1000) / 1000;
}

export function TransitionOnPicture({ item, picture, playing, live = false, blur = 0.15, onEnded }: {
  item: LibraryItem;
  /** the picture it plays on (null: the plain one) */
  picture: string | null;
  playing: boolean;
  /** over the film itself: only what moves is drawn */
  live?: boolean;
  /** a card's blurs, of a stage's */
  blur?: number;
  /** played once, then nothing is drawn and this is told */
  onEnded?: () => void;
}) {
  const [round, setRound] = React.useState(0);
  const secs = secsOf(item);
  const once = Boolean(onEnded);
  const told = React.useRef(onEnded);
  told.current = onEnded;
  /* a page's time starts when it has loaded */
  const [begun, setBegun] = React.useState(item.kind !== 'page');
  const [ended, setEnded] = React.useState(false);
  React.useEffect(() => {
    if (!playing) return undefined;
    if (once) {
      if (!begun) return undefined;
      const timer = window.setTimeout(() => { setEnded(true); told.current?.(); }, secs * 1000);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setInterval(() => setRound((r) => r + 1), (secs + 0.6) * 1000);
    return () => window.clearInterval(timer);
  }, [playing, secs, once, begun]);
  const src = picture ?? PLAIN;
  const img = (style?: React.CSSProperties) => <img src={src} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" style={style} />;
  const name = `of-cut-${item.id.replace(/[^a-z0-9]+/gi, '-')}`;
  const moving = (() => {
    if (!playing || ended) return null;
    if (item.kind === 'fade') {
      if (item.fade === 'dissolve') return img({ transform: 'scaleX(-1)', animation: `of-dissolve ${secs}s ease-in-out both` });
      return <span className="pointer-events-none absolute inset-0" style={{ background: item.fade === 'dip-white' ? '#fff' : '#000', animation: `of-dip ${secs}s ease-in-out both` }} />;
    }
    if (item.kind === 'motion' && item.lap && item.motion?.in) {
      const into = item.motion.in;
      const out = item.motion.out;
      /* each picture in a box that moves (the move's own transform in the screen's directions), the one coming in
         turned round inside its box */
      const box = (anim: string | undefined, turned: boolean) => (
        <span className="pointer-events-none absolute inset-0 overflow-hidden" style={anim ? { animation: anim } : undefined}>
          {img(turned ? { transform: 'scaleX(-1)' } : undefined)}
        </span>
      );
      return (
        <>
          <style>{`@keyframes ${name}-in { ${cardBody(into.body, blur)} }${out ? ` @keyframes ${name}-out { ${cardBody(out.body, blur)} }` : ''}`}</style>
          <span className="pointer-events-none absolute inset-0 bg-black" />
          {box(out ? `${name}-out ${out.secs}s ${out.ease} ${LAP_HOLD}s both` : undefined, false)}
          {box(`${name}-in ${into.secs}s ${into.ease} ${LAP_HOLD}s both`, true)}
        </>
      );
    }
    if (item.kind === 'motion' && item.motion?.out && item.motion.in) {
      return (
        <>
          <style>{`@keyframes ${name} { ${cutCardKeyframes(item.motion.out, item.motion.in, blur)} }`}</style>
          {img({ animation: `${name} ${secs}s linear both` })}
        </>
      );
    }
    if (item.kind === 'page' && item.src) {
      return <iframe title="" src={pageUrl(item)} tabIndex={-1} onLoad={() => setBegun(true)} className="pointer-events-none absolute inset-0 h-full w-full border-0" style={{ colorScheme: 'normal' }} />;
    }
    return null;
  })();
  return (
    <>
      <style>{STYLE}</style>
      {/* on a card, the picture under it (a camera move draws its own, moving) */}
      {!live && !(playing && item.kind === 'motion') ? img() : null}
      {moving ? <React.Fragment key={round}>{moving}</React.Fragment> : null}
    </>
  );
}

