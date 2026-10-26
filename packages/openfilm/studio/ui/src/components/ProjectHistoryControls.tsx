/**
 * The Version history panel: git as VS Code's Source Control shows it.
 *
 *   [ Message (⌘↵ to commit)      ]
 *   [ ✓ Commit                    ]
 *   ▾ Changes  3              ↶      the files changed against the version checked out (A, M, D); ↶ discards them
 *   ▾ Graph                          every version, newest first, drawn as a graph; the one checked out has a hollow
 *     ○ Another way   Current  12:04 dot and Current. A click lists what a version changed; ⋯ (or a right click):
 *     ● Two                    11:58 Checkout, Copy as a new project
 *
 * Checking out a version makes no version of its own: the folder holds its files and the next commit goes from there.
 * With changes, it asks first (commit them, or discard them and check out). Versions saved on their own (Auto
 * versions) are listed only when Settings › Advanced says so. Data and actions come from `useProjectHistory`.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Copy, GitBranch, History, Loader2, MoreHorizontal, Undo2, X } from 'lucide-react';
import { api, PREFS_EVENT } from '@/api';
import { useLanguage, useT } from '@/i18n';
import {
  graphRows, historyApi, isAutomatic, shownVersions, versionLabel,
  type Change, type GraphRow, type HistoryProgress, type Version,
} from '@/lib/project-history';
import { Card, CardActions, CardButton, POPOVER_CHROME } from './Card';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { Tooltip } from './Tooltip';
import type { ProjectHistory } from './use-project-history';

const PANEL_W = 400;
/** A graph row's height, and a lane's width (px). */
const ROW_H = 26;
const LANE_W = 12;
/** The graph's lanes, the first in the accent as VS Code draws the branch checked out. */
const LANE_COLORS = ['var(--accent)', '#e3a33b', '#b57bee', '#3fb27f', '#e8735a', '#5fb3d9'];

type Translate = (key: string) => string;

/** How far an action is, in a few words: "Keeping media… 3 of 20". */
function progressText(progress: HistoryProgress, t: Translate): string {
  const key = { scan: 'versions.progressScan', store: 'versions.progressStore', write: 'versions.progressWrite', migrate: 'versions.progressMigrate' }[progress.phase];
  return t(key).replace('{done}', String(progress.done)).replace('{total}', String(progress.total));
}

/** Times as the person's language writes them: today's as a clock time, others as a day. */
function useWhen() {
  const language = useLanguage();
  return React.useMemo(() => {
    const clock = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' });
    const day = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' });
    const dayYear = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric' });
    return (at: number) => {
      if (!(at > 0)) return '';
      const d = new Date(at);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return clock.format(at);
      return (d.getFullYear() === now.getFullYear() ? day : dayYear).format(at);
    };
  }, [language]);
}

/** A version's name as shown: its message, else what kind of version it is. */
function labelOf(v: Version, all: readonly Version[], t: Translate, when: (at: number) => string): string {
  const l = versionLabel(v, all);
  if (!l.key) return l.name ?? '';
  return t(l.key).replace('{name}', l.name ?? '').replace('{time}', l.at ? when(l.at) : '');
}

/** Whether Settings › Advanced lists versions saved on their own (read again when the settings change). */
function useShowAuto(open: boolean): boolean {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    if (!open) return undefined;
    const read = () => { void api.prefs().then((p) => setShow(p.showAutoVersions === true)).catch(() => {}); };
    read();
    window.addEventListener(PREFS_EVENT, read);
    return () => window.removeEventListener(PREFS_EVENT, read);
  }, [open]);
  return show;
}

/**
 * The top bar's Version history button. It carries `data-history-trigger`, which the panel's click-outside check
 * recognizes, so clicking it again toggles the panel instead of closing and reopening it.
 */
export function ProjectHistoryButton({ open, onClick, className }: {
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
        aria-expanded={open}
        data-history-trigger=""
        className={className}
      >
        <History size={16} />
      </button>
    </Tooltip>
  );
}

/** The questions the panel asks, one at a time. */
type Dialog =
  | { kind: 'checkout'; version: Version }
  | { kind: 'discard' }
  | { kind: 'copy'; version: Version };

export function ProjectHistoryControls({
  projectId,
  projectName,
  history,
  open,
  anchor,
  onClose,
  onOpenProject,
}: {
  projectId: string;
  /** the project's name: a copy is named after it */
  projectName: string;
  history: ProjectHistory;
  open: boolean;
  /**
   * The bottom-right corner (viewport px) of what opened it — the top bar's right cluster, `{ x: rect.right,
   * y: rect.bottom + 4 }`. The panel hangs from it leftward. Without it: the top right of the window.
   */
  anchor?: { x: number; y: number } | null;
  onClose: () => void;
  /** a copy was made: open it */
  onOpenProject: (id: string) => void;
}) {
  const t = useT();
  const when = useWhen();
  const showAuto = useShowAuto(open);
  const { state, busy, progress } = history;
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [message, setMessage] = React.useState('');
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const [changesOpen, setChangesOpen] = React.useState(true);
  const [graphOpen, setGraphOpen] = React.useState(true);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const dialogRef = React.useRef(dialog);
  dialogRef.current = dialog;

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      /* a question is answered first; it is not a click away from the panel */
      if (dialogRef.current) return;
      const target = event.target as Element;
      if (panelRef.current?.contains(target)) return;
      /* its menus are drawn outside it */
      if (target.closest?.('[role="menu"]')) return;
      /* the button that opens it toggles it itself; closing here first would let its click reopen it */
      if (target.closest?.('[data-history-trigger]')) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !dialogRef.current) onClose(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  /* loaded again on opening: versions may have been committed while it was closed */
  const { refresh } = history;
  React.useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  React.useEffect(() => { if (!open) { setExpanded(null); setNotice(null); } }, [open]);

  const status = state?.status ?? null;
  const all = React.useMemo(() => state?.versions ?? [], [state]);
  const versions = React.useMemo(() => shownVersions(all, showAuto, status?.head ?? null), [all, showAuto, status?.head]);
  const rows = React.useMemo(() => graphRows(versions), [versions]);

  if (!open) return null;

  const changes = status?.changes ?? null;
  const label = (v: Version) => labelOf(v, all, t, when);
  const doCommit = async () => {
    if (!changes || busy) return;
    if (await history.save(message.trim())) { setMessage(''); setNotice(null); }
  };
  const doCheckout = async (version: Version, discard: boolean) => {
    setDialog(null);
    const result = await history.checkout(version.commit, discard);
    if (result.ok) setNotice(result.body.missing?.length ? t('versions.missing') : null);
    else if (result.code === 'dirty') setDialog({ kind: 'checkout', version });
  };
  const doDiscard = async () => {
    setDialog(null);
    await history.discard();
  };
  const doCopy = async (version: Version, typed: string) => {
    setDialog(null);
    const result = await history.copy(version.commit, typed);
    if (result.ok) onOpenProject(result.body.project.id);
  };
  const checkout = (version: Version) => {
    if (changes) setDialog({ kind: 'checkout', version });
    else void doCheckout(version, false);
  };

  return (
    <>
      {createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t('versions.title')}
          className="fixed z-[110] flex flex-col overflow-hidden"
          style={{
            ...POPOVER_CHROME,
            right: anchor ? Math.max(window.innerWidth - anchor.x, 12) : 12,
            top: anchor ? anchor.y : 40,
            width: PANEL_W,
            animation: 'openfilm-rise 0.14s ease-out both',
            maxHeight: `calc(100vh - ${(anchor ? anchor.y : 40) + 12}px)`,
          }}
        >
          <div className="flex shrink-0 items-center gap-2 py-2 pl-3.5 pr-2">
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{t('versions.title')}</span>
            {busy ? <Loader2 size={13} className="animate-spin text-[var(--text-faint)]" aria-label={t('versions.working')} /> : null}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('versions.close')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>

          {state === null && history.failed ? (
            <div role="alert" className="flex flex-col items-center gap-2 px-4 pb-6 pt-4 text-center">
              <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">{t('versions.loadFailed')}</p>
              <CardButton weight="secondary" onClick={() => void refresh()}>{t('versions.retry')}</CardButton>
            </div>
          ) : state === null ? (
            <div className="flex justify-center pb-6 pt-3"><Loader2 size={16} className="animate-spin text-[var(--text-faint)]" /></div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              {/* the message and Commit */}
              <form className="grid gap-1.5 px-3 pb-2" onSubmit={(event) => { event.preventDefault(); void doCommit(); }}>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={1}
                  maxLength={500}
                  aria-label={t('versions.messagePlaceholder')}
                  placeholder={t('versions.messagePlaceholder')}
                  disabled={busy !== null}
                  className="min-h-[28px] w-full resize-none rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] px-2 py-[5px] text-[12.5px] leading-[16px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]"
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void doCommit(); }
                  }}
                />
                <button
                  type="submit"
                  disabled={busy !== null || !changes}
                  className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] text-[12.5px] font-medium text-white transition hover:brightness-110 disabled:cursor-default disabled:opacity-40"
                >
                  {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {t('versions.commit')}
                </button>
              </form>
              {progress ? (
                <div role="status" className="px-3.5 pb-2">
                  <div className="truncate text-[11px] text-[var(--text-muted)]">{progressText(progress, t)}</div>
                  <div className="mt-1 h-[2px] overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-150" style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }} />
                  </div>
                </div>
              ) : null}
              {notice ? <p role="status" className="mx-3 mb-2 rounded-md bg-[var(--surface-2)] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-[var(--text-dim)]">{notice}</p> : null}

              {/* the changes */}
              <Section
                title={t('versions.changes')}
                count={changes?.count ?? 0}
                open={changesOpen}
                onToggle={() => setChangesOpen((v) => !v)}
                action={changes && status?.head ? (
                  <Tooltip label={t('versions.discardAll')} side="bottom">
                    <button type="button" aria-label={t('versions.discardAll')} disabled={busy !== null} onClick={() => setDialog({ kind: 'discard' })}
                      className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                      <Undo2 size={13} />
                    </button>
                  </Tooltip>
                ) : null}
              />
              {changesOpen ? (
                changes ? (
                  <ul className="pb-1">
                    {changes.files.map((f) => <FileRow key={f.path} file={f} indent={22} />)}
                    {changes.count > changes.files.length ? (
                      <li className="py-0.5 pl-[22px] text-[11px] text-[var(--text-faint)]">{t('versions.moreFiles').replace('{n}', String(changes.count - changes.files.length))}</li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="pb-1.5 pl-[22px] text-[11.5px] text-[var(--text-faint)]">{t('versions.noChanges')}</p>
                )
              ) : null}

              {/* the graph */}
              <Section title={t('versions.graph')} open={graphOpen} onToggle={() => setGraphOpen((v) => !v)} />
              {graphOpen ? (
                versions.length ? (
                  <ol>
                    {versions.map((v, i) => (
                      <VersionRow
                        key={v.commit}
                        projectId={projectId}
                        version={v}
                        row={rows[i]}
                        label={label(v)}
                        time={when(v.at)}
                        head={v.commit === status?.head}
                        expanded={expanded === v.commit}
                        busy={busy !== null}
                        t={t}
                        onToggle={() => setExpanded((cur) => (cur === v.commit ? null : v.commit))}
                        onCheckout={() => checkout(v)}
                        onCopy={() => setDialog({ kind: 'copy', version: v })}
                      />
                    ))}
                    {state.more ? (
                      <li>
                        <button type="button" onClick={() => void history.showMore()} className="w-full py-1 pl-[22px] text-left text-[11.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]">
                          {t('versions.showMore')}
                        </button>
                      </li>
                    ) : null}
                  </ol>
                ) : (
                  <p className="pb-1.5 pl-[22px] text-[11.5px] text-[var(--text-faint)]">{t('versions.noVersions')}</p>
                )
              ) : null}
            </div>
          )}
        </div>,
        document.body,
      )}
      <Questions
        dialog={dialog}
        label={dialog && dialog.kind !== 'discard' ? label(dialog.version) : ''}
        copyName={dialog && dialog.kind === 'copy' ? t('versions.copyDefault').replace('{project}', projectName).replace('{name}', label(dialog.version)) : ''}
        t={t}
        onCancel={() => setDialog(null)}
        onCheckout={(v) => void doCheckout(v, true)}
        onDiscard={() => void doDiscard()}
        onCopy={(v, typed) => void doCopy(v, typed)}
      />
    </>
  );
}

/** A section's header, as VS Code's: a chevron, the title in capitals, a count, and an action on the right. */
function Section({ title, count, open, onToggle, action }: { title: string; count?: number; open: boolean; onToggle: () => void; action?: React.ReactNode }) {
  return (
    <div className="group flex h-[22px] items-center pr-2.5">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1 pl-1.5 text-left">
        {open ? <ChevronDown size={14} className="shrink-0 text-[var(--text-muted)]" /> : <ChevronRight size={14} className="shrink-0 text-[var(--text-muted)]" />}
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">{title}</span>
      </button>
      {action}
      {count ? <span className="ml-1.5 rounded-full bg-[var(--surface-2)] px-1.5 text-[10.5px] tabular-nums leading-[16px] text-[var(--text-muted)]">{count}</span> : null}
    </div>
  );
}

const LETTER = { added: 'A', modified: 'M', deleted: 'D' } as const;
const LETTER_COLOR = { added: '#3fb27f', modified: '#e3a33b', deleted: '#e8735a' } as const;

/** A changed file, as VS Code lists it: its name, its folder dimmed, and its status letter. */
function FileRow({ file, indent }: { file: Change; indent: number }) {
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  const dir = slash < 0 ? '' : file.path.slice(0, slash);
  return (
    <li className="flex h-[22px] items-center gap-1.5 pr-3 hover:bg-[var(--bg-hover)]" style={{ paddingLeft: indent }} title={file.path}>
      <span className={`min-w-0 shrink truncate text-[12px] ${file.change === 'deleted' ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-dim)]'}`}>{name}</span>
      {dir ? <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-faint)]">{dir}</span> : <span className="flex-1" />}
      <span className="w-3 shrink-0 text-center text-[11px] font-semibold" style={{ color: LETTER_COLOR[file.change] }}>{LETTER[file.change]}</span>
    </li>
  );
}

const laneX = (i: number) => 9 + i * LANE_W;
const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length];

/** A row of the graph: the lanes through it, and its version's dot (hollow: the one checked out). */
function GraphCell({ row, head }: { row: GraphRow; head: boolean }) {
  const w = laneX(row.width - 1) + 9;
  const mid = ROW_H / 2;
  const path = (x1: number, y1: number, x2: number, y2: number) => (x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`);
  return (
    <svg width={w} height={ROW_H} className="shrink-0" aria-hidden>
      {row.up.map((l) => <path key={`u${l.from}`} d={path(laneX(l.from), 0, laneX(l.to), mid)} stroke={laneColor(l.from)} strokeWidth={1.5} fill="none" />)}
      {row.down.map((l) => <path key={`d${l.to}`} d={path(laneX(l.from), mid, laneX(l.to), ROW_H)} stroke={laneColor(l.to)} strokeWidth={1.5} fill="none" />)}
      <circle cx={laneX(row.col)} cy={mid} r={head ? 4.5 : 3.5} fill={head ? 'var(--bg-surface)' : laneColor(row.col)} stroke={laneColor(row.col)} strokeWidth={head ? 2 : 0} />
    </svg>
  );
}

/** The lanes going on below a row, drawn straight through what it lists when it is opened. */
function GraphThrough({ row }: { row: GraphRow }) {
  const w = laneX(row.width - 1) + 9;
  return (
    <svg width={w} className="absolute inset-y-0 left-0" height="100%" preserveAspectRatio="none" aria-hidden>
      {row.down.map((l) => <line key={l.to} x1={laneX(l.to)} x2={laneX(l.to)} y1="0" y2="100%" stroke={laneColor(l.to)} strokeWidth={1.5} />)}
    </svg>
  );
}

function VersionRow({ projectId, version, row, label, time, head, expanded, busy, t, onToggle, onCheckout, onCopy }: {
  projectId: string;
  version: Version;
  row: GraphRow;
  label: string;
  time: string;
  head: boolean;
  expanded: boolean;
  busy: boolean;
  t: Translate;
  onToggle: () => void;
  onCheckout: () => void;
  onCopy: () => void;
}) {
  const [menu, setMenu] = React.useState<{ x: number; y: number; top?: number } | null>(null);
  const [files, setFiles] = React.useState<Change[] | null>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!expanded || files) return;
    void historyApi.versionFiles(projectId, version.commit).then((f) => setFiles(f ?? []));
  }, [expanded, files, projectId, version.commit]);
  const items: ContextMenuEntry[] = [
    ...(head ? [] : [{ id: 'checkout', icon: <GitBranch size={14} />, label: t('versions.checkout'), onSelect: onCheckout }]),
    { id: 'copy', icon: <Copy size={14} />, label: t('versions.copy'), onSelect: onCopy },
  ];
  const quiet = isAutomatic(version);
  return (
    <li>
      <div
        className={`group flex h-[26px] items-center pr-1.5 ${expanded ? 'bg-[var(--bg-active)]' : 'hover:bg-[var(--bg-hover)]'}`}
        onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}
      >
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left">
          <GraphCell row={row} head={head} />
          <span className={`min-w-0 truncate text-[12.5px] ${head ? 'font-medium text-[var(--text)]' : quiet ? 'text-[var(--text-muted)]' : 'text-[var(--text-dim)]'}`}>{label}</span>
          {head ? <span className="shrink-0 rounded-full border border-[var(--accent)] px-1.5 text-[10px] leading-[15px] text-[var(--accent)]">{t('versions.current')}</span> : null}
          <span className="min-w-[8px] flex-1" />
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-faint)] group-hover:hidden">{time}</span>
        </button>
        <button
          ref={button}
          type="button"
          disabled={busy}
          aria-label={t('versions.moreActions')}
          aria-haspopup="menu"
          aria-expanded={menu != null}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setMenu((cur) => (cur ? null : { x: box.right, y: box.bottom + 4, top: box.top - 4 }));
          }}
          className={`h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] ${menu ? 'flex' : 'hidden group-hover:flex'}`}
        >
          <MoreHorizontal size={14} />
        </button>
        {menu ? <ContextMenu x={menu.x} y={menu.y} flipTo={menu.top} align={menu.top != null ? 'end' : 'start'} trigger={button} onClose={() => setMenu(null)} items={items} /> : null}
      </div>
      {expanded ? (
        <div className="relative">
          <GraphThrough row={row} />
          {files ? (
            <ul className="py-0.5">
              {files.map((f) => <FileRow key={f.path} file={f} indent={laneX(row.width - 1) + 22} />)}
            </ul>
          ) : (
            <div className="flex h-[22px] items-center" style={{ paddingLeft: laneX(row.width - 1) + 22 }}><Loader2 size={12} className="animate-spin text-[var(--text-faint)]" /></div>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Every question the panel asks, as one dialog whose words and choices follow what is asked. */
function Questions({ dialog, label, copyName, t, onCancel, onCheckout, onDiscard, onCopy }: {
  dialog: Dialog | null;
  label: string;
  copyName: string;
  t: Translate;
  onCancel: () => void;
  onCheckout: (v: Version) => void;
  onDiscard: () => void;
  onCopy: (v: Version, name: string) => void;
}) {
  const [value, setValue] = React.useState('');
  /* each question starts with its own default text */
  React.useEffect(() => {
    if (dialog?.kind === 'copy') setValue(copyName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);
  if (!dialog) return null;
  const cancel = { label: t('versions.cancel'), weight: 'quiet' as const, onClick: onCancel };
  switch (dialog.kind) {
    case 'checkout':
      return (
        <Ask title={t('versions.dirtyTitle')} body={t('versions.dirtyBody').replace('{name}', label)} onCancel={onCancel}
          actions={[cancel, { label: t('versions.discardAndCheckout'), weight: 'danger', onClick: () => onCheckout(dialog.version) }]} />
      );
    case 'discard':
      return (
        <Ask title={t('versions.discardTitle')} body={t('versions.discardBody')} onCancel={onCancel}
          actions={[cancel, { label: t('versions.discardConfirm'), weight: 'danger', onClick: onDiscard }]} />
      );
    case 'copy':
      return (
        <Ask title={t('versions.copyTitle').replace('{name}', label)} body={t('versions.copyBody')}
          input={{ value, onChange: setValue, placeholder: t('versions.copyName') }} onCancel={onCancel}
          actions={[cancel, { label: t('versions.copyConfirm'), weight: 'primary', disabled: !value.trim(), onClick: () => onCopy(dialog.version, value.trim()) }]} />
      );
    default:
      return null;
  }
}

/** A question in the middle of the window: a few words, maybe a field, and its choices (the last one is the default). */
function Ask({ title, body, input, actions, onCancel }: {
  title: string;
  body?: string;
  input?: { value: string; onChange: (value: string) => void; placeholder: string };
  actions: Array<{ label: string; weight: 'primary' | 'secondary' | 'quiet' | 'danger'; disabled?: boolean; onClick: () => void }>;
  onCancel: () => void;
}) {
  const field = React.useRef<HTMLInputElement>(null);
  const last = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    (input ? field.current : last.current)?.focus();
    if (input) field.current?.select();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const main = actions[actions.length - 1];
  return createPortal(
    <div
      className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      style={{ animation: 'openfilm-rise 0.16s ease-out both' }}
      onClick={onCancel}
    >
      <div className="w-full max-w-[440px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <Card title={title} body={body} onClose={onCancel}>
          {input ? (
            <form
              className="mt-2.5"
              onSubmit={(e) => { e.preventDefault(); if (main && !main.disabled) main.onClick(); }}
            >
              <input
                ref={field}
                value={input.value}
                onChange={(e) => input.onChange(e.target.value)}
                placeholder={input.placeholder}
                maxLength={200}
                onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}
                className="h-8 w-full rounded-lg bg-[var(--surface-2)] px-2.5 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--border-strong)]"
              />
            </form>
          ) : null}
          <CardActions className="flex-wrap">
            {actions.map((a, i) => (
              <CardButton key={a.label} ref={i === actions.length - 1 ? last : undefined} weight={a.weight} disabled={a.disabled} onClick={a.onClick}>
                {a.label}
              </CardButton>
            ))}
          </CardActions>
        </Card>
      </div>
    </div>,
    document.body,
  );
}
