/**
 * The Community library's home: each kind a tile of its own colour, its name and how many packs it has, its mark large
 * at the corner, turning upright under the pointer.
 */
import { useT } from '@/i18n';
import { KindIcon, type FeatureKind } from '../feature-kinds';

/** Each kind of the library's things a colour of its own. */
const KIND_HUE: Partial<Record<FeatureKind, number>> = { media: 200, template: 262, text: 214, sticker: 330, effect: 188, transition: 22, filter: 42, sound: 152, music: 292 };

/** A kind's colour as a tile's light: a glow at the upper right over a deep gradient. */
const tileBackground = (hue: number) =>
  `radial-gradient(120% 140% at 85% 30%, hsl(${hue} 85% 58% / 0.55), transparent 55%), linear-gradient(135deg, hsl(${hue} 70% 34%), hsl(${(hue + 40) % 360} 75% 16%))`;

/** One kind on the home: its name, how many packs (or that it is coming), its mark large at the corner. */
export function KindTile({ kind, name, packs, onOpen }: { kind: FeatureKind; name: string; packs: number; onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onOpen} data-store-kind={kind}
      className="group relative h-[118px] min-w-0 overflow-hidden rounded-[18px] p-4 text-left text-white shadow-[0_8px_24px_rgba(0,0,0,0.22)] outline-none transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,0,0,0.32)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{ background: tileBackground(KIND_HUE[kind] ?? 220) }}>
      <div className="relative z-[1] text-[17px] font-semibold tracking-[-0.01em]">{name}</div>
      <div className="relative z-[1] mt-0.5 text-[12.5px] text-white/70">
        {packs ? t('assetDrawer.packsCountShort').replace('{n}', packs.toLocaleString()) : t('assetDrawer.comingSoon')}
      </div>
      <span className="absolute -bottom-3 -right-2 rotate-[-12deg] text-white/85 transition duration-300 group-hover:rotate-0 group-hover:scale-105"><KindIcon kind={kind} size={76} /></span>
    </button>
  );
}
