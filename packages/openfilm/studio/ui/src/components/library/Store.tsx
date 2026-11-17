/**
 * The Community's store, laid out as an editor's extensions view is: a card for each plugin or skill (Get, or a word
 * saying it is installed or off); its page with what to do at the top (Get; once got, Turn off or Turn on, and Remove)
 * and its facts at the side; the person's own rows managed from a menu rather than switched where they are listed.
 * Used by library/PluginsPane for plugins, skills and the library's packs alike.
 */
import * as React from 'react';
import { ArrowLeft, Check, ChevronRight, Settings } from 'lucide-react';
import { useT } from '@/i18n';
import { ContextMenu, type ContextMenuEntry } from '../ContextMenu';
import { LARGE_DIALOG_COLUMN as PAGE_INSET } from '../dialog-chrome';
import { Own, opener } from './CommunityViews';

/**
 * Things side by side, in columns as wide as the window allows: rows of apps (a plugin, a connector), one under the
 * other with a hairline between, or cards with a picture (a skill's cover).
 */
export const STORE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-8';
/** Cards with a picture side by side (skills by their covers): two where the window is narrow, more as it widens. */
export const COVER_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-6';

/**
 * A plugin or a skill in the store. Without a picture, as an app store lists apps: its icon, its name (a word after it:
 * Beta), what it is for, whose it is and how many use it, and what to do (Get) or that it is here (Installed, Off) at
 * the right, a hairline over it. With one (a skill's cover, playing its preview while pointed at), a card: the picture,
 * then the same words under it. A click opens its page.
 */
export function StoreCard({ icon, cover, title, badges, by, summary, meta, action, onOpen, dim = false }: {
  icon: React.ReactNode;
  /** its picture across the top (a skill's cover, playing its preview while pointed at): then it stands for the icon */
  cover?: ((hover: boolean) => React.ReactNode) | undefined;
  title: string; badges?: React.ReactNode; by?: React.ReactNode; summary: string;
  meta?: React.ReactNode; action?: React.ReactNode; onOpen?: () => void; dim?: boolean;
}) {
  const [hover, setHover] = React.useState(false);
  const name = (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={`truncate text-[14.5px] font-semibold tracking-[-0.01em] ${dim ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{title}</span>
      {badges}
    </div>
  );
  const foot = by || meta ? (
    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-faint)]">
      {by ? <span className="flex min-w-0 items-center truncate">{by}</span> : null}
      {by && meta ? <span aria-hidden>·</span> : null}
      {meta ? <span className="min-w-0 truncate tabular-nums">{meta}</span> : null}
    </div>
  ) : null;
  if (cover) {
    return (
      <div {...opener(onOpen)} data-store-card={title} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        className="group mb-8 flex min-w-0 cursor-pointer flex-col outline-none">
        <div className={`relative aspect-[16/9] w-full overflow-hidden rounded-[12px] bg-[var(--bg-field)] ring-1 ring-inset ring-[var(--border)] transition group-hover:ring-[var(--border-strong)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent)] ${dim ? 'opacity-50 grayscale' : ''}`}>
          <div className="absolute inset-0 transition duration-300 group-hover:scale-[1.02]">{cover(hover)}</div>
        </div>
        <div className="mt-3 flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            {name}
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-[var(--text-muted)]">{summary}</p>
            {foot}
          </div>
          {action ? <Own className="shrink-0 pt-0.5">{action}</Own> : null}
        </div>
      </div>
    );
  }
  return (
    <div {...opener(onOpen)} data-store-card={title}
      className="group -mx-2 flex min-w-0 cursor-pointer items-center gap-3.5 rounded-[12px] px-2 outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--accent)]">
      <span className={`shrink-0 transition-transform duration-200 group-hover:scale-[1.03] ${dim ? 'opacity-50 grayscale' : ''}`}>{icon}</span>
      <div className="flex min-w-0 flex-1 items-center gap-3 self-stretch border-t border-[var(--border)] py-3.5 group-hover:border-transparent">
        <div className="min-w-0 flex-1">
          {name}
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-[var(--text-muted)]">{summary}</p>
          {foot}
        </div>
        {action ? <Own className="shrink-0">{action}</Own> : null}
      </div>
    </div>
  );
}

/** A card's place while the store is read: a picture's (`cover`) or an app row's. */
export function StoreCardSkeleton({ cover = false }: { cover?: boolean }) {
  return cover ? (
    <div aria-hidden className="mb-8 min-w-0">
      <div className="skeleton aspect-[16/9] rounded-[12px]" />
      <div className="skeleton mt-3 h-3.5 w-1/2 rounded-full" />
      <div className="skeleton mt-2 h-3 w-4/5 rounded-full opacity-70" />
    </div>
  ) : (
    <div aria-hidden className="flex min-w-0 items-center gap-3.5">
      <div className="skeleton h-11 w-11 shrink-0 rounded-[11px]" />
      <div className="min-w-0 flex-1 border-t border-[var(--border)] py-3.5">
        <div className="skeleton h-3.5 w-2/5 rounded-full" />
        <div className="skeleton mt-2 h-3 w-4/5 rounded-full opacity-70" />
      </div>
    </div>
  );
}

/** Here already, as a card's foot says it: installed (a tick), or off. */
export function StateMark({ off = false }: { off?: boolean }) {
  const t = useT();
  return off
    ? <span className="inline-flex h-7 items-center rounded-full border border-dashed border-[var(--border-strong)] px-2.5 text-[12.5px] font-medium text-[var(--text-faint)]">{t('assetDrawer.stateOff')}</span>
    : <span className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--bg-field)] px-2.5 text-[12.5px] font-medium text-[var(--text-muted)]"><Check size={13} aria-hidden />{t('assetDrawer.stateInstalled')}</span>;
}

/** A page's button: the first thing to do filled, the others quiet, one that takes away in the warning's colour. */
export function PageButton({ kind = 'quiet', busy = false, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'main' | 'quiet' | 'danger'; busy?: boolean }) {
  const look = kind === 'main' ? 'bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--primary-hover)] font-semibold px-5'
    : kind === 'danger' ? 'bg-[var(--bg-field)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--err)] px-4'
      : 'bg-[var(--bg-field)] text-[var(--text)] hover:bg-[var(--bg-hover)] px-4';
  return (
    <button type="button" {...props} disabled={props.disabled || busy}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full text-[13.5px] font-medium transition active:scale-[0.97] disabled:opacity-45 ${look}`}>
      {busy ? <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  );
}

/** Manage: a gear opening what can be done with one of the person's own (Turn off, Remove, its page). */
export function ManageButton({ label, items }: { label: string; items: readonly ContextMenuEntry[] }) {
  const [at, setAt] = React.useState<{ x: number; y: number; top: number } | null>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={Boolean(at)} data-manage=""
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt(at ? null : { x: r.right, y: r.bottom + 4, top: r.top - 4 }); }}
        className={`grid h-8 w-8 place-items-center rounded-[8px] transition hover:bg-[var(--bg-pressed)] hover:text-[var(--text)] ${at ? 'bg-[var(--bg-pressed)] text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
        <Settings size={16} strokeWidth={1.7} aria-hidden />
      </button>
      {at ? <ContextMenu x={at.x} y={at.y} align="end" flipTo={at.top} trigger={button} items={items} onClose={() => setAt(null)} /> : null}
    </>
  );
}

/**
 * One thing's page: Back; its icon large, its name, whose it is, what it is for and what to do with it; then what it
 * is at the left and its facts at the right.
 */
export function DetailShell({ onBack, icon, title, badges, byline, summary, actions, notice, hero, aside, children, data }: {
  onBack: () => void; icon: React.ReactNode; title: string; badges?: React.ReactNode; byline?: React.ReactNode; summary?: string;
  actions?: React.ReactNode; notice?: React.ReactNode;
  /** a picture of it at work, across the page under its head (DocSections PreviewBand) */
  hero?: React.ReactNode;
  aside?: React.ReactNode; children?: React.ReactNode;
  /** marks the page carries (data-skill-page, data-plugin-page) */
  data?: Record<string, string>;
}) {
  const t = useT();
  return (
    <>
      <div className={`flex shrink-0 ${PAGE_INSET} pb-2 pt-8`}>
        <button type="button" onClick={onBack} className="-ml-1 flex h-8 items-center gap-1.5 rounded-md pl-1.5 pr-2.5 text-[14px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <ArrowLeft size={14} />{t('gallery.back')}
        </button>
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${PAGE_INSET} pb-12 pt-3`} {...data}>
        <header className="flex items-start gap-5">
          <span className="shrink-0">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate text-[24px] font-bold leading-[1.2] tracking-[-0.02em] text-[var(--text)]">{title}</h2>
              {badges}
            </div>
            {byline ? <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-[13px] text-[var(--text-faint)]">{byline}</div> : null}
            {summary ? <p className="mt-2 max-w-[620px] text-[14.5px] leading-[21px] text-[var(--text-muted)]">{summary}</p> : null}
            {actions ? <div className="mt-4 flex flex-wrap items-center gap-2" data-detail-actions="">{actions}</div> : null}
          </div>
        </header>
        {notice}
        {hero}
        <div className={`${hero ? 'mt-8' : 'mt-7 border-t border-[var(--border)]'} ${aside ? 'grid gap-x-12 gap-y-8 pt-7 [grid-template-columns:minmax(0,1fr)] min-[1180px]:[grid-template-columns:minmax(0,1fr)_200px]' : ''}`}>
          <div className="min-w-0">{children}</div>
          {aside ? <aside className="min-w-0" data-detail-aside="">{aside}</aside> : null}
        </div>
      </div>
    </>
  );
}

/** A page's facts at its side: each a name over its value. */
export function Facts({ title, items }: { title: string; items: ReadonlyArray<{ key: string; name: string; value: React.ReactNode } | null | false> }) {
  const shown = items.filter((f): f is { key: string; name: string; value: React.ReactNode } => Boolean(f));
  if (!shown.length) return null;
  return (
    <section>
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--text-faint)]">{title}</h3>
      <dl className="mt-3 flex flex-col gap-3.5">
        {shown.map((f) => (
          <div key={f.key} className="min-w-0" data-fact={f.key}>
            <dt className="text-[12px] text-[var(--text-faint)]">{f.name}</dt>
            <dd className="mt-0.5 break-words text-[13.5px] leading-[19px] text-[var(--text)]">{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** One way to narrow a page (a kind, a category): All first, then each, with how many when known. */
export function StoreChips<K extends string>({ label, items, value, onChange }: {
  label: string; items: ReadonlyArray<{ key: K | null; label: string; count?: number; icon?: React.ReactNode }>;
  value: K | null; onChange: (key: K | null) => void;
}) {
  if (items.length < 2) return null;
  return (
    <div role="tablist" aria-label={label} className="-mx-1 mb-8 flex gap-1.5 overflow-x-auto px-1 pb-1 pr-8 [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-store-chips="">
      {items.map((it) => {
        const on = value === it.key;
        return (
          <button key={it.key ?? ''} type="button" role="tab" aria-selected={on} onClick={() => onChange(it.key)}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition ${on ? 'bg-[var(--text)] text-[var(--dialog-main)]' : 'text-[var(--text-muted)] ring-1 ring-inset ring-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
            {it.icon}{it.label}
            {it.count != null ? <span className={`text-[12px] tabular-nums ${on ? 'opacity-60' : 'text-[var(--text-faint)]'}`}>{it.count.toLocaleString()}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** A part of a store page: its name, a word under it, See all at its right when there is more. */
export function StoreSection({ title, badge, note, all, children }: { title: string; badge?: React.ReactNode; note?: string | undefined; all?: (() => void) | undefined; children: React.ReactNode }) {
  const t = useT();
  return (
    <section className="mb-12" data-community-shelf={title}>
      <header className="mb-4 flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center text-[17px] font-semibold tracking-[-0.015em] text-[var(--text)]">{title}{badge}</h3>
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

/** An invitation at a page's foot (publish what you made, send an example): its mark, a line, its button, quiet. */
export function CallOut({ icon, text, action }: { icon: React.ReactNode; text: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] border border-[var(--border)] px-5 py-4" data-store-callout="">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--bg-field)] text-[var(--text-muted)]">{icon}</span>
      <p className="min-w-0 flex-1 text-[13.5px] leading-[20px] text-[var(--text-muted)]">{text}</p>
      <Own className="shrink-0">{action}</Own>
    </div>
  );
}
