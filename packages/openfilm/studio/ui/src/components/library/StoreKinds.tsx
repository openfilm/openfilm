/**
 * The Community library's home: each kind a quiet tile, its name and how many packs it has, and its packs' covers fanned
 * at the right (spreading under the pointer); a kind with none yet shows its mark there instead. A faint tint of the
 * kind's own colour keeps the nine apart without shouting.
 */
import { useT } from '@/i18n';
import { KindIcon, type FeatureKind } from '../feature-kinds';

/** Each kind of the library's things a colour of its own, used only as a faint light. */
const KIND_HUE: Partial<Record<FeatureKind, number>> = { media: 200, template: 262, text: 214, sticker: 330, effect: 188, transition: 22, filter: 42, sound: 152, music: 292 };

/** Three covers fanned: their turn and offset at rest, and spread under the pointer. */
const FAN = [
  { rest: 'translate-x-[-34px] rotate-[-10deg]', open: 'group-hover:translate-x-[-52px] group-hover:rotate-[-14deg]' },
  { rest: 'translate-x-[-12px] rotate-[3deg]', open: 'group-hover:translate-x-[-18px] group-hover:rotate-[2deg]' },
  { rest: 'translate-x-[10px] rotate-[12deg]', open: 'group-hover:translate-x-[18px] group-hover:rotate-[16deg]' },
];

/** One kind on the home: its name, how many packs (or that it is coming), its packs' covers or its mark. */
export function KindTile({ kind, name, packs, covers, onOpen }: { kind: FeatureKind; name: string; packs: number; covers: readonly string[]; onOpen: () => void }) {
  const t = useT();
  const hue = KIND_HUE[kind] ?? 220;
  const shown = covers.slice(0, 3);
  return (
    <button type="button" onClick={onOpen} data-store-kind={kind}
      className="group relative flex h-[112px] min-w-0 items-center overflow-hidden rounded-[16px] px-5 text-left outline-none ring-1 ring-[var(--border)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(0,0,0,0.3)] hover:ring-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{ background: `radial-gradient(90% 140% at 100% 50%, hsl(${hue} 55% 45% / 0.22), transparent 70%), linear-gradient(180deg, #242424, #1b1b1b)` }}>
      <span className="relative z-[1] min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold tracking-[-0.01em] text-[var(--text)]">{name}</span>
        <span className="mt-1 block text-[12.5px] tabular-nums text-[var(--text-faint)]">
          {packs ? t('assetDrawer.packsCountShort').replace('{n}', packs.toLocaleString()) : t('assetDrawer.comingSoon')}
        </span>
      </span>
      <span aria-hidden className="relative mr-3 grid h-[72px] w-[96px] shrink-0 place-items-center">
        {shown.length ? shown.map((src, i) => {
          const at = FAN[shown.length === 1 ? 1 : shown.length === 2 ? i + (i ? 1 : 0) : i]!;
          return (
            <img key={src} src={src} alt="" loading="lazy" draggable={false}
              className={`absolute h-[64px] w-[64px] rounded-[10px] object-cover shadow-[0_6px_16px_rgba(0,0,0,0.45)] ring-1 ring-white/10 transition-transform duration-300 ease-out ${at.rest} ${at.open}`} />
          );
        }) : (
          <span className="text-white/30 transition duration-300 group-hover:scale-110 group-hover:text-white/45"><KindIcon kind={kind} size={44} /></span>
        )}
      </span>
    </button>
  );
}
