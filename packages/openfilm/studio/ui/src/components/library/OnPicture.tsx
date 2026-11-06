/**
 * A transition of the library played on a picture: the person's own (the film's at the playhead, else theirs in the
 * project), else a plain one, never the library's sample. A dissolve into the picture turned round, a dip to black or
 * white and back, a cut's camera move (out, then in: lib/clip-presets cutCardKeyframes), a transition's page over it.
 * On a card (LibraryDrawer) the picture is drawn under it; over the viewer (LibraryTrial, `live`) the film is, and only
 * what moves is drawn. Played again and again while `playing`, a moment between. A template the same way: its title
 * page where the template puts it, on the picture.
 */
import * as React from 'react';
import { libraryUrl, pageUrl, placedGroup, type LibraryItem } from '@/lib/library';
import { cutCardKeyframes } from '@/lib/clip-presets';

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
function secsOf(item: LibraryItem): number {
  if (item.kind === 'motion') return (item.motion?.out?.secs ?? 0.35) + (item.motion?.in?.secs ?? 0.35);
  if (item.kind === 'fade') return 1.2;
  return (item.durationMs ?? 1000) / 1000;
}

export function TransitionOnPicture({ item, picture, playing, live = false, blur = 0.15 }: {
  item: LibraryItem;
  /** the picture it plays on (null: the plain one) */
  picture: string | null;
  playing: boolean;
  /** over the film itself: only what moves is drawn */
  live?: boolean;
  /** a card's blurs, of a stage's */
  blur?: number;
}) {
  const [round, setRound] = React.useState(0);
  const secs = secsOf(item);
  React.useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setRound((r) => r + 1), (secs + 0.6) * 1000);
    return () => window.clearInterval(timer);
  }, [playing, secs]);
  const src = picture ?? PLAIN;
  const img = (style?: React.CSSProperties) => <img src={src} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" style={style} />;
  const name = `of-cut-${item.id.replace(/[^a-z0-9]+/gi, '-')}`;
  const moving = (() => {
    if (!playing) return null;
    if (item.kind === 'fade') {
      if (item.fade === 'dissolve') return img({ transform: 'scaleX(-1)', animation: `of-dissolve ${secs}s ease-in-out both` });
      return <span className="pointer-events-none absolute inset-0" style={{ background: item.fade === 'dip-white' ? '#fff' : '#000', animation: `of-dip ${secs}s ease-in-out both` }} />;
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
      return <iframe title="" src={pageUrl(item)} tabIndex={-1} className="pointer-events-none absolute inset-0 h-full w-full border-0" style={{ colorScheme: 'normal' }} />;
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

type GroupClip = { track: number; at: number; clip: Record<string, unknown> & { src?: string; attrs?: Record<string, string>; size?: { w: number; h: number } } };
/* each template's group as the library has it, read once */
const groups = new Map<string, Promise<GroupClip[]>>();
const groupOf = (id: string) => {
  let read = groups.get(id);
  if (!read) {
    read = fetch(libraryUrl(`${id}/saved.json`)).then((r) => (r.ok ? r.json() : null)).then((g: { clips?: GroupClip[] } | null) => g?.clips ?? [], () => []);
    groups.set(id, read);
  }
  return read;
};

/**
 * A template of the library on a picture: the person's own (else a plain one), with its title, the first page of it
 * that says words of its own, drawn where the template puts it for a picture of this shape; played again while
 * `playing`. Over the viewer (`live`), the title alone.
 */
export function TemplateOnPicture({ item, picture, playing, live = false }: { item: LibraryItem; picture: string | null; playing: boolean; live?: boolean }) {
  const [title, setTitle] = React.useState<GroupClip | null>(null);
  React.useEffect(() => {
    let alive = true;
    void groupOf(item.id).then((clips) => {
      const first = clips
        .filter((c) => c.clip.attrs?.['data-place'] && c.clip.size?.w && /"type":\s*"text"/.test(c.clip.attrs?.['data-props'] ?? ''))
        .sort((a, b) => a.at - b.at)[0];
      if (alive) setTitle(first ?? null);
    });
    return () => { alive = false; };
  }, [item.id]);
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
  const [round, setRound] = React.useState(0);
  React.useEffect(() => {
    if (!playing) return undefined;
    setRound((r) => r + 1);
    const timer = window.setInterval(() => setRound((r) => r + 1), 3200);
    return () => window.clearInterval(timer);
  }, [playing]);
  const own = title?.clip.size;
  const box = title && size && own ? (placedGroup([title as never], size)[0] as unknown as GroupClip).clip.box as { x: number; y: number; w: number; h: number } | undefined : undefined;
  const src = title?.clip.src ? `/api/library/pages/${`${item.id}/files/${title.clip.src}`.split('/').map(encodeURIComponent).join('/')}` : null;
  return (
    <div ref={measure} className="pointer-events-none absolute inset-0 overflow-hidden">
      {live ? null : <img src={picture ?? PLAIN} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}
      {box && own && src ? (
        <div className="absolute overflow-hidden" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
          <iframe key={round} title="" src={src} loading="lazy" tabIndex={-1} className="absolute left-0 top-0 border-0"
            style={{ width: own.w, height: own.h, transform: `scale(${box.w / own.w})`, transformOrigin: '0 0', colorScheme: 'normal' }} />
        </div>
      ) : null}
    </div>
  );
}
