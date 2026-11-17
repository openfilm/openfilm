/**
 * The Community library's home: each kind a card of its own, drawn in black and white as what the kind is (footage as
 * film frames, a template as a layout, text as letters, a sticker peeling, an effect sparkling, a transition wiping, a
 * filter splitting a picture, a sound as its waveform, music as a record), its name and how many packs it has.
 */
import { useT } from '@/i18n';
import type { FeatureKind } from '../feature-kinds';

const INK = 'rgba(245,245,240,0.92)';
const DIM = 'rgba(245,245,240,0.28)';

/** A kind drawn as what it is, on a 160×100 canvas. */
function KindArt({ kind }: { kind: FeatureKind }) {
  const art: Partial<Record<FeatureKind, React.ReactNode>> = {
    media: <>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${34 + i * 16} ${18 + i * 8})`} opacity={0.45 + i * 0.27}>
          <rect width="64" height="44" rx="4" fill="#141414" stroke={INK} strokeWidth="1.6" />
          {[6, 18, 30, 42, 54].map((x) => <rect key={x} x={x} y="3" width="5" height="3" rx="1" fill={INK} />)}
          {[6, 18, 30, 42, 54].map((x) => <rect key={x} x={x} y="38" width="5" height="3" rx="1" fill={INK} />)}
        </g>
      ))}
      <path d="M95 49 l12 7 -12 7z" fill={INK} />
    </>,
    template: <>
      <rect x="38" y="16" width="84" height="68" rx="5" fill="none" stroke={INK} strokeWidth="1.6" />
      <rect x="44" y="22" width="44" height="34" rx="3" fill={INK} opacity="0.9" />
      <rect x="92" y="22" width="24" height="15" rx="3" fill={DIM} />
      <rect x="92" y="41" width="24" height="15" rx="3" fill={DIM} />
      <rect x="44" y="62" width="72" height="5" rx="2.5" fill={INK} opacity="0.7" />
      <rect x="44" y="71" width="46" height="5" rx="2.5" fill={DIM} />
    </>,
    text: <>
      <text x="80" y="70" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="60" fontWeight="700" fill={INK}>Aa</text>
      <rect x="44" y="80" width="72" height="3" rx="1.5" fill={DIM} />
    </>,
    sticker: <>
      <path d="M80 16 l9 19 21 3 -15 15 4 21 -19 -10 -19 10 4 -21 -15 -15 21 -3z" fill={INK} />
      <path d="M99 74 q-10 -2 -13 8" fill="none" stroke="#141414" strokeWidth="5" />
      <path d="M95 66 l12 8 -9 7z" fill={DIM} />
    </>,
    effect: <>
      {[[80, 50, 22], [48, 30, 9], [114, 28, 11], [110, 74, 7], [50, 74, 6]].map(([x, y, r], i) => (
        <path key={i} d={`M${x} ${y! - r!} Q${x} ${y} ${x! + r!} ${y} Q${x} ${y} ${x} ${y! + r!} Q${x} ${y} ${x! - r!} ${y} Q${x} ${y} ${x} ${y! - r!}z`} fill={INK} opacity={i ? 0.55 : 1} />
      ))}
    </>,
    transition: <>
      <rect x="30" y="20" width="100" height="60" rx="5" fill={DIM} />
      <path d="M30 25 a5 5 0 0 1 5 -5 h55 l-30 60 h-25 a5 5 0 0 1 -5 -5z" fill={INK} />
      <path d="M90 20 l-30 60" stroke="#141414" strokeWidth="3" />
    </>,
    filter: <>
      <circle cx="66" cy="50" r="28" fill={INK} opacity="0.9" />
      <circle cx="94" cy="50" r="28" fill="none" stroke={INK} strokeWidth="1.6" />
      <path d="M80 26 a28 28 0 0 1 0 48 a28 28 0 0 1 0 -48z" fill="#141414" />
    </>,
    sound: <>
      {Array.from({ length: 23 }, (_, i) => {
        const h = 6 + Math.abs(Math.sin(i * 1.7) * 34) * Math.exp(-Math.pow((i - 11) / 8, 2));
        return <rect key={i} x={36 + i * 4} y={50 - h / 2} width="2.2" height={h} rx="1.1" fill={INK} />;
      })}
    </>,
    music: <>
      <circle cx="80" cy="50" r="36" fill="#0d0d0d" stroke={DIM} />
      {[30, 25, 20].map((r) => <circle key={r} cx="80" cy="50" r={r} fill="none" stroke={DIM} strokeWidth="0.8" />)}
      <circle cx="80" cy="50" r="12" fill={INK} />
      <circle cx="80" cy="50" r="2" fill="#0d0d0d" />
      <path d="M122 16 v26 a7 6 0 1 1 -4 -5.5 v-20.5z" fill={INK} />
    </>,
  };
  return <svg viewBox="0 0 160 100" aria-hidden className="h-full w-full">{art[kind] ?? null}</svg>;
}

/** One kind on the home: its drawing, its name, how many packs (or that it is coming). */
export function KindTile({ kind, name, packs, onOpen }: { kind: FeatureKind; name: string; packs: number; onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onOpen} data-store-kind={kind}
      className="group relative flex aspect-[4/3] min-w-0 flex-col overflow-hidden rounded-[16px] p-3 text-left ring-1 ring-[var(--border)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(0,0,0,0.35)] hover:ring-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{ background: 'radial-gradient(120% 100% at 50% 0%, #262626 0%, #161616 60%, #111 100%)' }}>
      <span className={`min-h-0 flex-1 transition duration-300 group-hover:scale-[1.04] ${packs ? '' : 'opacity-60'}`}><KindArt kind={kind} /></span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[15px] font-semibold text-[var(--text)]">{name}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-[var(--text-faint)]">
          {packs ? t('assetDrawer.packsCountShort').replace('{n}', packs.toLocaleString()) : t('assetDrawer.comingSoon')}
        </span>
      </span>
    </button>
  );
}
