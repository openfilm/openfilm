/**
 * The Community library's kinds before they hold anything: their packs and things drawn empty, in each kind's own
 * shape (moving pictures wide, stickers and sounds square, words long, sounds in a list), so every kind has its place
 * now and fills as its way in and its way to publish are settled.
 */
import { useT } from '@/i18n';
import { KindIcon, type FeatureKind } from '../feature-kinds';
import { ASSET_GRID, packGrid, shapeOf } from './CommunityViews';

const BAR = 'block rounded-full bg-[var(--bg-field)]';
/* a place drawn empty: an outline, never a filled card, so it is not taken for something still loading */
const SLOT = 'grid place-items-center rounded-[12px] border border-dashed border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--bg-field)_45%,transparent)] text-[var(--text-faint)]';

/** "Coming soon", beside a section's name. */
export function SoonPill() {
  const t = useT();
  return <span className="ml-2 inline-flex h-5 items-center rounded-full bg-[var(--bg-field)] px-2 align-middle text-[11px] font-medium text-[var(--text-faint)]">{t('assetDrawer.comingSoon')}</span>;
}

/** A kind's packs, empty: their pictures' places with the kind's mark, a name and a count under each. */
export function GhostPacks({ kind, count }: { kind: FeatureKind; count: number }) {
  const square = shapeOf(kind) === 'sound' || shapeOf(kind) === 'sticker';
  return (
    <div aria-hidden className={packGrid(kind)} data-store-ghost={kind}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="min-w-0">
          <div className={`${SLOT} ${square ? 'aspect-square' : 'aspect-video'}`}>
            <KindIcon kind={kind} size={22} />
          </div>
          <span className={`${BAR} mt-3 h-2.5 w-3/5 opacity-60`} />
        </div>
      ))}
    </div>
  );
}

/** A kind's things, empty, laid out as its things will be: a grid of pictures, or a list to hear. */
export function GhostThings({ kind, count }: { kind: FeatureKind; count: number }) {
  const shape = shapeOf(kind);
  if (shape === 'sound') {
    return (
      <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-x-6" data-store-ghost={kind}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-dashed border-[var(--border-strong)] text-[var(--text-faint)] opacity-60"><KindIcon kind={kind} size={14} /></span>
            <span className={`${BAR} h-3`} style={{ width: `${38 + ((i * 17) % 30)}%` }} />
            <span className={`${BAR} ml-auto h-2.5 w-10 opacity-70`} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden className={ASSET_GRID[shape]} data-store-ghost={kind}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="min-w-0">
          <div className={`${SLOT} ${shape === 'sticker' ? 'aspect-square' : shape === 'words' ? 'aspect-[2/1]' : 'aspect-video'}`}>
            <KindIcon kind={kind} size={18} />
          </div>
          <span className={`${BAR} mt-2 h-2.5 ${shape === 'sticker' ? 'mx-auto w-1/2' : 'w-3/5'}`} />
        </div>
      ))}
    </div>
  );
}
