/**
 * The menu of what to add, opened by the toolbar's +, a double click or `/` on the board, a node's ⊕ or a wire let go
 * on the board. Out on the board it has two parts, nodes (words, a picture, a clip, a sound, music, a cut) and what
 * there is already (a file of the computer, of the Assets, a template); from a node's right ⊕, what to make from it;
 * from its left ⊕, what to bring into it. A search finds any of them and the project's files.
 */
import React from 'react';
import { ChevronRight, Images, LayoutTemplate, Scissors, Search, Type as TypeIcon, Upload, X } from 'lucide-react';
import { useT } from '@/i18n';
import type { CanvasTemplate } from '@/lib/canvas-templates';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import type { SpawnKind } from './board';
import { KIND_ICON, MAKE_ICON } from './nodes';

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
  /** opened on the templates (the toolbar's button) */
  view?: 'templates';
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
  const kind = (k: SpawnKind): Row => {
    const Icon = k === 'note' ? TypeIcon : k === 'cut' ? Scissors : MAKE_ICON[k];
    const label = k === 'note' ? t('canvas.kinds.note') : k === 'cut' ? t('canvas.kinds.cut') : t(`canvas.make.${k}`);
    return { key: `kind:${k}`, label, icon: <Icon size={16} />, run: () => onKind(k) };
  };
  const upload: Row = { key: 'upload', label: t('canvas.menu.upload'), icon: <Upload size={16} />, run: onUpload };
  const fromAssets: Row = { key: 'assets', label: t('canvas.menu.fromAssets'), icon: <Images size={16} />, run: () => { setView('files'); setActive(0); }, more: true };
  const fromTemplates: Row = { key: 'templates', label: t('canvas.menu.templates'), icon: <LayoutTemplate size={16} />, run: () => { setView('templates'); setActive(0); }, more: true };
  const fileRows: Row[] = files.filter((f) => f.kind !== 'other' && (match(f.name) || match(f.path))).slice(0, MENU_FILES).map((f) => {
    const Icon = KIND_ICON[f.kind];
    return { key: `file:${f.path}`, label: f.name, icon: <Icon size={16} />, run: () => onFile(f) };
  });
  const templateRows: Row[] = templates.filter((tp) => match(tp.name)).map((tp) => ({
    key: `template:${tp.id}`, label: tp.name, icon: <LayoutTemplate size={16} />, run: () => onTemplate(tp),
    ...(tp.builtIn ? { badge: t('canvas.menu.builtIn') } : { remove: () => onRemoveTemplate(tp) }),
  }));
  const sections: Array<{ title: string; rows: Row[] }> = view === 'files' ? [{ title: t('canvas.menu.fromAssets'), rows: fileRows }]
    : view === 'templates' ? [{ title: t('canvas.menu.templates'), rows: templateRows }]
      : menu.from?.side === 'source' ? [{ title: t('canvas.menu.fromNode'), rows: (['note', 'image', 'video', 'sfx', 'music', 'cut'] as const).map(kind).filter((r) => match(r.label)) }]
        : menu.from?.side === 'target' ? [{ title: t('canvas.menu.intoNode'), rows: [upload, fromAssets, kind('note'), kind('image')].filter((r) => match(r.label)) }]
          : [
            { title: t('canvas.menu.nodes'), rows: (['note', 'image', 'video', 'sfx', 'music', 'cut'] as const).map(kind).filter((r) => match(r.label)) },
            { title: t('canvas.menu.resources'), rows: [upload, fromAssets, fromTemplates].filter((r) => match(r.label)) },
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
  const left = Math.min(menu.screen.x, window.innerWidth - 300);
  const place: React.CSSProperties = menu.above
    ? { left, bottom: Math.max(8, window.innerHeight - menu.screen.y + 10) }
    : { left, top: Math.min(menu.screen.y, window.innerHeight - 440) };
  let n = -1;
  return (
    <div ref={ref} className="fixed z-[200] w-[264px] overflow-hidden rounded-[14px] border border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]" style={place}>
      <label className="flex h-8 items-center gap-2 px-2 text-[13px]">
        {view === 'kinds' ? null : (
          <button type="button" aria-label={t('canvas.menu.back')} onClick={() => { setView('kinds'); setActive(0); }}
            className="-ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--cv-label)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
            <ChevronRight size={14} className="rotate-180" />
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
          placeholder={t(menu.from ? 'canvas.menu.searchHere' : 'canvas.menu.search')}
          className="min-w-0 flex-1 bg-transparent text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-label)]"
        />
        <Search size={14} className="shrink-0 text-[var(--cv-label)]" />
      </label>
      <div className="max-h-[380px] overflow-y-auto">
        {sections.filter((s) => s.rows.length).map((section) => (
          <div key={section.title} className="pt-1">
            <div className="px-2 pb-1 pt-1.5 text-[11.5px] text-[var(--cv-label)]">{section.title}</div>
            {section.rows.map((row) => {
              n += 1;
              const i = n;
              return (
                <button key={row.key} type="button" onMouseEnter={() => setActive(i)} onClick={row.run}
                  className={`flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-[13.5px] ${i === active ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink)]'}`}>
                  <span className="shrink-0 text-[var(--cv-label)]">{row.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.badge ? <span className="shrink-0 rounded bg-[var(--cv-float-hover)] px-1.5 text-[10.5px] text-[var(--cv-label)]">{row.badge}</span> : null}
                  {row.more ? <ChevronRight size={14} className="shrink-0 text-[var(--cv-label)]" /> : null}
                  {row.remove && i === active ? (
                    <span role="button" tabIndex={-1} aria-label={t('canvas.removeTemplate')} title={t('canvas.removeTemplate')}
                      onClick={(event) => { event.stopPropagation(); row.remove!(); }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--cv-label)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
                      <X size={12} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
        {flat.length ? null : <div className="flex h-9 items-center px-2 text-[12.5px] text-[var(--cv-label)]">{t('canvas.nothing')}</div>}
      </div>
    </div>
  );
}
