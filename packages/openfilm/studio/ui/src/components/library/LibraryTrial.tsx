/**
 * A thing of the library tried in the viewer (a click in the assets drawer, LibraryDrawer), over the picture there and
 * nothing written: a page laid over it (a sticker in its middle, at a size it can be seen); a text look or motion on
 * the text component's own words, in the middle; a transition's preview. A look is tried on the clip itself, through
 * the stage's look preview. A click on it lets it go.
 */
import * as React from 'react';
import { useLanguage } from '@/i18n';
import { TEXT_COMPONENT, builtInItem, BUILT_IN, nameOf, pageUrl, previewUrl, type LibraryItem } from '@/lib/library';

/* a motion tried again and again: in, a while shown, out */
const MOTION_SECONDS = 2.6;

export function LibraryTrial({ item, onLetGo }: { item: LibraryItem; onLetGo: () => void }) {
  const lang = useLanguage();
  const text = item.kind === 'textstyle' || item.kind === 'textmotion';
  const page = (item.kind === 'page' && item.cat !== 'transition') || text;
  /* a sticker has a size of its own: shown as a third of the picture's height, in its middle */
  const sticker = item.kind === 'page' && item.w && item.h;
  /* a motion is shown from its start again, each time it has gone */
  const [round, setRound] = React.useState(0);
  React.useEffect(() => {
    if (item.kind !== 'textmotion') return undefined;
    const timer = window.setInterval(() => setRound((r) => r + 1), (MOTION_SECONDS + 0.6) * 1000);
    return () => window.clearInterval(timer);
  }, [item]);
  const component = text ? builtInItem(`${BUILT_IN}/${TEXT_COMPONENT}`) : null;
  const src = text && component
    ? `${pageUrl(component)}?vars=${encodeURIComponent(JSON.stringify({ '--clip-length': `${MOTION_SECONDS}s`, ...(item.vars ?? {}) }))}`
    : page ? pageUrl(item) : null;
  return (
    <div data-library-trial="" className="absolute inset-0 z-[6] cursor-default overflow-hidden" onPointerDown={(e) => { e.stopPropagation(); onLetGo(); }}>
      {src ? (
        <iframe
          key={round}
          title={nameOf(item.name, lang)}
          src={src}
          className={`pointer-events-none border-0 ${sticker ? 'absolute left-1/2 top-1/2 h-[36%] -translate-x-1/2 -translate-y-1/2' : 'absolute inset-0 h-full w-full'}`}
          style={sticker ? { aspectRatio: `${item.w} / ${item.h}`, colorScheme: 'normal' } : { colorScheme: 'normal' }}
        />
      ) : null}
      {item.cat === 'transition' ? <video src={previewUrl(item)} autoPlay loop muted playsInline className="pointer-events-none absolute inset-0 h-full w-full object-cover" /> : null}
    </div>
  );
}
