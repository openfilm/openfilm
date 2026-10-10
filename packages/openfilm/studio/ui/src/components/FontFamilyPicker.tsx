/**
 * Picking a font in the inspector, as in Figma.
 *
 * The menu has "In this project" first (the families the project's pages declare with @font-face, and the ones the
 * page in hand names), then the recent picks, then every font installed here by script — the CJK groups first when
 * the layer's text is CJK. **Each row is set in its own face** (a project font through its own files), a CJK font
 * whose name is in Latin letters with a small sample of its script beside it.
 *
 * Hovering a row or moving through the rows with ↑/↓ shows that family on the picture; Esc, a click elsewhere or
 * closing without a pick takes it back; Enter or a click keeps it (one change). Typing filters by name and alias and
 * highlights the best match; ↑/↓/Enter work from the search box. A name in no list can still be typed and picked.
 *
 * A family the page cannot draw (not installed, not declared for the page) shows in the field with a warning.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';

import { useT } from '@/i18n';
import { CJK_TEXT, fontMenu, knownAvailable, rowFontFamily, sampleOf, type FontRow, type SectionId } from '@/lib/font-menu';
import { familyRenders, readRecentFonts, rememberRecentFont, useInstalledFonts, useProjectFonts } from '@/lib/use-fonts';
import { Tooltip } from './Tooltip';

const SECTION_LABEL: Record<SectionId, string> = {
  project: 'inspector.fontGroupProject',
  recent: 'inspector.fontGroupRecent',
  'zh-CN': 'inspector.fontGroupZh',
  'ja-JP': 'inspector.fontGroupJa',
  'ko-KR': 'inspector.fontGroupKo',
  latin: 'inspector.fontGroupLatin',
};

export function FontFamilyPicker({
  label,
  value,
  sample,
  missing,
  onPreview,
  onRevert,
  onCommit,
  className,
}: {
  label: string;
  value: string;
  /** The selected layer's text: decides whether the CJK groups come first. */
  sample: string;
  /** The page cannot draw `value`: the field warns. */
  missing?: boolean;
  /** Shows a family on the picture, nothing written. */
  onPreview: (family: string) => void;
  /** Takes the preview back off the picture. */
  onRevert: () => void;
  onCommit: (family: string) => void;
  className: string;
}) {
  const t = useT();
  const installed = useInstalledFonts();
  const { fonts: project, page } = useProjectFonts();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const [recent, setRecent] = React.useState<string[]>([]);
  const anchor = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  /* the layer's family when the menu opened: the stage reports a previewed family as the layer's own */
  const origin = React.useRef(value);
  /* the family shown on the picture now (null: the layer's own) */
  const previewing = React.useRef<string | null>(null);
  /* the highlight moved by the keys: scroll it into view (a hovered row is in view already) */
  const keyed = React.useRef(false);
  const [at, setAt] = React.useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  const place = React.useCallback(() => {
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    const below = window.innerHeight - box.bottom - 12;
    const above = box.top - 12;
    /* below when there is room for a good part of it, else on the roomier side; never past the window */
    const down = below >= 320 || below >= above;
    const maxHeight = Math.max(160, Math.min(460, down ? below : above));
    const top = down ? box.bottom + 4 : box.top - 4 - maxHeight;
    const width = Math.max(box.width, 260);
    setAt({ left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)), top, width, maxHeight });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const sections = React.useMemo(
    () => fontMenu({ installed: installed ?? [], project, page, recent, query, cjkFirst: CJK_TEXT.test(sample) }),
    [installed, project, page, recent, query, sample],
  );
  const rows = React.useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const typed = query.trim();
  const custom = typed && !rows.some((r) => r.family.toLowerCase() === typed.toLowerCase()) ? typed : null;
  const options = React.useMemo(() => (custom ? [...rows.map((r) => r.family), custom] : rows.map((r) => r.family)), [rows, custom]);

  /* typing: the best match highlighted (not shown on the picture: that is for the hand on a row, or the arrows) */
  React.useEffect(() => { setActive(0); keyed.current = true; }, [query]);
  React.useEffect(() => {
    if (!open) return;
    /* open on the current family */
    setRecent(readRecentFonts());
    const i = rows.findIndex((r) => r.family === origin.current);
    setActive(i >= 0 ? i : 0);
    keyed.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  React.useEffect(() => {
    if (!open || !keyed.current) return;
    keyed.current = false;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, at]);

  const show = (family: string | undefined) => {
    if (!family || family === origin.current) {
      if (previewing.current != null) { previewing.current = null; onRevert(); }
      return;
    }
    if (previewing.current === family) return;
    previewing.current = family;
    onPreview(family);
  };
  const close = () => {
    setOpen(false);
    setQuery('');
    if (previewing.current != null) { previewing.current = null; onRevert(); }
  };
  const pick = (family: string) => {
    setOpen(false);
    setQuery('');
    const was = previewing.current;
    previewing.current = null;
    if (!family || family === origin.current) { if (was != null) onRevert(); return; }
    setRecent(rememberRecentFont(family));
    onCommit(family);
  };
  const move = (by: number) => {
    if (!options.length) return;
    const next = Math.max(0, Math.min(options.length - 1, active + by));
    keyed.current = true;
    setActive(next);
    show(options[next]);
  };

  /* the project's families the page cannot draw: marked in the menu as the field marks one */
  const unavailable = (family: string) => {
    if (installed == null) return false;
    const known = knownAvailable(family, installed, project, page);
    return known == null ? !familyRenders(family) : !known;
  };

  let index = -1;
  const rowOf = (row: FontRow, section: SectionId) => {
    index += 1;
    const i = index;
    const glyph = sampleOf(row);
    const current = row.family === origin.current;
    const gone = section === 'project' && unavailable(row.family);
    return (
      <button
        key={`${section}:${row.family}`}
        type="button"
        role="option"
        aria-selected={i === active}
        data-index={i}
        onPointerEnter={() => { setActive(i); show(row.family); }}
        onClick={() => pick(row.family)}
        className={`flex w-full items-center gap-2 px-2.5 py-1 text-left ${i === active ? 'bg-[var(--bg-hover)]' : ''}`}
      >
        <span className="flex w-3 shrink-0 justify-center">
          {current ? <Check size={12} className="text-[var(--accent)]" aria-hidden /> : null}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-[14px] ${row.elsewhere ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}
          style={{ fontFamily: rowFontFamily(row) }}
        >
          {row.family}
        </span>
        {gone ? <AlertTriangle size={11} className="shrink-0 text-[var(--warn)]" aria-label={t('inspector.fontMissing')} /> : null}
        {row.elsewhere ? <span className="shrink-0 text-[10px] text-[var(--text-faint)]">{t('inspector.fontElsewhere')}</span> : null}
        {glyph ? (
          <span aria-hidden className="shrink-0 text-[13px] text-[var(--text-faint)]" style={{ fontFamily: rowFontFamily(row) }}>{glyph}</span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) { close(); return; }
          origin.current = value;
          setOpen(true);
        }}
        className={`${className} cursor-default text-left`}
      >
        <span className="w-2 shrink-0" />
        <span
          className={`min-w-0 flex-1 truncate text-[11px] ${missing ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}
          style={value ? { fontFamily: rowFontFamily({ family: value, project: project.some((f) => f.family === value) }) } : undefined}
        >
          {value || '—'}
        </span>
        {missing ? (
          <Tooltip label={t('inspector.fontMissing')}>
            <span className="mr-1 flex shrink-0 items-center text-[var(--warn)]" aria-label={t('inspector.fontMissing')} role="img">
              <AlertTriangle size={12} aria-hidden />
            </span>
          </Tooltip>
        ) : null}
        <ChevronDown size={12} className="mr-1.5 shrink-0 text-[var(--text-faint)]" aria-hidden />
      </button>
      {open && at && typeof document !== 'undefined' ? createPortal(
        /* drawn on body, yet part of the inspector: the stage sees data-film-inspector and does not take a click or
           Esc here as "clicked elsewhere, drop the selection" */
        <div data-film-inspector="">
          <div className="fixed inset-0 z-[10150]" onPointerDown={close} aria-hidden />
          <div
            role="dialog"
            aria-label={label}
            className="fixed z-[10151] flex flex-col overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-lg)]"
            style={{ left: at.left, top: at.top, width: at.width, maxHeight: at.maxHeight }}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('inspector.fontSearch')}
              aria-label={t('inspector.fontSearch')}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
                else if (e.key === 'Enter') { e.preventDefault(); const f = options[active]; if (f) pick(f); }
                /* close the menu only: bubbling up, the stage would take it as "deselect" */
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
              }}
              className="h-8 shrink-0 border-b border-[var(--border)] bg-transparent px-2.5 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
            />
            <div
              ref={listRef}
              role="listbox"
              className="min-h-0 flex-1 overflow-y-auto py-1"
              /* the hand left the rows: the picture shows the layer's own font again */
              onPointerLeave={() => show(undefined)}
            >
              {installed == null && !rows.length ? (
                <p className="px-2.5 py-2 text-[12px] text-[var(--text-faint)]">{t('inspector.fontLoading')}</p>
              ) : null}
              {sections.map((s) => (
                <div key={s.id} role="group" aria-label={t(SECTION_LABEL[s.id])}>
                  <div className="px-2.5 pb-0.5 pt-1.5 text-[10.5px] font-medium text-[var(--text-faint)]">{t(SECTION_LABEL[s.id])}</div>
                  {s.rows.map((row) => rowOf(row, s.id))}
                </div>
              ))}
              {custom ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={active === options.length - 1}
                  data-index={options.length - 1}
                  onPointerEnter={() => { setActive(options.length - 1); show(custom); }}
                  onClick={() => pick(custom)}
                  className={`flex w-full items-center px-2.5 py-1.5 text-left text-[12px] text-[var(--text-muted)] ${active === options.length - 1 ? 'bg-[var(--bg-hover)]' : ''}`}
                >
                  {t('inspector.fontUse').replace('{name}', custom)}
                </button>
              ) : null}
              {installed != null && !options.length ? (
                <p className="px-2.5 py-2 text-[12px] text-[var(--text-faint)]">{t('inspector.fontNone')}</p>
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
