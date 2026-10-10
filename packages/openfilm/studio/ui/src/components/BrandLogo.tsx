import React from 'react';

/*
 * The mark: a playhead over two clips, forming an F, in the surrounding text's color. The clips are cut away around
 * the playhead (a real gap, so whatever is behind shows through), which keeps the playhead's shape in one color.
 */
const VIEWBOX = '8 6 84 92';
const PLAYHEAD = 'M17 12H37Q40 12 40 15V27Q40 29 38.5 30.5L31 37V88Q31 92 27 92Q23 92 23 88V37L15.5 30.5Q14 29 14 27V15Q14 12 17 12Z';

export function BrandLogo({ size = 18 }: { size?: number }) {
  const gap = `openfilm-gap-${React.useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox={VIEWBOX} fill="currentColor" className="block shrink-0" role="img" aria-label="OpenFilm">
      <mask id={gap} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <rect width="100" height="100" fill="#fff" />
        <path d={PLAYHEAD} stroke="#000" strokeWidth="7" strokeLinejoin="round" />
      </mask>
      <g mask={`url(#${gap})`}>
        <rect x="22" y="12" width="64" height="20" rx="5" />
        <rect x="25" y="44" width="47" height="19" rx="5" />
      </g>
      <path d={PLAYHEAD} />
    </svg>
  );
}
