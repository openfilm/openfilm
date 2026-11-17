/**
 * How the Community (components/PluginsWindow, library/PluginsPane) shows each kind of thing, each as what it is: a
 * workbench as a card with its mark large; a skill as a card with its cover (PluginsPane StoreCard);
 * a connector as a line; templates, effects, transitions and looks as moving pictures; stickers as a sheet of
 * stickers; text styles in words; sounds and music as a list to listen to. And Mine's own: the person's workbenches as
 * tiles they put in order by dragging (the order of the top right's switch and its keys), and what an agent brings of
 * its own folded into one line until opened.
 */
import * as React from 'react';
import { AudioLines, BadgeCheck, Check, ChevronDown, ChevronLeft, ChevronRight, GripVertical, Music, Pause, Play, Plus, type LucideIcon } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
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

/**
 * A plugin or a skill in a list, as an app store lists apps: its app icon, its name (and a word after it: Beta), what it
 * is for in a line or two, whose it is and how many use it; its control at the right (Get, Open, a switch, Coming
 * soon). Rows stand on a hairline each; a click opens its page.
 */
export function ItemCard({ icon, title, badges, summary, by, action, onOpen, dim = false }: {
  icon: React.ReactNode; title: string; badges?: React.ReactNode; summary: string; by?: React.ReactNode; action?: React.ReactNode;
  onOpen?: () => void; dim?: boolean;
}) {
  return (
    <div {...opener(onOpen)} data-store-card={title}
      className={`group relative -mx-3 flex min-w-0 items-center gap-4 rounded-[14px] px-3 py-3 outline-none transition-colors ${onOpen ? 'cursor-pointer hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--accent)]' : ''}`}>
      <span className={`shrink-0 transition-transform duration-200 group-hover:scale-[1.03] ${dim ? 'opacity-50 grayscale' : ''}`}>{icon}</span>
      <div className="min-w-0 flex-1 self-stretch border-b border-[var(--border)] pb-3 group-last:border-transparent">
        <div className="flex min-w-0 items-center gap-2 pt-0.5">
          <span className={`truncate text-[15px] font-semibold tracking-[-0.01em] ${dim ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{title}</span>
          {badges}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-[var(--text-muted)]">{summary}</p>
        {by ? <div className="mt-1 min-w-0 truncate text-[12px] text-[var(--text-faint)]">{by}</div> : null}
      </div>
      {action ? <Own className="shrink-0">{action}</Own> : null}
    </div>
  );
}

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
export const GROUP = 'overflow-hidden rounded-[16px] bg-[var(--bg-field)]';
const GROUP_ROW = 'group flex min-w-0 cursor-pointer items-center gap-3 pl-4 outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--accent)]';

/** A row's words and its control: its hairline over it (not the first's), from where the words start, as Settings draws it. */
function RowText({ first, title, badges, summary, dim, end, control }: {
  first: boolean; title: string; badges?: React.ReactNode; summary?: string; dim?: boolean; end?: React.ReactNode; control?: React.ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-4 ${first ? '' : 'border-t border-[var(--border)]'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`truncate text-[14px] font-medium ${dim ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{title}</span>
          {badges}
        </div>
        {summary ? <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-faint)]">{summary}</p> : null}
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
    <section className={`mt-3 ${GROUP}`}>
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

/** A thing with no picture of its own, as one line of a list: its mark, its name, what it is for, its control. */
export function LineCard({ mark, title, note, summary, action, onOpen, dim = false }: {
  mark: React.ReactNode; title: string; note?: React.ReactNode; summary?: string; action?: React.ReactNode; onOpen?: () => void; dim?: boolean;
}) {
  return (
    <div {...opener(onOpen)} data-plugin-line={title}
      className={`flex min-w-0 items-center gap-3 rounded-[12px] border border-[var(--border)] px-3.5 py-3 outline-none transition ${onOpen ? 'cursor-pointer hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]' : ''}`}>
      <span className={`shrink-0 ${dim ? 'opacity-50' : ''}`}>{mark}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={`truncate text-[14.5px] ${dim ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{title}</span>
          {note ? <span className="shrink-0 truncate text-[12px] text-[var(--text-faint)]">{note}</span> : null}
        </div>
        {summary ? <p className="mt-0.5 line-clamp-2 text-[13px] leading-[19px] text-[var(--text-muted)]">{summary}</p> : null}
      </div>
      {action ? <Own className="flex shrink-0 items-center">{action}</Own> : null}
    </div>
  );
}

/** A plain list's grid: two to a row where there is room. */
export const LINE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-2.5';

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
  return <img src={posterUrl(item)} alt="" loading="lazy" decoding="async" draggable={false} className={`absolute inset-0 h-full w-full ${item.cat === 'sticker' ? 'object-contain p-3' : 'object-cover'}`} />;
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
export function AssetTile({ item, lang, here, onOpen, onAdd }: {
  item: LibraryItem; lang: Lang; here: boolean; onOpen: () => void; onAdd: () => void;
}) {
  const t = useT();
  const [hover, setHover] = React.useState(false);
  const [still, setStill] = React.useState(false);
  const shape = shapeOf(item.cat);
  const moving = hover && !still ? movingOf(item) : null;
  const name = nameOf(item.name, lang);
  /* a file (footage, a picture, a recording) is saved into the person's own; anything else is got */
  const word = t(item.kind === 'file' ? (here ? 'assetDrawer.savedToMine' : 'assetDrawer.saveToMine') : here ? 'assetDrawer.stateGot' : 'assetDrawer.get');
  return (
    <div {...opener(onOpen)} data-store-card={name} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group min-w-0 cursor-pointer outline-none">
      <div className={`relative overflow-hidden rounded-[14px] bg-[var(--bg-field)] ring-1 ring-[var(--border)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_28px_rgba(0,0,0,0.28)] group-hover:ring-[var(--border-strong)] group-focus-visible:ring-[var(--accent)] ${shape === 'sticker' ? 'aspect-square' : shape === 'words' ? 'aspect-[2/1]' : 'aspect-video'}`}>
        <AssetCover item={item} lang={lang} />
        {moving ? <video key={moving} src={moving} autoPlay muted loop playsInline onError={() => setStill(true)} className="absolute inset-0 h-full w-full object-cover" /> : null}
        <button type="button" disabled={here} aria-label={word} title={word}
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className={`absolute bottom-1.5 right-1.5 h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium transition focus-visible:flex ${here ? 'hidden bg-black/55 text-white group-hover:flex' : 'hidden bg-white text-black hover:bg-white/90 group-hover:flex'}`}>
          {here ? <Check size={13} aria-hidden /> : <Plus size={13} aria-hidden />}{word}
        </button>
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
  return (
    <div {...opener(onOpen)} data-store-card={name} className="group min-w-0 cursor-pointer outline-none">
      <div className={`relative overflow-hidden rounded-[14px] bg-[var(--bg-field)] transition duration-200 group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent)] ${square ? 'aspect-square' : 'aspect-video'}`}>
        {cover}
        {newer ? <span className="absolute left-2 top-2 rounded-full bg-[var(--text)] px-2 py-0.5 text-[11px] font-semibold text-[var(--dialog-main)]">{t('assetDrawer.packNewer')}</span> : null}
      </div>
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

/** Packs in a grid: smaller where their pictures are square. */
export const packGrid = (cat: string) => (shapeOf(cat) === 'sound' || shapeOf(cat) === 'sticker'
  ? 'grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-3 gap-y-4' : ASSET_GRID.video);

/** One sound heard at a time: which is playing, and the press that plays it or stops it. */
export function useAudioPreview() {
  const [playing, setPlaying] = React.useState<string | null>(null);
  const player = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => { player.current?.pause(); }, []);
  const play = (it: LibraryItem) => {
    const a = player.current ?? (player.current = new Audio());
    if (playing === it.id) { a.pause(); setPlaying(null); return; }
    a.src = libraryUrl(it.id);
    a.onended = () => setPlaying(null);
    void a.play().then(() => setPlaying(it.id), () => setPlaying(null));
  };
  return { playing, play };
}

const length = (ms?: number) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}` : '');

/**
 * Sounds and music as a list to listen to: each its play button, its name (and whose, when someone sent it), its
 * length, its star and its control (`action`); its name opens its page.
 */
export function SoundList({ items, lang, onOpen, action }: {
  items: readonly LibraryItem[]; lang: Lang;
  onOpen: (item: LibraryItem) => void; action: (item: LibraryItem) => React.ReactNode;
}) {
  const t = useT();
  const { playing, play } = useAudioPreview();
  return (
    <div className="flex flex-col" data-sound-list="">
      {items.map((it) => {
        const on = playing === it.id;
        return (
          <div key={it.id} className="group -mx-3 flex h-12 items-center gap-3 rounded-[8px] px-3 transition hover:bg-[var(--bg-hover)]">
            <button type="button" onClick={() => play(it)} aria-label={t(on ? 'assetDrawer.pauseThing' : 'assetDrawer.playThing')}
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${on ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'bg-[var(--bg-field)] text-[var(--text)]'}`}>
              {on ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
            </button>
            <button type="button" onClick={() => onOpen(it)} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
              <span className={`truncate text-[14px] hover:underline ${on ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{nameOf(it.name, lang)}</span>
              {it.by ? <span className="inline-flex shrink-0 items-center gap-1 truncate text-[12px] text-[var(--text-faint)]">{makerName(it.by)}{byOpenFilm(it.by) ? <BadgeCheck size={12} strokeWidth={2} aria-hidden /> : null}</span> : null}
            </button>
            <span className="w-12 shrink-0 text-right text-[12.5px] tabular-nums text-[var(--text-faint)]">{length(it.durationMs)}</span>
            {action(it)}
          </div>
        );
      })}
    </div>
  );
}

/** The kinds a page holds, to see one at a time: All, then each with how many. */
export function KindChips<K extends string>({ kinds, value, onChange, nameOf: name, countOf }: {
  kinds: readonly K[]; value: K | null; onChange: (kind: K | null) => void; nameOf: (kind: K) => string; countOf: (kind: K | null) => number;
}) {
  const t = useT();
  if (kinds.length < 2) return null;
  const chip = (kind: K | null, label: string) => (
    <button key={kind ?? ''} type="button" aria-pressed={value === kind} onClick={() => onChange(kind)}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition ${value === kind ? 'bg-[var(--text)] text-[var(--dialog-main)]' : 'bg-[var(--bg-field)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
      {label}<span className="tabular-nums opacity-60">{countOf(kind)}</span>
    </button>
  );
  return (
    <div role="toolbar" className="mb-6 flex flex-wrap gap-2">
      {chip(null, t('assetDrawer.allItems'))}
      {kinds.map((k) => chip(k, name(k)))}
    </div>
  );
}

/** One thing the Community puts forward on Discover's banner: what it is, its art, its colour, its button. */
export interface Featured {
  key: string; eyebrow: string; title: string; summary: string; art?: React.ReactNode; hue: number;
  /** a picture filling it (a pack's cover), darkened where the words are */
  picture?: string;
  action: React.ReactNode; onOpen: () => void;
}

/** A colour of its own for a thing, from its hue: deep at one corner, deeper at the other, a glow behind its art. */
export const featuredBackground = (hue: number) =>
  `radial-gradient(120% 140% at 85% 30%, hsl(${hue} 85% 58% / 0.55), transparent 55%), linear-gradient(135deg, hsl(${hue} 70% 34%), hsl(${(hue + 40) % 360} 75% 16%))`;

/**
 * Discover's banner, as an app store opens on one thing at a time: its colour filling the width, its name large, what
 * it is for, its button, its art at the right; the next one by itself every few seconds (not while pointed at), or by
 * the arrows and the dots.
 */
export function Hero({ items }: { items: readonly Featured[] }) {
  const t = useT();
  const [at, setAt] = React.useState(0);
  const [held, setHeld] = React.useState(false);
  const count = items.length;
  React.useEffect(() => {
    if (held || count < 2) return undefined;
    const timer = window.setTimeout(() => setAt((i) => (i + 1) % count), 7000);
    return () => window.clearTimeout(timer);
  }, [at, held, count]);
  if (!count) return null;
  const it = items[at % count]!;
  const go = (step: number) => setAt((i) => (i + step + count) % count);
  return (
    <section data-community-hero="" aria-roledescription="carousel" aria-label={t('assetDrawer.featured')}
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      className="relative mb-10 overflow-hidden rounded-[24px] shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
      <div key={it.key} {...opener(it.onOpen)} className="relative flex h-[264px] cursor-pointer items-center gap-8 px-10 outline-none transition-[background] duration-700 animate-[community-fade_600ms_ease]"
        style={{ background: featuredBackground(it.hue) }}>
        {it.picture ? <>
          <img src={it.picture} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
          <span aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.78),rgba(0,0,0,0.35)_55%,transparent)]" />
        </> : null}
        <div className="relative min-w-0 flex-1 text-white">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-white/65">{it.eyebrow}</div>
          <h3 className="mt-2 text-[34px] font-bold leading-[1.08] tracking-[-0.025em]">{it.title}</h3>
          <p className="mt-2.5 line-clamp-2 max-w-[440px] text-[14.5px] leading-[21px] text-white/80">{it.summary}</p>
          <Own className="mt-5 inline-flex">{it.action}</Own>
        </div>
        {it.art ? <div className="relative hidden shrink-0 rotate-[-6deg] drop-shadow-[0_22px_40px_rgba(0,0,0,0.45)] transition-transform duration-500 hover:rotate-0 sm:block">{it.art}</div> : null}
      </div>
      {count > 1 ? (
        <div className="absolute bottom-5 right-6 flex items-center gap-2">
          {items.map((x, i) => (
            <button key={x.key} type="button" aria-label={x.title} aria-current={i === at % count}
              onClick={() => setAt(i)} className={`h-1.5 rounded-full transition-all ${i === at % count ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'}`} />
          ))}
          <span className="w-2" />
          <button type="button" aria-label={t('assetDrawer.previous')} onClick={() => go(-1)} className="grid h-8 w-8 place-items-center rounded-full bg-black/25 text-white backdrop-blur transition hover:bg-black/40"><ChevronLeft size={16} /></button>
          <button type="button" aria-label={t('assetDrawer.next')} onClick={() => go(1)} className="grid h-8 w-8 place-items-center rounded-full bg-black/25 text-white backdrop-blur transition hover:bg-black/40"><ChevronRight size={16} /></button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * A shelf of a page, as an app store's: its name large with a chevron (it opens all of it), a word under it, and what
 * it holds; `all`: the place showing all of it.
 */
export function Shelf({ title, note, all, children }: { title: string; note?: string; all?: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <section className="mb-11" data-community-shelf={title}>
      <header className="mb-3 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          {all ? (
            <button type="button" onClick={all} className="group inline-flex items-center gap-0.5 text-[21px] font-bold tracking-[-0.02em] text-[var(--text)]">
              {title}<ChevronRight size={20} strokeWidth={2.4} className="text-[var(--text-faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--text)]" />
            </button>
          ) : <h3 className="text-[21px] font-bold tracking-[-0.02em] text-[var(--text)]">{title}</h3>}
          {note ? <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{note}</p> : null}
        </div>
        {all ? <button type="button" onClick={all} className="shrink-0 pb-0.5 text-[13.5px] font-medium text-[var(--accent)] hover:underline">{t('assetDrawer.seeAll')}</button> : null}
      </header>
      {children}
    </section>
  );
}

/** Rows in two columns, as an app store lists its charts. */
export const ROW_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-x-10';

/** Things side by side that run on past the edge, scrolled by the arrows at the shelf's corner too. */
export function Scroller({ children, width = 248 }: { children: React.ReactNode; width?: number }) {
  const t = useT();
  const row = React.useRef<HTMLDivElement>(null);
  const [ends, setEnds] = React.useState({ start: true, end: false });
  const read = () => {
    const el = row.current;
    if (el) setEnds({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  React.useEffect(() => { read(); }, [children]);
  const by = (step: number) => row.current?.scrollBy({ left: step * (row.current.clientWidth - width / 2), behavior: 'smooth' });
  return (
    <div className="group/scroller relative">
      <div ref={row} onScroll={read} className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none]"
        style={{ '--tile': `${width}px` } as React.CSSProperties}>
        {React.Children.map(children, (child) => <div className="w-[var(--tile)] shrink-0 snap-start">{child}</div>)}
      </div>
      {ends.start ? null : <button type="button" aria-label={t('assetDrawer.previous')} onClick={() => by(-1)} className="absolute -left-4 top-[38%] grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-[var(--border)] bg-[var(--dialog-main)] text-[var(--text)] opacity-0 shadow-lg transition group-hover/scroller:opacity-100"><ChevronLeft size={17} /></button>}
      {ends.end ? null : <button type="button" aria-label={t('assetDrawer.next')} onClick={() => by(1)} className="absolute -right-4 top-[38%] grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-[var(--border)] bg-[var(--dialog-main)] text-[var(--text)] opacity-0 shadow-lg transition group-hover/scroller:opacity-100"><ChevronRight size={17} /></button>}
    </div>
  );
}

/** Each kind of the library's things a colour of its own (Discover's tiles, a kind's page). */
export const KIND_HUE: Record<string, number> = { media: 200, template: 262, text: 214, sticker: 330, effect: 188, transition: 22, filter: 42, sound: 152, music: 292 };

/** A kind of the library's things as a tile of its colour: its name, how many there are, its mark large at the corner. */
export function CategoryTile({ name, count, hue, mark, onOpen }: { name: string; count: string; hue: number; mark: React.ReactNode; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-community-category={name}
      className="group relative h-[118px] overflow-hidden rounded-[18px] p-4 text-left text-white shadow-[0_8px_24px_rgba(0,0,0,0.22)] outline-none transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,0,0,0.32)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{ background: featuredBackground(hue) }}>
      <div className="relative z-[1] text-[17px] font-semibold tracking-[-0.01em]">{name}</div>
      <div className="relative z-[1] mt-0.5 text-[12.5px] text-white/70">{count}</div>
      <span className="absolute -bottom-3 -right-2 rotate-[-12deg] text-white/85 transition duration-300 group-hover:rotate-0 group-hover:scale-105">{mark}</span>
    </button>
  );
}
