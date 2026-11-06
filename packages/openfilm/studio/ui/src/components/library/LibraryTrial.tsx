/**
 * A thing of the library tried in the viewer (a click in the assets drawer, LibraryDrawer), over the picture there and
 * nothing written: a page laid over it; a sticker, and a text look or motion on the words a new line says, in the box
 * it gets when put in (libraryBox), so the try looks as the drop will; a transition played on the film's own picture
 * (OnPicture: its page over it, its dip or dissolve, its camera move), never on the library's sample; a template's
 * title over it; a filter grading the whole picture through a backdrop-filter, as it will on its own track. A click
 * on it lets it go.
 */
import * as React from 'react';
import { useLanguage } from '@/i18n';
import { TEXT_COMPONENT, builtInItem, BUILT_IN, defaultTextWords, libraryBox, nameOf, pageUrl, type LibraryItem } from '@/lib/library';
import { TemplateOnPicture, TransitionOnPicture } from './OnPicture';

/* a motion tried again and again: in, a while shown, out */
const MOTION_SECONDS = 2.6;

export function LibraryTrial({ item, frame = null, onLetGo }: {
  item: LibraryItem;
  /** the film's picture at the playhead (else the person's own in the project), for what moves the picture itself */
  frame?: string | null;
  onLetGo: () => void;
}) {
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
      {/* a template: its title over the film, where it puts it */}
      {item.kind === 'group' ? <TemplateOnPicture item={item} picture={frame} playing live /> : null}
    </div>
  );
}
