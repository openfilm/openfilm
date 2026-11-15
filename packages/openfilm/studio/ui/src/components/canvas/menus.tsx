/**
 * The menu of what to add, opened by the toolbar's +, a double click or `/` on the board, a node's ⊕ or a wire let go
 * on the board, drawn as the node canvases people know draw theirs: a narrow card headed by what it adds, which typed
 * into searches. Out on the board it has two parts, nodes (words, a picture, a clip, a cut, a sound, music) and what
 * there is already (a file of the computer, of the Assets); from a node's right ⊕, what to make from it; from its left
 * ⊕, what to bring into it. The toolbar's templates button opens it on the templates.
 */
import React from 'react';
import { ChevronRight, Images, LayoutTemplate, Search, Type as TypeIcon, Upload, X } from 'lucide-react';

/** the nodes a menu adds, as a film is made: the words, the pictures, the clips, the sound (the edit takes the cut) */
const ADD_KINDS = ['note', 'image', 'video', 'music'] as const;
import { useT } from '@/i18n';
import type { CanvasTemplate } from '@/lib/canvas-templates';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import type { SpawnKind } from './board';
import { KIND_ICON, MAKE_ICON } from './nodes';
import { MENU, MENU_ICON, MENU_ROW, MENU_TITLE } from './menu-style';

/** what the add menu lists of the project's files, at most */
const MENU_FILES = 40;

/**
 * where the add menu opens: on the screen (`above`: it rises from there, as from the toolbar), where on the board what
 * is added goes, and the node it is joined to: made from it (`source`), or going into it (`target`)
 */
export interface MenuAt {
  screen: { x: number; y: number };
  above?: boolean;
  at: { x: number; y: number };
  /** `at` is where what is added has its top left corner (beside a node), not its middle */
  corner?: boolean;
  from?: { node: string; side: 'source' | 'target' };
  /** a wire was dropped on the canvas and still leads to the menu */
  wire?: boolean;
  /** opened on the templates (the toolbar's button) */
  view?: 'templates';
}

const MENU_WIDTH = 244;

function addMenuPlacement(menu: MenuAt) {
  const screen = menu.screen;
  const roomOnRight = window.innerWidth - screen.x >= MENU_WIDTH + 8;
  const roomOnLeft = screen.x >= MENU_WIDTH + 8;
  const leftOfPointer = menu.wire && (menu.from?.side === 'target' ? roomOnLeft || !roomOnRight : !roomOnRight && roomOnLeft);
  const left = Math.max(8, Math.min(screen.x - (leftOfPointer ? MENU_WIDTH : 0), window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(screen.y, window.innerHeight - (menu.wire ? 240 : 480)));
  return { left, top };
}

type Row = { key: string; label: string; icon: React.ReactNode; run: () => void; more?: boolean; remove?: () => void; badge?: string };

export function AddMenu({ menu, files, templates, onKind, onUpload, onFile, onTemplate, onRemoveTemplate, onClose }: {
  menu: MenuAt;
  files: readonly WorkspaceResource[];
  templates: readonly CanvasTemplate[];
  onKind: (kind: SpawnKind) => void;
  onUpload: () => void;
  onFile: (file: WorkspaceResource) => void;
  onTemplate: (template: CanvasTemplate) => void;
  onRemoveTemplate: (template: CanvasTemplate) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  /* the Assets' files or the templates listed in the menu itself, in place of the kinds */
  const [view, setView] = React.useState<'kinds' | 'files' | 'templates'>(menu.view ?? 'kinds');
  const needle = query.trim().toLowerCase();
  const match = (label: string) => !needle || label.toLowerCase().includes(needle);
  const kind = (k: Exclude<SpawnKind, 'cut'>): Row => {
    const Icon = k === 'note' ? TypeIcon : k === 'music' ? MAKE_ICON.sfx : MAKE_ICON[k];
    /* a sound is one node (music or a sound effect, by its model): "Audio" */
    const label = k === 'note' ? t('canvas.kinds.note') : k === 'music' ? t('canvas.make.audio') : t(`canvas.make.${k}`);
    return { key: `kind:${k}`, label, icon: <Icon size={MENU_ICON} />, run: () => onKind(k) };
  };
  const upload: Row = { key: 'upload', label: t('canvas.menu.upload'), icon: <Upload size={MENU_ICON} />, run: onUpload };
  const fromAssets: Row = { key: 'assets', label: t('canvas.menu.fromAssets'), icon: <Images size={MENU_ICON} />, run: () => { setView('files'); setActive(0); }, more: true };
  const fileRows: Row[] = files.filter((f) => f.kind !== 'other' && (match(f.name) || match(f.path))).slice(0, MENU_FILES).map((f) => {
    const Icon = KIND_ICON[f.kind];
    return { key: `file:${f.path}`, label: f.name, icon: <Icon size={MENU_ICON} />, run: () => onFile(f) };
  });
  const templateRows: Row[] = templates.filter((tp) => match(tp.name)).map((tp) => ({
    key: `template:${tp.id}`, label: tp.name, icon: <LayoutTemplate size={MENU_ICON} />, run: () => onTemplate(tp),
    ...(tp.builtIn ? { badge: t('canvas.menu.builtIn') } : { remove: () => onRemoveTemplate(tp) }),
  }));
  const sections: Array<{ title: string; rows: Row[] }> = view === 'files' ? [{ title: t('canvas.menu.fromAssets'), rows: fileRows }]
    : view === 'templates' ? [{ title: t('canvas.menu.templates'), rows: templateRows }]
      : menu.from?.side === 'source' ? [{ title: t('canvas.menu.fromNode'), rows: ADD_KINDS.map(kind).filter((r) => match(r.label)) }]
        : menu.from?.side === 'target' ? [{ title: t('canvas.menu.intoNode'), rows: [upload, fromAssets, kind('note'), kind('image')].filter((r) => match(r.label)) }]
          : [
            { title: t('canvas.menu.nodes'), rows: ADD_KINDS.map(kind).filter((r) => match(r.label)) },
            { title: t('canvas.menu.resources'), rows: [upload, fromAssets].filter((r) => match(r.label)) },
            /* searching: the project's files and the templates too */
            ...(needle ? [{ title: t('canvas.menu.fromAssets'), rows: fileRows.slice(0, 8) }, { title: t('canvas.menu.templates'), rows: templateRows }] : []),
          ];
  const flat = sections.flatMap((s) => s.rows);
  const ref = React.useRef<HTMLDivElement>(null);
  /* the search has the keys, even after the press that opened it (a ⊕: its wire's start) has had its say */
  const search = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const focus = () => search.current?.focus({ preventScroll: true });
    focus();
    const later = requestAnimationFrame(() => requestAnimationFrame(focus));
    return () => cancelAnimationFrame(later);
  }, [view]);
  React.useEffect(() => {
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as globalThis.Node)) onClose(); };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  /* kept on the screen */
  const { left, top } = addMenuPlacement(menu);
  const place: React.CSSProperties = menu.above
    ? { left, bottom: Math.max(8, window.innerHeight - menu.screen.y + 10) }
    : { left, top };
  let n = -1;
  /* the first part's title heads the menu, and typed into searches */
  const head = sections[0]?.title ?? t('canvas.menu.nodes');
  return (
    <div ref={ref} data-canvas-add-menu className={`${MENU} fixed z-[200] overflow-hidden`} style={{ ...place, width: MENU_WIDTH }}>
      <label className="flex h-9 items-center gap-2 px-2.5">
        {view === 'kinds' ? null : (
          <button type="button" aria-label={t('canvas.menu.back')} onClick={() => { setView('kinds'); setActive(0); }}
            className="-ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--cv-ink-3)] hover:text-[var(--cv-ink)]">
            <ChevronRight size={15} className="rotate-180" />
          </button>
        )}
        <input
          ref={search}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { if (view !== 'kinds') setView('kinds'); else onClose(); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(flat.length - 1, i + 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
            else if (event.key === 'Enter') flat[active]?.run();
          }}
          placeholder={head}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]"
        />
        <Search size={15} className="shrink-0 text-[var(--cv-ink-3)]" />
      </label>
      <div className="overflow-y-auto" style={{ maxHeight: menu.wire ? Math.min(460, window.innerHeight - top - 52) : 460 }}>
        {sections.filter((sec) => sec.rows.length).map((section, si) => (
          <div key={section.title} className={si ? 'mt-1.5 border-t !border-[var(--cv-float-line)] pt-1.5' : ''}>
            {si ? <div className={MENU_TITLE}>{section.title}</div> : null}
            {section.rows.map((row) => {
              n += 1;
              const i = n;
              return (
                <button key={row.key} type="button" onMouseEnter={() => setActive(i)} onClick={row.run}
                  className={`${MENU_ROW} ${i === active ? 'bg-[var(--cv-float-hover)]' : ''}`}>
                  <span className="shrink-0">{row.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.badge ? <span className="shrink-0 rounded bg-[var(--cv-chip)] px-1.5 text-[10.5px] text-[var(--cv-ink-2)]">{row.badge}</span> : null}
                  {row.more ? <ChevronRight size={15} className="shrink-0 text-[var(--cv-ink-3)]" /> : null}
                  {row.remove && i === active ? (
                    <span role="button" tabIndex={-1} aria-label={t('canvas.removeTemplate')} title={t('canvas.removeTemplate')}
                      onClick={(event) => { event.stopPropagation(); row.remove!(); }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--cv-ink-3)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
                      <X size={12} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
        {flat.length ? null : <div className="flex h-9 items-center px-2.5 text-[14px] text-[var(--cv-ink-3)]">{t('canvas.nothing')}</div>}
      </div>
    </div>
  );
}
