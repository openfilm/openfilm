/**
 * How the Community (components/PluginsWindow, library/PluginsPane) shows each kind of thing, each as what it is: a
 * workbench as a card with its mark large; a skill as a card with its cover (PluginsPane StoreCard);
 * a connector as a line; templates, effects, transitions and looks as moving pictures; stickers as a sheet of
 * stickers; text styles in words; sounds and music as a list to listen to. And Mine's own: the person's workbenches as
 * tiles they put in order by dragging (the order of the top right's switch and its keys), and what an agent brings of
 * its own folded into one line until opened. A page's parts share one header (Shelf, as library/Store StoreSection).
 */
import * as React from 'react';
import { AudioLines, BadgeCheck, Check, ChevronDown, ChevronRight, GripVertical, Music, type LucideIcon } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { KindIcon, type FeatureKind } from '../feature-kinds';
import type { Plugin } from '@/lib/plugins';
import { byOpenFilm, libraryUrl, makerName, nameOf, posterUrl, previewUrl, templatePreviewUrl, TEXT_COMPONENT, type LibraryItem } from '@/lib/library';
import { AppIcon } from '../AppIcon';
import { WorkbenchMark } from '../WorkbenchMark';
import { PLAIN } from './OnPicture';
import { TextStyleSample } from './TextStyleSample';

type Lang = ReturnType<typeof useLanguage>;

/** A small word beside a title: Beta, Coming soon. */
export const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-[var(--text-muted)]">{children}</span>
);

/** What opens a page on a click and on Enter, its own controls left to themselves. */
export const opener = (onOpen?: () => void) => (onOpen ? {
  role: 'button' as const, tabIndex: 0, onClick: onOpen,
  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); },
} : {});
/** A control inside a card: a press there is its own. */
export const Own = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <span className={className} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{children}</span>
);

/** Get, as an app store has it: a pill with the word, its accent on a quiet fill; a spinner while it works. */
export function AddButton({ label, text, onClick, busy = false, disabled = false }: { label: string; text?: string; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  const t = useT();
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled || busy} onClick={onClick} data-get-button=""
      className="inline-flex h-7 min-w-[64px] items-center justify-center rounded-full bg-[var(--bg-pressed)] px-3.5 text-[13px] font-semibold text-[var(--accent)] transition hover:brightness-125 active:scale-[0.97] disabled:opacity-50">
      {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : text ?? t('assetDrawer.get')}
    </button>
  );
}

/** In already, as a list's row says it: the word, quiet (Added, On). */
export const InMark = ({ label }: { label: string }) => (
  <span title={label} className="inline-flex h-7 min-w-[64px] items-center justify-center gap-1 rounded-full bg-[var(--bg-field)] px-3 text-[12.5px] font-medium text-[var(--text-muted)]"><Check size={13} aria-hidden />{label}</span>
);

/** One of the person's workbenches, as Mine's tile shows it. */
export interface BenchTileItem {
  plugin: Plugin; title: string; summary: string; badges?: React.ReactNode;
  /** its key in the top right's menu (⌥1…), when it is there */
  keyHint?: string | undefined;
  control: React.ReactNode; onOpen: () => void;
}

/**
 * The person's workbenches as tiles, in their order: dragged to another place (or moved with ⌥ and an arrow), the
 * order is kept (`onOrder`), and the top right's menu and its keys follow it. One turned off is shown faint.
 */
export function BenchGrid({ items, onOrder }: { items: readonly BenchTileItem[]; onOrder: (ids: string[]) => void }) {
  const t = useT();
  const ids = items.map((it) => it.plugin.id);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<string[] | null>(null);
  const shown = preview ?? ids;
  const byId = new Map(items.map((it) => [it.plugin.id, it]));
  const move = (from: string, to: number) => {
    const next = shown.filter((id) => id !== from);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, from);
    return next;
  };
  const done = () => {
    if (preview && preview.join('\n') !== ids.join('\n')) onOrder(preview);
    setDragging(null);
    setPreview(null);
  };
  return (
    <div className={GROUP} data-bench-grid="">
      {shown.map((id, i) => {
        const it = byId.get(id);
        if (!it) return null;
        const on = it.plugin.on;
        return (
          <div key={id} {...opener(it.onOpen)} draggable data-bench-tile={id} aria-roledescription={t('assetDrawer.benchSortable')}
            onDragStart={(e) => { setDragging(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragging !== id) setPreview(move(dragging, shown.indexOf(id)));
            }}
            onDrop={(e) => { e.preventDefault(); done(); }}
            onDragEnd={done}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target === e.currentTarget) { it.onOpen(); return; }
              if (!e.altKey || e.target !== e.currentTarget) return;
              const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
              if (!step) return;
              e.preventDefault();
              const at = shown.indexOf(id);
              if (at + step < 0 || at + step >= shown.length) return;
              onOrder(move(id, at + step));
              requestAnimationFrame(() => (document.querySelector(`[data-bench-tile="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus());
            }}
            className={`${GROUP_ROW} ${dragging === id ? 'bg-[var(--bg-hover)] opacity-70' : ''}`}>
            <GripVertical size={14} aria-hidden className="-ml-1 -mr-1.5 shrink-0 cursor-grab text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100" />
            <span className={`shrink-0 ${on ? '' : 'opacity-45 grayscale-[.6]'}`}><WorkbenchMark plugin={it.plugin} size={36} /></span>
            <RowText first={i === 0} title={it.title} badges={it.badges} summary={it.summary} dim={!on}
              end={it.keyHint && on ? <kbd className="shrink-0 rounded-[5px] bg-[var(--bg-pressed)] px-1.5 py-0.5 font-sans text-[11px] tabular-nums text-[var(--text-muted)]">{it.keyHint}</kbd> : null}
              control={it.control} />
          </div>
        );
      })}
    </div>
  );
}

/** A group of rows, as Settings has them: rounded, on the field's grey, rows apart by hairlines. */
export const GROUP = 'overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg-field)]';
const GROUP_ROW = 'group flex min-h-[64px] min-w-0 cursor-pointer items-center gap-3.5 pl-4 outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--accent)]';

/** A row's words and its control: its hairline over it (not the first's), from where the words start, as Settings draws it. */
function RowText({ first, title, badges, summary, dim, end, control }: {
  first: boolean; title: string; badges?: React.ReactNode; summary?: string; dim?: boolean; end?: React.ReactNode; control?: React.ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-4 ${first ? '' : 'border-t border-[var(--border)]'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`truncate text-[14px] font-semibold tracking-[-0.01em] ${dim ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{title}</span>
          {badges}
        </div>
        {summary ? <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-muted)]">{summary}</p> : null}
      </div>
      {end}
      {control ? <Own className="flex shrink-0 items-center">{control}</Own> : null}
    </div>
  );
}

/** One row of a group: its icon, its name, a line about it, its control; a click opens its page. */
export interface GroupItem { key: string; icon: React.ReactNode; title: string; badges?: React.ReactNode; summary?: string; control?: React.ReactNode; onOpen?: () => void; dim?: boolean }

/** Rows in a group, as Settings lists things (Mine's skills, what can be updated). */
export function GroupList({ items }: { items: readonly GroupItem[] }) {
  return (
    <div className={GROUP}>
      {items.map((it, i) => (
        <div key={it.key} {...opener(it.onOpen)} data-store-card={it.title} className={GROUP_ROW}>
          <span className={`shrink-0 ${it.dim ? 'opacity-45 grayscale-[.6]' : ''}`}>{it.icon}</span>
          <RowText first={i === 0} title={it.title} badges={it.badges} summary={it.summary} dim={it.dim} control={it.control} />
        </div>
      ))}
    </div>
  );
}

/**
 * What an agent brings of its own (its skills, its connectors), folded into one line until opened: its name, how many
 * there are and how many are let in.
 */
export function FoldedGroup({ icon: Icon, title, count, footnote, children }: {
  icon: LucideIcon; title: React.ReactNode; count: string; footnote?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <section className={`mt-3 ${GROUP}`} data-folded-group="">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--accent)]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[var(--bg-pressed)] text-[var(--text-muted)]"><Icon size={17} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] text-[var(--text)]">{title}</span>
          <span className="block truncate text-[12.5px] text-[var(--text-faint)]">{count}</span>
        </span>
        {open ? <ChevronDown size={16} className="shrink-0 text-[var(--text-faint)]" /> : <ChevronRight size={16} className="shrink-0 text-[var(--text-faint)]" />}
      </button>
      {open ? (
        <div className="border-t border-[var(--border)] px-4 pb-3 pt-1">
          {children}
          {footnote ? <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--text-faint)]">{footnote}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/** How the library's things of a kind are laid out: moving pictures, a sheet of stickers, words, or a list to hear. */
export type AssetShape = 'video' | 'sticker' | 'words' | 'sound';
export const shapeOf = (cat: string): AssetShape => (cat === 'sticker' ? 'sticker' : cat === 'text' ? 'words' : cat === 'sound' || cat === 'music' ? 'sound' : 'video');
export const ASSET_GRID: Record<Exclude<AssetShape, 'sound'>, string> = {
  video: 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-3 gap-y-4',
  sticker: 'grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-2 gap-y-3',
  words: 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-3 gap-y-4',
};

/**
 * One of the library's things as its card in the library draws it: a look on its sample picture, a text style in words
 * of the app's language, a sticker whole, a sound or a piece of music by its mark, the rest by its poster.
 */
export function AssetCover({ item, lang }: { item: LibraryItem; lang: Lang }) {
  if (item.kind === 'sound') return <GradientCover hue={item.cat === 'music' ? 286 : 200} Icon={item.cat === 'music' ? Music : AudioLines} />;
  if (item.kind === 'file' && item.media === 'audio') return <GradientCover Icon={AudioLines} />;
  if (item.kind === 'look') return <img src={item.sample ? libraryUrl(item.sample) : PLAIN} alt="" loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-cover" style={{ filter: item.filter }} />;
  if (item.kind === 'textstyle' || item.id === TEXT_COMPONENT) return <TextStyleSample lang={lang} vars={item.vars} {...(item.id === TEXT_COMPONENT ? { words: nameOf(item.name, lang) } : {})} />;
  return <img src={posterUrl(item)} alt="" loading="lazy" decoding="async" draggable={false} data-sticker-idle={item.idle}
    className={`absolute inset-0 h-full w-full ${item.cat === 'sticker' ? 'object-contain p-3' : 'object-cover'}`} />;
}

/** A picture for what has none: its mark on a default app tile (components/AppIcon), on the field's grey. */
export function GradientCover({ Icon }: { hue?: number; Icon: LucideIcon }) {
  return (
    <div aria-hidden className="absolute inset-0 flex items-center justify-center bg-[var(--bg-field)]">
      <AppIcon kind="skill" mark={Icon} size={56} />
    </div>
  );
}

/** The moving picture of a thing that moves (a template's example, an effect, a transition), else none. */
const movingOf = (item: LibraryItem): string | null => (item.kind === 'file' ? (item.media === 'video' ? libraryUrl(item.id) : null) : item.kind === 'group' ? templatePreviewUrl(item)
  : item.cat === 'effect' || item.cat === 'transition' ? previewUrl(item) : null);

/**
 * One of the library's things in a grid: its picture (moving while pointed at, when it moves), its name and, when
 * someone sent it, whose; its star and its Add on the picture while pointed at (the star stays once starred). A click
 * opens its page.
 */
export function AssetTile({ item, lang, onOpen }: { item: LibraryItem; lang: Lang; onOpen: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [seen, setSeen] = React.useState(false);
  const [still, setStill] = React.useState(false);
  const shape = shapeOf(item.cat);
  /* what moves plays on its own while it is in view (the pack is what is got: nothing to do on a single thing here) */
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const watch = new IntersectionObserver(([entry]) => setSeen(Boolean(entry?.isIntersecting)), { rootMargin: '120px' });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const moving = seen && !still ? movingOf(item) : null;
  const name = nameOf(item.name, lang);
  return (
    <div ref={ref} {...opener(onOpen)} data-store-card={name} className="group min-w-0 cursor-pointer outline-none">
      <div className={`relative overflow-hidden rounded-[14px] bg-[var(--bg-field)] ring-1 ring-[var(--border)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_28px_rgba(0,0,0,0.28)] group-hover:ring-[var(--border-strong)] group-focus-visible:ring-[var(--accent)] ${shape === 'sticker' ? 'aspect-square' : shape === 'words' ? 'aspect-[2/1]' : 'aspect-video'}`}>
        <AssetCover item={item} lang={lang} />
        {moving ? <video key={moving} src={moving} autoPlay muted loop playsInline onError={() => setStill(true)} className="absolute inset-0 h-full w-full object-cover" /> : null}
      </div>
      <div className={`mt-1.5 truncate text-[13px] text-[var(--text)] ${shape === 'sticker' ? 'text-center text-[12px]' : ''}`}>{name}</div>
      {item.by && shape !== 'sticker' ? <div className="flex items-center gap-1 truncate text-[11.5px] text-[var(--text-faint)]">{makerName(item.by)}{byOpenFilm(item.by) ? <BadgeCheck size={11} strokeWidth={2} aria-hidden className="shrink-0" /> : null}</div> : null}
    </div>
  );
}

/**
 * A pack among a kind's things: its picture in the kind's shape (square for sounds, music and stickers), its name and
 * how many it holds, whose when someone sent it; its star and its Add on the picture while pointed at.
 */
export function PackTile({ cover, cat, name, count, by, here, newer = false, onOpen, onAdd }: {
  cover: React.ReactNode; cat: string; name: string; count: string; by?: string | undefined; here: boolean;
  /** got, and the Community has a newer version */
  newer?: boolean;
  onOpen: () => void; onAdd: () => void;
}) {
  const t = useT();
  const square = shapeOf(cat) === 'sound' || shapeOf(cat) === 'sticker';
  /* music as an album: its record behind the sleeve, sliding out under the pointer */
  const album = cat === 'music';
  const sleeve = (
    <div className={`relative overflow-hidden rounded-[14px] bg-[var(--bg-field)] shadow-[0_6px_18px_rgba(0,0,0,0.28)] transition duration-200 group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent)] ${album ? 'aspect-square h-full' : square ? 'aspect-square' : 'aspect-video'}`}>
      {cover}
      {newer ? <span className="absolute left-2 top-2 rounded-full bg-[var(--text)] px-2 py-0.5 text-[11px] font-semibold text-[var(--dialog-main)]">{t('assetDrawer.packNewer')}</span> : null}
    </div>
  );
  return (
    <div {...opener(onOpen)} data-store-card={name} className="group min-w-0 cursor-pointer outline-none">
      {album ? (
        <div className="relative aspect-[1.18/1]">
          <span aria-hidden className="absolute bottom-[5%] left-[22%] top-[5%] aspect-square rounded-full shadow-[0_6px_18px_rgba(0,0,0,0.4)] transition-transform duration-500 ease-out group-hover:translate-x-[6%] group-hover:rotate-[40deg]"
            style={{ background: 'radial-gradient(circle, #f2f2ee 0 13%, #0b0b0b 13.5% 15%, transparent 15.5%), repeating-radial-gradient(circle, #151515 0 2px, #1d1d1d 2px 3px), #111' }} />
          <div className="relative h-full">{sleeve}</div>
        </div>
      ) : sleeve}
      {/* its name, whose and how many it holds; Get, or said got */}
      <div className="mt-2.5 flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold tracking-[-0.01em] text-[var(--text)]">{name}</div>
          <div className="truncate text-[12px] text-[var(--text-faint)]">{[by, count].filter(Boolean).join(' · ')}</div>
        </div>
        <Own className="shrink-0">{here ? <InMark label={t('assetDrawer.stateGot')} /> : <AddButton label={t('assetDrawer.getNamed').replace('{name}', name)} onClick={onAdd} />}</Own>
      </div>
    </div>
  );
}

/** Packs in a grid: albums of music wide enough for their record, sounds and stickers square. */
export const packGrid = (cat: string) => (cat === 'music' ? 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-5 gap-y-6'
  : shapeOf(cat) === 'sound' || shapeOf(cat) === 'sticker' ? 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-4 gap-y-6' : ASSET_GRID.video);

/** A pack's picture when it has none: its kind's mark on a quiet field, in black and white. */
export function KindCover({ cat }: { cat: string }) {
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center text-white/80"
      style={{ background: 'radial-gradient(120% 90% at 30% 20%, #2a2a2a 0%, #141414 55%, #0c0c0c 100%), #111' }}>
      <span className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'repeating-linear-gradient(135deg, #fff 0 1px, transparent 1px 9px)' }} />
      <span className="relative"><KindIcon kind={cat as FeatureKind} size={30} /></span>
    </div>
  );
}

/**
 * A part of a page, as a store page's (library/Store StoreSection): its name, a word under it, and what it holds; `all`:
 * the place showing all of it, a See all at its right.
 */
export function Shelf({ title, note, all, children }: { title: string; note?: string | undefined; all?: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <section className="mb-12" data-community-shelf={title}>
      <header className="mb-4 flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-[var(--text)]">{title}</h3>
          {note ? <p className="mt-1 text-[13px] leading-[18px] text-[var(--text-faint)]">{note}</p> : null}
        </div>
        {all ? (
          <button type="button" onClick={all} className="group flex shrink-0 items-center gap-0.5 pb-0.5 text-[13px] font-medium text-[var(--text-muted)] transition hover:text-[var(--text)]">
            {t('assetDrawer.seeAll')}<ChevronRight size={14} className="transition group-hover:translate-x-0.5" aria-hidden />
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}
