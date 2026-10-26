/** Version history: a date-ordered list, the selected version's film, and the files it changed. */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  File,
  Film,
  History,
  ListFilter,
  ListChecks,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Undo2,
  Trash2,
  X,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import {
  filterHistoryVersions,
  HISTORY_VERSION_TYPES,
  historyApi,
  historyVersionType,
  versionLabel,
  type Change,
  type HistoryProgress,
  type HistoryVersionType,
  type HistoryState,
  type Version,
} from '@/lib/project-history';
import { Card, CardActions, CardButton } from './Card';
import { LARGE_DIALOG, LARGE_DIALOG_BACKDROP } from './dialog-chrome';
import { Tooltip } from './Tooltip';
import { VersionVideoPreview } from './VersionVideoPreview';
import type { ProjectHistory } from './use-project-history';

type Translate = (key: string) => string;
type Dialog = { kind: 'save' } | { kind: 'discard' } | { kind: 'restore' | 'copy'; version: Version } | { kind: 'delete'; commits: string[] };

function progressText(progress: HistoryProgress, t: Translate): string {
  const key = {
    scan: 'versions.progressScan',
    store: 'versions.progressStore',
    write: 'versions.progressWrite',
    migrate: 'versions.progressMigrate',
  }[progress.phase];
  return t(key).replace('{done}', String(progress.done)).replace('{total}', String(progress.total));
}

export function ProjectHistoryButton({
  open,
  onClick,
  className,
}: {
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <Tooltip label={t('projectMenu.history')} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={t('projectMenu.history')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={className}
      >
        <History size={16} />
      </button>
    </Tooltip>
  );
}

export function ProjectHistoryControls({
  projectId,
  projectName,
  history,
  open,
  onClose,
  onOpenProject,
}: {
  projectId: string;
  projectName: string;
  history: ProjectHistory;
  open: boolean;
  onClose: () => void;
  onOpenProject: (id: string) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const { state, busy, progress, refresh } = history;
  const [selected, setSelected] = React.useState<string | null>(null);
  const [deletedView, setDeletedView] = React.useState(false);
  const [deletedState, setDeletedState] = React.useState<HistoryState | null>(null);
  const [deletedFailed, setDeletedFailed] = React.useState(false);
  const [deletedLimit, setDeletedLimit] = React.useState(50);
  const [deletedAttempt, setDeletedAttempt] = React.useState(0);
  const [selecting, setSelecting] = React.useState(false);
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = React.useState('');
  const [typeOverride, setTypeOverride] = React.useState<ReadonlySet<HistoryVersionType> | null>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const filterBox = React.useRef<HTMLDivElement>(null);
  const filterButton = React.useRef<HTMLButtonElement>(null);
  const filterPanelId = React.useId();
  const filtersOpenRef = React.useRef(filtersOpen);
  filtersOpenRef.current = filtersOpen;
  const [namedOnly, setNamedOnly] = React.useState(false);
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const [input, setInput] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<Change[] | null>(null);
  const [filesFailed, setFilesFailed] = React.useState(false);
  const [filesAttempt, setFilesAttempt] = React.useState(0);
  const [filesExpanded, setFilesExpanded] = React.useState(true);
  const filesPanelId = React.useId();
  const panel = React.useRef<HTMLDivElement>(null);
  const close = React.useRef(onClose);
  close.current = onClose;
  const dialogRef = React.useRef(dialog);
  dialogRef.current = dialog;
  const status = state?.status;
  const changes = status?.changes;
  const listState = deletedView ? deletedState : state;
  const all = React.useMemo(() => listState?.versions ?? [], [listState]);
  // Search and type filters never change the selected video or remove the current-editing entry.
  const selectedVersion = all.find((v) => v.commit === selected) ?? null;
  const working = !selectedVersion;
  const isHead = selectedVersion?.commit === status?.head;
  const shownTypes = typeOverride ?? new Set(HISTORY_VERSION_TYPES.filter((type) => type !== 'auto'));
  const filtersActive = shownTypes.size !== HISTORY_VERSION_TYPES.length || namedOnly;
  const dates = React.useMemo(
    () => ({
      clock: new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }),
      day: new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric' }),
      full: new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    }),
    [language]
  );
  const label = (v: Version) => {
    const l = versionLabel(v, all);
    return l.key
      ? t(l.key)
          .replace('{name}', l.name ?? '')
          .replace('{time}', l.at ? dates.full.format(l.at) : '')
      : l.name ?? '';
  };
  const dayOf = (at: number) => {
    const day = new Date(at).toDateString();
    if (day === new Date().toDateString()) return t('versions.today');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return day === yesterday.toDateString() ? t('versions.yesterday') : dates.day.format(at);
  };

  const typeLabel = (v: Version) =>
    t(`versions.type${historyVersionType(v)[0].toUpperCase()}${historyVersionType(v).slice(1)}`);
  const versions = filterHistoryVersions(all, {
    types: shownTypes,
    namedOnly,
    search,
    textOf: (v) => [label(v), typeLabel(v), v.at > 0 ? dates.full.format(v.at) : '', dayOf(v.at)].join(' '),
  });
  const selectable = versions.filter((version) => deletedView || version.commit !== status?.head);
  const selectedCommits = [...checked].filter((id) => all.some((version) => version.commit === id) && (deletedView || id !== status?.head));
  const switchView = (deleted: boolean) => {
    setDeletedView(deleted);
    setSelected(null);
    setSelecting(false);
    setChecked(new Set());
    setNotice(null);
    setSearch('');
    setNamedOnly(false);
    setTypeOverride(deleted ? new Set(HISTORY_VERSION_TYPES) : null);
  };
  const toggleChecked = (id: string) => setChecked((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  React.useEffect(() => {
    if (!open || !deletedView) return;
    let live = true;
    setDeletedFailed(false);
    void historyApi.load(projectId, deletedLimit, true).then((fresh) => {
      if (!live) return;
      if (fresh) setDeletedState(fresh);
      setDeletedFailed(!fresh);
    });
    return () => { live = false; };
  }, [open, projectId, deletedView, deletedLimit, deletedAttempt, state?.deletedCount]);
  React.useEffect(() => { setChecked(new Set()); }, [search, namedOnly, typeOverride]);
  const resetFilters = () => {
    setSearch('');
    setNamedOnly(false);
    setTypeOverride(new Set(HISTORY_VERSION_TYPES));
  };
  React.useEffect(() => {
    if (!filtersOpen) return;
    const outside = (event: PointerEvent) => {
      if (!filterBox.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [filtersOpen]);

  React.useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);
  React.useEffect(() => {
    setSelected(null);
    setDeletedView(false);
    setDeletedState(null);
    setDeletedLimit(50);
    setSelecting(false);
    setChecked(new Set());
    setNamedOnly(false);
    setSearch('');
    setTypeOverride(null);
    setFiltersOpen(false);
    setDialog(null);
    setNotice(null);
  }, [open, projectId]);
  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('[data-history-close]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (dialogRef.current || e.defaultPrevented) return;
      if (e.key === 'Escape' && filtersOpenRef.current) {
        e.preventDefault();
        setFiltersOpen(false);
        filterButton.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      }
      if (e.key === 'Tab') {
        const buttons = [
          ...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []),
        ].filter((el) => el.getClientRects().length);
        const first = buttons[0],
          last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open]);
  const commit = selectedVersion?.commit ?? null;
  React.useEffect(() => {
    if (!open || !commit || deletedView) return;
    let active = true;
    setFiles(null);
    setFilesFailed(false);
    void historyApi.versionFiles(projectId, commit).then((result) => {
      if (active) {
        setFiles(result);
        setFilesFailed(result === null);
      }
    });
    return () => {
      active = false;
    };
  }, [open, projectId, commit, filesAttempt, deletedView]);

  if (!open) return null;
  const currentFiles = working ? changes?.files ?? [] : files;
  const currentCount = working ? changes?.count ?? 0 : currentFiles?.length ?? 0;
  const title = selectedVersion ? label(selectedVersion) : t(deletedView ? 'versions.deletedVersions' : 'versions.workingCopy');
  const recover = async (commits: string[]) => {
    if (await history.recover(commits)) {
      setChecked(new Set());
      setSelected(null);
      setNotice(t('versions.recoveredRecords').replace('{n}', String(commits.length)));
    }
  };
  const restore = async (v: Version, saveFirst: boolean) => {
    setDialog(null);
    if (saveFirst && !(await history.save(''))) return;
    const result = await history.checkout(v.commit);
    if (result.ok) {
      setSelected(v.commit);
      setNotice(result.body.missing?.length ? t('versions.missing') : t('versions.restored'));
    } else if (result.code === 'dirty') setDialog({ kind: 'restore', version: v });
  };
  const submit = async () => {
    if (!dialog) return;
    if (dialog.kind === 'delete') {
      const commits = dialog.commits;
      setDialog(null);
      if (await history.delete(commits)) {
        setChecked(new Set());
        if (selected && commits.includes(selected)) setSelected(null);
        setNotice(t('versions.deletedRecords').replace('{n}', String(commits.length)));
      }
      return;
    }
    if (dialog.kind === 'restore') {
      await restore(dialog.version, !!changes);
      return;
    }
    if (dialog.kind === 'discard') {
      setDialog(null);
      if (await history.discard()) setSelected(null);
      return;
    }
    if (dialog.kind === 'save') {
      if (await history.save(input.trim())) {
        setDialog(null);
        setSelected(null);
      }
    } else {
      setDialog(null);
      const result = await history.copy(dialog.version.commit, input.trim());
      if (result.ok) onOpenProject(result.body.project.id);
    }
  };
  const askTitle = !dialog
    ? ''
    : dialog.kind === 'save'
    ? t('versions.saveTitle')
    : dialog.kind === 'copy'
    ? t('versions.copyTitle').replace('{name}', label(dialog.version))
    : dialog.kind === 'discard'
    ? t('versions.discardTitle')
    : dialog.kind === 'delete'
    ? t('versions.deleteTitle').replace('{n}', String(dialog.commits.length))
    : t('versions.restoreTitle').replace('{name}', label(dialog.version));
  const askBody = !dialog
    ? ''
    : dialog.kind === 'save'
    ? t('versions.saveBody')
    : dialog.kind === 'copy'
    ? t('versions.copyBody')
    : dialog.kind === 'discard'
    ? t('versions.discardBody')
    : dialog.kind === 'delete'
    ? t('versions.deleteBody')
    : t(changes ? 'versions.saveRestoreBody' : 'versions.restoreBody');
  let previousDay = '';
  return (
    <>
      {createPortal(
        <div
          className={LARGE_DIALOG_BACKDROP}
          onClick={() => {
            if (!dialogRef.current && !busy) onClose();
          }}
        >
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={t('versions.title')}
            className={LARGE_DIALOG}
            style={{ animation: 'openfilm-rise 0.16s ease-out both' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
            }}
          >
            <aside className="flex min-h-0 w-[180px] shrink-0 flex-col border-r border-[var(--border-soft)] bg-[var(--surface-2)] sm:w-[260px]">
              <div className="flex shrink-0 items-center gap-2 px-5 pb-4 pt-5">
                <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{t('versions.title')}</h2>
                <button type="button" disabled={!!busy || !state} aria-label={t(selecting ? 'versions.cancelSelection' : 'versions.selectVersions')} aria-pressed={selecting}
                  onClick={() => { setSelecting(!selecting); setChecked(new Set()); }}
                  className={`flex shrink-0 items-center gap-1 rounded-lg p-1.5 text-[11px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] disabled:opacity-40 ${selecting ? 'bg-[var(--surface)] text-[var(--text)]' : ''}`}>
                  <ListChecks size={14} /><span className="hidden sm:inline">{t(selecting ? 'versions.cancelSelection' : 'versions.selectVersions')}</span>
                </button>
              </div>
              <div className="mx-3 mb-3 grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-[var(--fill-tsp)] p-1">
                <button type="button" disabled={!!busy} aria-pressed={!deletedView} onClick={() => switchView(false)} className={`rounded-md px-2 py-1.5 text-[11px] ${!deletedView ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>{t('versions.savedVersions')}</button>
                <button type="button" disabled={!!busy} aria-pressed={deletedView} onClick={() => switchView(true)} className={`rounded-md px-2 py-1.5 text-[11px] ${deletedView ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>{t('versions.deletedVersions')} {state?.deletedCount ? `(${state.deletedCount})` : ''}</button>
              </div>
              <div ref={filterBox} className="relative z-10 mx-3 mb-4 flex shrink-0 gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    size={13}
                    aria-hidden
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label={t('versions.search')}
                    placeholder={t('versions.search')}
                    className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
                  />
                </div>
                <button
                  ref={filterButton}
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-label={t('versions.filterVersions')}
                  aria-expanded={filtersOpen}
                  aria-controls={filterPanelId}
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition ${
                    filtersActive || filtersOpen
                      ? 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <ListFilter size={14} strokeWidth={filtersActive ? 2.25 : 1.6} />
                </button>
                {filtersOpen ? (
                  <fieldset
                    id={filterPanelId}
                    aria-label={t('versions.filterVersions')}
                    className="absolute left-0 right-0 top-[calc(100%+6px)] rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-2.5 shadow-[var(--shadow-lg)]"
                  >
                    <legend className="sr-only">{t('versions.filterVersions')}</legend>
                    <p className="px-1 pb-2 text-[10px] font-medium text-[var(--text-faint)]">
                      {t('versions.versionTypes')}
                    </p>
                    {HISTORY_VERSION_TYPES.map((type) => (
                      <label
                        key={type}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-[12px] hover:bg-[var(--bg-hover)]"
                      >
                        <input
                          type="checkbox"
                          checked={shownTypes.has(type)}
                          onChange={(e) => {
                            const next = new Set(shownTypes);
                            if (e.target.checked) next.add(type);
                            else next.delete(type);
                            setTypeOverride(next);
                          }}
                          className="h-3 w-3 accent-[var(--text)]"
                        />
                        <span className="flex-1">{t(`versions.type${type[0].toUpperCase()}${type.slice(1)}`)}</span>
                        <span className="text-[10px] tabular-nums text-[var(--text-faint)]">
                          {all.filter((v) => historyVersionType(v) === type).length}
                        </span>
                      </label>
                    ))}
                    <div className="my-2 border-t border-[var(--border-soft)]" />
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-[11px] hover:bg-[var(--bg-hover)]">
                      <input
                        type="checkbox"
                        checked={namedOnly}
                        onChange={(e) => setNamedOnly(e.target.checked)}
                        className="h-3 w-3 accent-[var(--text)]"
                      />
                      {t('versions.namedOnly')}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setTypeOverride(new Set(HISTORY_VERSION_TYPES));
                        setNamedOnly(false);
                      }}
                      className="mt-2 w-full rounded-md border border-[var(--border)] py-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                    >
                      {t('versions.showAllTypes')}
                    </button>
                  </fieldset>
                ) : null}
              </div>
              <div className="shrink-0 px-3 pb-3">
                <button
                  type="button"
                  disabled={!state}
                  onClick={() => {
                    switchView(false);
                  }}
                  aria-pressed={working && !deletedView}
                  className={`relative flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left transition ${
                    working && !deletedView ? 'bg-[var(--surface)] shadow-[var(--shadow-sm)]' : 'hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {working && !deletedView ? (
                    <span aria-hidden className="absolute bottom-4 left-0 top-4 w-0.5 rounded-full bg-[var(--text)]" />
                  ) : null}
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--fill-tsp)] text-[var(--text-muted)]">
                    <Film size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold">{t('versions.workingCopy')}</span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-[var(--text-muted)]">
                      {!state
                        ? t('versions.working')
                        : changes
                        ? t('versions.unsavedFiles').replace('{n}', String(changes.count))
                        : t('versions.matchesSaved')}
                    </span>
                  </span>
                  {state && !changes ? (
                    <Check size={12} aria-hidden className="shrink-0 text-[var(--text-faint)]" />
                  ) : null}
                </button>
              </div>
              {selecting && <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-soft)] px-4 py-2 text-[11px]">
                <button type="button" disabled={!!busy || !selectable.length} onClick={() => setChecked(new Set(selectable.every((version) => checked.has(version.commit)) ? [] : selectable.map((version) => version.commit)))} className="text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40">{t(selectable.length && selectable.every((version) => checked.has(version.commit)) ? 'versions.clearSelection' : 'versions.selectVisible')}</button>
                <span className="flex-1 text-[var(--text-faint)]">{t('versions.selectionCount').replace('{n}', String(selectedCommits.length))}</span>
                <button type="button" disabled={!!busy || !selectedCommits.length} onClick={() => deletedView ? void recover(selectedCommits) : setDialog({ kind: 'delete', commits: selectedCommits })} className={`flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-[var(--bg-hover)] disabled:opacity-40 ${deletedView ? 'text-[var(--text)]' : 'text-[var(--err)]'}`}>
                  {deletedView ? <RotateCcw size={12} /> : <Trash2 size={12} />}{t(deletedView ? 'versions.recoverRecords' : 'versions.deleteSelected')}
                </button>
              </div>}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-[var(--border-soft)] px-3 pb-3">
                {deletedView && !deletedState && !deletedFailed ? <Loader2 size={15} className="mx-auto my-6 animate-spin text-[var(--text-faint)]" /> : null}
                {deletedView && deletedFailed ? <button type="button" onClick={() => setDeletedAttempt((n) => n + 1)} className="px-2 py-4 text-[12px] text-[var(--text-muted)]">{t('versions.loadFailed')} {t('versions.retry')}</button> : null}
                {versions.map((v) => {
                  const day = dayOf(v.at),
                    showDay = previousDay !== day;
                  previousDay = day;
                  const chosen = selectedVersion?.commit === v.commit;
                  const type = historyVersionType(v),
                    description = typeLabel(v);
                  const Icon =
                    v.name && type === 'manual'
                      ? Bookmark
                      : { manual: Save, auto: Clock3, restore: RotateCcw, other: History }[type];
                  return (
                    <React.Fragment key={v.commit}>
                      {showDay ? (
                        <p className="px-2 pb-2 pt-4 text-[10px] font-medium text-[var(--text-faint)]">{day}</p>
                      ) : null}
                      <div className="flex items-start gap-1">
                      {selecting && <input type="checkbox" checked={checked.has(v.commit) && (deletedView || v.commit !== status?.head)} disabled={!!busy || (!deletedView && v.commit === status?.head)}
                        aria-label={t('versions.selectVersion').replace('{name}', label(v))} title={!deletedView && v.commit === status?.head ? t('versions.errorDeleteCurrent') : undefined}
                        onChange={() => toggleChecked(v.commit)} className="ml-1 mt-4 h-3.5 w-3.5 shrink-0 accent-[var(--text)] disabled:opacity-30" />}
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(v.commit);
                          setNotice(null);
                        }}
                        aria-pressed={chosen}
                        className={`relative mb-1 flex min-w-0 flex-1 items-start gap-2.5 rounded-xl px-3 py-3 text-left transition ${
                          chosen ? 'bg-[var(--surface)] shadow-[var(--shadow-sm)]' : 'hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        {chosen ? (
                          <span
                            aria-hidden
                            className="absolute bottom-4 left-0 top-4 w-0.5 rounded-full bg-[var(--text)]"
                          />
                        ) : null}
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--fill-tsp)] text-[var(--text-faint)]">
                          <Icon size={13} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`line-clamp-2 break-words text-[12px] font-medium leading-relaxed ${
                              chosen ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
                            }`}
                            title={label(v)}
                          >
                            {label(v)}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] leading-relaxed text-[var(--text-faint)]">
                            <span className="tabular-nums">{v.at > 0 ? dates.clock.format(v.at) : ''}</span>
                            {label(v) !== description ? (
                              <>
                                <span aria-hidden>·</span>
                                <span>{description}</span>
                              </>
                            ) : null}
                          </span>
                          {v.commit === status?.head ? (
                            <span className="mt-1.5 inline-block rounded bg-[var(--fill-tsp)] px-1.5 text-[9px] leading-[17px] text-[var(--text-muted)]">
                              {t(changes ? 'versions.lastSaved' : 'versions.inUse')}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      </div>
                    </React.Fragment>
                  );
                })}
                {listState && !versions.length ? (
                  <div className="px-2 py-7 text-center">
                    <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                      {t(all.length ? 'versions.noMatchingVersions' : deletedView ? 'versions.noDeletedVersions' : 'versions.noVersions')}
                    </p>
                    {all.length ? (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-2 text-[11px] text-[var(--text-muted)] underline underline-offset-4"
                      >
                        {t('versions.resetFilters')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {listState?.more ? (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => deletedView ? setDeletedLimit((limit) => limit + 50) : void history.showMore()}
                    className="w-full px-3 py-2 text-left text-[11px] text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    {t('versions.showMore')}
                  </button>
                ) : null}
              </div>
              {working && state && !deletedView ? (
                <div className="shrink-0 border-t border-[var(--border-soft)] p-3">
                  <button
                    type="button"
                    disabled={!!busy || !changes}
                    title={!changes ? t('versions.matchesSaved') : undefined}
                    onClick={() => {
                      setInput('');
                      setDialog({ kind: 'save' });
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-[12px] hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-40"
                  >
                    <Plus size={13} />
                    {t('versions.saveVersion')}
                  </button>
                </div>
              ) : null}
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex shrink-0 items-start gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[14px] font-semibold" title={title}>
                    {title}
                  </h3>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                    {selectedVersion ? dates.full.format(selectedVersion.at) : t('versions.workingCopyHint')}
                  </p>
                </div>
                {busy ? <Loader2 size={15} className="mt-1 animate-spin text-[var(--text-faint)]" /> : null}
                <button
                  data-history-close
                  type="button"
                  onClick={onClose}
                  aria-label={t('versions.close')}
                  className="rounded-lg p-1 text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                >
                  <X size={16} />
                </button>
              </header>
              {!state ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                  {history.failed ? (
                    <>
                      <p className="text-[12px] text-[var(--text-muted)]">{t('versions.loadFailed')}</p>
                      <CardButton onClick={() => void refresh()}>{t('versions.retry')}</CardButton>
                    </>
                  ) : (
                    <Loader2 size={18} className="animate-spin text-[var(--text-faint)]" />
                  )}
                </div>
              ) : deletedView ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-[var(--text-faint)]">
                  <Trash2 size={28} strokeWidth={1.3} />
                  <p className="max-w-sm text-[12px] leading-relaxed">{t('versions.deletedPreviewHint')}</p>
                  {selectedVersion && <CardButton disabled={!!busy} onClick={() => void recover([selectedVersion.commit])}><RotateCcw size={12} />{t('versions.recoverRecords')}</CardButton>}
                </div>
              ) : (
                <div
                  className="grid min-h-0 flex-1"
                  style={{ gridTemplateRows: `minmax(0, 1fr) ${filesExpanded ? 'clamp(128px, 22dvh, 216px)' : '40px'}` }}
                >
                  <VersionVideoPreview
                    key={`${projectId}:${commit ?? 'working'}`}
                    projectId={projectId}
                    commit={commit}
                  />
                  <section className="flex min-h-0 flex-col border-t border-[var(--border-soft)]" aria-label={t('versions.fileChanges')}>
                    <div className="flex h-10 shrink-0 items-center gap-2 px-5">
                      <h4 className="min-w-0 text-[12px] font-medium">
                        <button
                          type="button"
                          onClick={() => setFilesExpanded((expanded) => !expanded)}
                          aria-expanded={filesExpanded}
                          aria-controls={filesPanelId}
                          className="flex items-center gap-2 rounded py-1 text-[var(--text-muted)] transition hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                        >
                          <ChevronRight size={13} className={`shrink-0 transition-transform ${filesExpanded ? 'rotate-90' : ''}`} />
                          {t('versions.fileChanges')}
                          <span className="rounded bg-[var(--fill-tsp)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--text-faint)]">{currentCount}</span>
                        </button>
                      </h4>
                      <span className="ml-auto hidden text-[10px] text-[var(--text-faint)] md:inline">
                        {t(working ? 'versions.sinceSaved' : 'versions.sincePrevious')}
                      </span>
                      {working && changes && status?.head ? (
                        <Tooltip label={t('versions.discardAll')}>
                          <button
                            type="button"
                            disabled={!!busy}
                            onClick={() => setDialog({ kind: 'discard' })}
                            aria-label={t('versions.discardAll')}
                            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                          >
                            <Undo2 size={13} />
                          </button>
                        </Tooltip>
                      ) : null}
                    </div>
                    <div id={filesPanelId} hidden={!filesExpanded} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2 [scrollbar-gutter:stable]">
                      {!working && filesFailed ? (
                        <button
                          type="button"
                          onClick={() => setFilesAttempt((n) => n + 1)}
                          className="px-2 py-1 text-[12px] text-[var(--text-muted)]"
                        >
                          {t('versions.filesFailed')} <span className="underline">{t('versions.retry')}</span>
                        </button>
                      ) : currentFiles === null ? (
                        <div className="px-2 py-2">
                          <Loader2 size={13} className="animate-spin text-[var(--text-faint)]" />
                        </div>
                      ) : currentFiles.length ? (
                        <ul>
                          {currentFiles.map((f) => (
                            <FileRow key={f.path} file={f} t={t} />
                          ))}
                          {currentCount > currentFiles.length ? (
                            <li className="px-2 py-1 text-[11px] text-[var(--text-faint)]">
                              {t('versions.moreFiles').replace('{n}', String(currentCount - currentFiles.length))}
                            </li>
                          ) : null}
                        </ul>
                      ) : (
                        <p className="px-2 pb-2 text-[12px] text-[var(--text-faint)]">{t('versions.noChanges')}</p>
                      )}
                    </div>
                  </section>
                </div>
              )}
              <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] px-5 py-3.5">
                <div
                  className="min-w-0 flex-1 basis-full text-[11px] leading-relaxed text-[var(--text-muted)] lg:basis-0"
                  role="status"
                >
                  {progress
                    ? progressText(progress, t)
                    : notice ?? t(deletedView ? 'versions.deletedPreviewHint' : working ? 'versions.workingCopyHint' : 'versions.previewHint')}
                </div>
                {selectedVersion && !deletedView ? (
                  <>
                    <CardButton
                      weight="quiet"
                      disabled={!!busy || !!isHead}
                      title={isHead ? t('versions.errorDeleteCurrent') : undefined}
                      onClick={() => setDialog({ kind: 'delete', commits: [selectedVersion.commit] })}
                    ><Trash2 size={12} />{t('versions.deleteVersion')}</CardButton>
                    <CardButton
                      className="ml-auto"
                      disabled={!!busy}
                      onClick={() => {
                        setInput(
                          t('versions.copyDefault')
                            .replace('{project}', projectName)
                            .replace('{name}', label(selectedVersion))
                        );
                        setDialog({ kind: 'copy', version: selectedVersion });
                      }}
                    >
                      {t('versions.copy')}
                    </CardButton>
                    <CardButton
                      weight="primary"
                      disabled={!!busy || (!!isHead && !changes)}
                      onClick={() => setDialog({ kind: 'restore', version: selectedVersion })}
                    >
                      <RotateCcw size={12} />
                      {t('versions.restore')}
                    </CardButton>
                  </>
                ) : null}
              </footer>
            </div>
          </div>
        </div>,
        document.body
      )}
      {dialog ? (
        <Ask
          title={askTitle}
          body={askBody}
          onCancel={() => setDialog(null)}
          input={
            dialog.kind === 'save' || dialog.kind === 'copy'
              ? {
                  value: input,
                  onChange: setInput,
                  placeholder: t(dialog.kind === 'save' ? 'versions.namePlaceholder' : 'versions.copyName'),
                }
              : undefined
          }
          actions={[
            { label: t('versions.cancel'), weight: 'quiet', onClick: () => setDialog(null) },
            {
              label: t(
                dialog.kind === 'save'
                  ? 'versions.saveVersion'
                  : dialog.kind === 'copy'
                  ? 'versions.copyConfirm'
                  : dialog.kind === 'discard'
                  ? 'versions.discardConfirm'
                  : dialog.kind === 'delete'
                  ? 'versions.deleteConfirm'
                  : changes
                  ? 'versions.saveAndRestore'
                  : 'versions.restore'
              ),
              weight: dialog.kind === 'discard' || dialog.kind === 'delete' ? 'danger' : 'primary',
              disabled: !!busy || (dialog.kind === 'copy' && !input.trim()),
              onClick: () => void submit(),
            },
          ]}
        />
      ) : null}
    </>
  );
}

function FileRow({ file, t }: { file: Change; t: Translate }) {
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1),
    dir = file.path.slice(0, Math.max(0, slash));
  const color = { added: 'var(--ok)', modified: 'var(--text-muted)', deleted: 'var(--err)' }[file.change];
  return (
    <li className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]" title={file.path}>
      <File size={13} className="shrink-0 text-[var(--text-faint)]" />
      <span
        className={`min-w-0 shrink truncate text-[12px] ${
          file.change === 'deleted' ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-dim)]'
        }`}
      >
        {name}
      </span>
      {dir ? (
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-faint)]">{dir}</span>
      ) : (
        <span className="flex-1" />
      )}
      <span className="shrink-0 text-[10px]" style={{ color }}>
        {t(`versions.file${file.change[0].toUpperCase()}${file.change.slice(1)}`)}
      </span>
    </li>
  );
}

/** A question in the middle of the window: a few words, maybe a field, and its choices (the last one is the default). */
function Ask({
  title,
  body,
  input,
  actions,
  onCancel,
}: {
  title: string;
  body?: string;
  input?: { value: string; onChange: (value: string) => void; placeholder: string };
  actions: Array<{
    label: string;
    weight: 'primary' | 'secondary' | 'quiet' | 'danger';
    disabled?: boolean;
    onClick: () => void;
  }>;
  onCancel: () => void;
}) {
  const field = React.useRef<HTMLInputElement>(null);
  const last = React.useRef<HTMLButtonElement>(null);
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (input ? field.current : last.current)?.focus();
    if (input) field.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
      if (e.key === 'Tab') {
        const controls = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input') ?? [])];
        const first = controls[0],
          end = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          end?.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previous?.isConnected && !(previous instanceof HTMLButtonElement && previous.disabled)) previous.focus();
      else document.querySelector<HTMLButtonElement>('[data-history-close]')?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const main = actions[actions.length - 1];
  return createPortal(
    <div
      className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      style={{ animation: 'openfilm-rise 0.16s ease-out both' }}
      onClick={onCancel}
    >
      <div
        ref={root}
        className="w-full max-w-[440px]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <Card title={title} body={body} onClose={onCancel}>
          {input ? (
            <form
              className="mt-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (main && !main.disabled) main.onClick();
              }}
            >
              <input
                ref={field}
                value={input.value}
                onChange={(e) => input.onChange(e.target.value)}
                placeholder={input.placeholder}
                aria-label={input.placeholder}
                maxLength={200}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') e.stopPropagation();
                }}
                className="h-8 w-full rounded-lg bg-[var(--surface-2)] px-2.5 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--border-strong)]"
              />
            </form>
          ) : null}
          <CardActions className="flex-wrap">
            {actions.map((a, i) => (
              <CardButton
                key={a.label}
                ref={i === actions.length - 1 ? last : undefined}
                weight={a.weight}
                disabled={a.disabled}
                onClick={a.onClick}
              >
                {a.label}
              </CardButton>
            ))}
          </CardActions>
        </Card>
      </div>
    </div>,
    document.body
  );
}
