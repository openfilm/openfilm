/**
 * A thing of the library tried in the viewer (a click in the assets drawer, LibraryDrawer), over the picture there and
 * nothing written: a page laid over it; a sticker, and a text look or motion on the words a new line says, in the box
 * it gets when put in (libraryBox), so the try looks as the drop will; a transition's preview. A look is tried on the clip itself, through
 * the stage's look preview. A click on it lets it go.
 */
import * as React from 'react';
import { useLanguage } from '@/i18n';
import { TEXT_COMPONENT, builtInItem, BUILT_IN, defaultTextWords, libraryBox, nameOf, pageUrl, previewUrl, type LibraryItem } from '@/lib/library';

/* a motion tried again and again: in, a while shown, out */
const MOTION_SECONDS = 2.6;

export function LibraryTrial({ item, onLetGo }: { item: LibraryItem; onLetGo: () => void }) {
  const lang = useLanguage();
  const text = item.kind === 'textstyle' || item.kind === 'textmotion';
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
    ? `${pageUrl(component)}?vars=${encodeURIComponent(JSON.stringify({ '--clip-length': `${MOTION_SECONDS}s`, ...(item.vars ?? {}) }))}&words=${encodeURIComponent(defaultTextWords(lang))}`
    : page ? pageUrl(item) : null;
  return (
    <div ref={measure} data-library-trial="" className="absolute inset-0 z-[6] cursor-default overflow-hidden" onPointerDown={(e) => { e.stopPropagation(); onLetGo(); }}>
      {src && (!shape || box) ? (
        <iframe
          key={round}
          title={nameOf(item.name, lang)}
          src={src}
          className={`pointer-events-none absolute border-0 ${box ? '' : 'inset-0 h-full w-full'}`}
          style={box ? { left: box.x, top: box.y, width: box.w, height: box.h, colorScheme: 'normal' } : { colorScheme: 'normal' }}
        />
      ) : null}
      {/* a transition, a template (its places filled with photos) and a clip's motion, as drawn: they need clips to be seen */}
      {item.cat === 'transition' || item.kind === 'group' || item.kind === 'motion' ? <video src={previewUrl(item)} autoPlay loop muted playsInline className="pointer-events-none absolute inset-0 h-full w-full object-cover" /> : null}
    </div>
  );
}
