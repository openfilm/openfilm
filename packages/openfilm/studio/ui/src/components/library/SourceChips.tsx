/**
 * Where the library's things come from, wherever they are listed: OpenFilm's own (official), the community's (sent to
 * the library by others, each with who sent it), and the person's own (mine). A list that mixes them has a row of
 * chips under its search, All and each source it has; a thing not OpenFilm's own wears its source on its corner.
 */
import { useT } from '@/i18n';

export type Source = 'official' | 'community' | 'mine';
const ORDER: Source[] = ['official', 'community', 'mine'];

/** The sources the things have, in the chips' order. */
export const sourcesIn = (sources: Iterable<Source>) => { const had = new Set(sources); return ORDER.filter((s) => had.has(s)); };

/** All, and each source there is: shown only when there are two or more. */
export function SourceChips({ sources, value, onChange }: { sources: Source[]; value: Source | ''; onChange: (next: Source | '') => void }) {
  const t = useT();
  if (sources.length < 2) return null;
  const chip = (id: Source | '', label: string) => (
    <button key={id || 'all'} type="button" aria-pressed={value === id} onClick={() => onChange(id)}
      className={`h-6 rounded-full border px-2.5 text-[11px] transition ${value === id ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2" role="group" aria-label={t('assetDrawer.source')}>
      {chip('', t('assetDrawer.all'))}
      {sources.map((s) => chip(s, t(`assetDrawer.source_${s}`)))}
    </div>
  );
}

/** A thing's source on its corner (none for OpenFilm's own): its source's name, or who made it (`by`). */
export function SourceBadge({ source, by }: { source: Source; by?: string }) {
  const t = useT();
  if (source === 'official') return null;
  return (
    <span className="pointer-events-none absolute left-1 top-1 max-w-[calc(100%-8px)] truncate rounded-[4px] bg-black/55 px-1.5 py-[1px] text-[10px] font-medium text-white">
      {by ?? t(`assetDrawer.source_${source}`)}
    </span>
  );
}
