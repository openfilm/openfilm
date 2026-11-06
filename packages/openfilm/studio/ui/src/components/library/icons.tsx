/**
 * The assets drawer's category icons, drawn for OpenFilm: a 24 px grid, 1.6 px round strokes. The one shown (`on`) is
 * solid: its main shape filled in its own color, the marks inside it cut out of it in the panel's color (an open
 * shape, the sound's burst and the text's letter, is drawn bolder instead), so the shown category reads at a glance
 * without a box behind it.
 */
import React from 'react';

/** `fill`: the main shape's; `ink`: the marks inside it; `cut`: a solid mark inside it */
type Paint = { fill: React.SVGProps<SVGPathElement>; ink: React.SVGProps<SVGPathElement>; cut: React.SVGProps<SVGPathElement> };
type Draw = (p: Paint) => React.ReactNode;

const DRAWN: Record<string, Draw> = {
  /* footage: a frame in front of another, playing */
  media: ({ fill, cut }) => (
    <>
      <path d="M7 3.6h11.4A2.6 2.6 0 0 1 21 6.2v8.4" />
      <path d="M5.6 6.8h10.8a2.6 2.6 0 0 1 2.6 2.6v8.2a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 17.6V9.4a2.6 2.6 0 0 1 2.6-2.6Z" {...fill} />
      <path d="M9.4 10.6v5.2l4.3-2.6Z" {...cut} />
    </>
  ),
  /* a voice: a speech bubble, a voice's wave in it */
  voice: ({ fill, ink }) => (
    <>
      <path d="M6.6 4h10.8A2.6 2.6 0 0 1 20 6.6v7.8a2.6 2.6 0 0 1-2.6 2.6H10.6L6.4 20.4V17h0.2A2.6 2.6 0 0 1 4 14.4V6.6A2.6 2.6 0 0 1 6.6 4Z" {...fill} />
      <path d="M8.4 9.4v2.2M10.8 7.8v5.4M13.2 8.8v3.4M15.6 9.8v1.4" {...ink} />
    </>
  ),
  /* a sound: a short burst, struck once */
  sound: () => (
    <>
      <path d="M3.5 12h2.2l2-5 3.1 10 2.4-7.2 1.6 2.2h2" />
      <path d="M19.4 8.6l1.6-1.4M19.6 12h2M19.4 15.4l1.6 1.4" />
    </>
  ),
  /* music: a record, its groove and label */
  music: ({ fill, ink }) => (
    <>
      <circle cx="12" cy="12" r="8.4" {...(fill as React.SVGProps<SVGCircleElement>)} />
      <circle cx="12" cy="12" r="2.4" {...(ink as React.SVGProps<SVGCircleElement>)} />
      <path d="M12 6.4a5.6 5.6 0 0 1 5.4 4.1" {...ink} />
    </>
  ),
  /* text: a title letter, and lines of words beside it */
  text: () => (
    <>
      <path d="M3.6 6.4V5h10.2v1.4M8.7 5v14M6.8 19h3.8" />
      <path d="M15.6 10.6h4.8M15.6 14.6h4.8M13.6 18.6h6.8" />
    </>
  ),
  /* captions: a picture, two lines of words along its foot */
  captions: ({ fill, ink }) => (
    <>
      <path d="M5.6 4.6h12.8A2.6 2.6 0 0 1 21 7.2v9.6a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 16.8V7.2a2.6 2.6 0 0 1 2.6-2.6Z" {...fill} />
      <path d="M7 12.4h5.2M14.6 12.4H17M7 15.6h2.6M12 15.6h5" {...ink} />
    </>
  ),
  /* a sticker: its corner peeling */
  sticker: ({ fill, ink }) => (
    <>
      <path d="M20.2 12.6V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v10.2a3 3 0 0 0 3 3h5.6Z" {...fill} />
      <path d="M12.6 20.2c0-4.2 3.4-7.6 7.6-7.6h-3.6a4 4 0 0 0-4 4Z" />
      <path d="M8.4 9.2v.2M12.4 9.2v.2M8 13c.9 1.1 2.6 1.4 3.9.6" {...ink} />
    </>
  ),
  /* a filter: a lens, tinted in bands */
  filter: ({ fill, ink }) => (
    <>
      <circle cx="12" cy="12" r="8.2" {...(fill as React.SVGProps<SVGCircleElement>)} />
      <path d="M8.2 4.9v14.2M12 3.8v16.4M15.8 4.9v14.2" {...ink} />
    </>
  ),
  /* an effect: a spark, and a smaller one */
  effect: ({ fill }) => (
    <>
      <path d="M9.8 3.4 11.6 8l4.6 1.8-4.6 1.8-1.8 4.6L8 11.6 3.4 9.8 8 8Z" {...fill} />
      <path d="m17.4 13.6.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9Z" {...fill} />
    </>
  ),
  /* a transition: one picture wiping to the next */
  transition: ({ fill }) => (
    <>
      <path d="M5.6 5.6h7.6l-3.4 12.8H5.6A2.6 2.6 0 0 1 3 15.8V8.2a2.6 2.6 0 0 1 2.6-2.6Z" {...fill} />
      <path d="M15.6 5.6h2.8A2.6 2.6 0 0 1 21 8.2v7.6a2.6 2.6 0 0 1-2.6 2.6h-6.2" />
      <path d="M17 9.6l-1.6 4.8" />
    </>
  ),
  /* a skill: a bolt, what it adds at once */
  skill: ({ fill }) => (
    <path d="M13.4 3 5.6 13.2h5.6L10.4 21l8-10.4h-5.6Z" {...fill} />
  ),
  /* a template: a picture laid out, one big place and two small */
  template: ({ fill, ink }) => (
    <>
      <path d="M5.6 3.8h12.8A2.6 2.6 0 0 1 21 6.4v11.2a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 17.6V6.4a2.6 2.6 0 0 1 2.6-2.6Z" {...fill} />
      <path d="M13 3.8v16.4M13 12h8" {...ink} />
    </>
  ),
};

/* the marks inside a solid shape are cut out of it in the panel's own color */
const SOLID: Paint = { fill: { fill: 'currentColor' }, ink: { stroke: 'var(--bg-panel)' }, cut: { fill: 'var(--bg-panel)', stroke: 'var(--bg-panel)' } };
const LINE: Paint = { fill: {}, ink: {}, cut: { fill: 'currentColor' } };

export function CategoryIcon({ id, on, size = 22 }: { id: string; on: boolean; size?: number }) {
  const draw = DRAWN[id];
  if (!draw) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {draw(on ? SOLID : LINE)}
    </svg>
  );
}

/** What the drawer shows where it has nothing: a box with a star (no favorites), a record (no music yet), a lens (nothing found). */
function EmptyIcon({ kind }: { kind: 'star' | 'music' | 'search' }) {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 14.5h32v22a3.5 3.5 0 0 1-3.5 3.5h-25A3.5 3.5 0 0 1 8 36.5Z" />
      <path d="M12 8.5h24" />
      {kind === 'star' ? <path d="m24 20.5 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7Z" fill="currentColor" stroke="none" />
        : kind === 'music' ? <><circle cx="24" cy="27" r="7" /><circle cx="24" cy="27" r="1.6" fill="currentColor" stroke="none" /></>
          : <><circle cx="22.5" cy="25.5" r="5.5" /><path d="m26.5 29.5 4 4" /></>}
    </svg>
  );
}

/** Where a list has nothing: why, and what to do instead. */
export function Empty({ icon, text, action, onAction }: { icon: 'star' | 'music' | 'search'; text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 pt-16 text-center text-[var(--text-faint)]">
      <EmptyIcon kind={icon} />
      <p className="text-[12.5px] leading-relaxed">
        {text}
        {action ? <> <button type="button" onClick={onAction} className="font-medium text-[var(--accent)] hover:underline">{action}</button></> : null}
      </p>
    </div>
  );
}
