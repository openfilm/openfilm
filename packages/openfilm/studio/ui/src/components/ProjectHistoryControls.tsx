/**
 * The Version history panel: git, as a person knows it from GitHub, told as a film.
 *
 *   ⑂ main ▾                  the branch checked out; its menu lists every branch (switch, merge, rename, delete) and
 *                             makes new ones
 *   Uncommitted changes       what the film has that the last commit does not, in scenes and sounds; a message and
 *                             Commit, or Discard
 *   History · main            the branch's commits, newest first, each with the film's picture when it was committed
 *                             and what it changed; ⋯ restores one (as uncommitted changes) or branches from it
 *   In history / Not in history   the film's files (what a commit keeps) and the folder's others, which history
 *                             leaves alone; each opens to its list
 *
 * Every commit is the person's, made with their message; nothing here commits on its own. Going back to a version
 * puts it in the folder as uncommitted changes; switching branches with changes asks whether to leave them on their
 * branch (they are there again on coming back) or bring them along. Data and actions come from `useProjectHistory`.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Clapperboard, GitBranch, GitMerge, Loader2, MoreHorizontal, Pencil, Plus, Tag, Trash2, Undo2, X } from 'lucide-react';
import { useT } from '@/i18n';
import { formatBytes } from '@/lib/export-jobs';
import {
  commitPoster, historyAge, historyApi, summaryParts, type Branch, type Commit, type HistoryFile, type HistoryFiles, type HistoryProgress, type Summary,
} from '@/lib/project-history';
import { Card, CardActions, CardButton, POPOVER_CHROME } from './Card';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { Tooltip } from './Tooltip';
import type { ProjectHistory } from './use-project-history';

const PANEL_W = 400;

type Translate = (key: string) => string;

function ageLabel(at: number, now: number, t: Translate): string {
  const age = historyAge(at, now);
  if (!age) return '';
  if (age.unit === 'now') return t('history.justNow');
  const key = age.unit === 'minute' ? 'history.minutesAgo' : age.unit === 'hour' ? 'history.hoursAgo' : 'history.daysAgo';
  return t(key).replace('{n}', String(age.n));
}

/** How far an action is, in a few words: "Keeping media… 3 of 20". */
function progressText(progress: HistoryProgress, t: Translate): string {
  const key = { scan: 'versions.progressScan', store: 'versions.progressStore', write: 'versions.progressWrite', migrate: 'versions.progressMigrate' }[progress.phase];
  return t(key).replace('{done}', String(progress.done)).replace('{total}', String(progress.total));
}

/** What changed, as a short sentence: "2 scenes added · 1 sound edited". */
function summaryText(summary: Summary, t: Translate): string {
  return summaryParts(summary).map(({ key, n }) => t(`versions.${key}${n === 1 ? 'One' : ''}`).replace('{n}', String(n))).join(' · ');
}

/**
 * The top bar's Version history button (GitBranch). It carries `data-history-trigger`, which the panel's
 * click-outside check recognizes, so clicking it again toggles the panel instead of closing and reopening it.
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
        <GitBranch size={16} />
      </button>
    </Tooltip>
  );
}

/** The questions the panel asks, one at a time. */
type Dialog =
  | { kind: 'switch'; target: string }
  | { kind: 'newBranch'; from?: Commit }
  | { kind: 'newBranchCarry'; name: string; from: Commit }
  | { kind: 'rename'; branch: string }
  | { kind: 'delete'; branch: string }
  | { kind: 'deleteForce'; branch: string; commits: number }
  | { kind: 'merge'; branch: string }
  | { kind: 'mergeConflict'; branch: string; message: string }
  | { kind: 'restore'; commit: Commit }
  | { kind: 'discard' };

export function ProjectHistoryControls({
  projectId,
  history,
  open,
  anchor,
  onClose,
}: {
  projectId: string;
  history: ProjectHistory;
  open: boolean;
  /**
   * The bottom-right corner (viewport px) of what opened it — the top bar's right cluster, `{ x: rect.right,
   * y: rect.bottom + 4 }`. The panel hangs from it leftward. Without it: the top right of the window.
   */
  anchor?: { x: number; y: number } | null;
  onClose: () => void;
}) {
  const t = useT();
  const { state, busy, progress } = history;
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [message, setMessage] = React.useState('');
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const [branchesOpen, setBranchesOpen] = React.useState(false);
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dialogRef.current) { if (branchesOpen) setBranchesOpen(false); else onClose(); }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, branchesOpen]);

  /* loaded again on opening: commits may have been made while it was closed */
  const { refresh } = history;
  React.useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  React.useEffect(() => { if (!open) { setBranchesOpen(false); setNotice(null); } }, [open]);

  if (!open) return null;

  const now = Date.now();
  const status = state?.status ?? null;
  const commits = state?.commits ?? [];
  const branch = status?.branch ?? 'main';
  const changes = status?.changes ?? null;
  const committed = commits.length > 0;
  const say = (text: string) => setNotice(text);

  /* ── the actions, with their questions ── */
  const switchTo = (target: string) => {
    setBranchesOpen(false);
    if (changes) { setDialog({ kind: 'switch', target }); return; }
    void doCheckout({ branch: target });
  };
  const doCheckout = async (o: { branch: string; create?: boolean; from?: string; carry?: 'leave' | 'bring' }) => {
    setDialog(null);
    const result = await history.checkout(o);
    if (!result.ok && result.code === 'conflict') say(t('versions.errorCarry'));
    else if (result.ok && result.body.parkedBack === false) say(t('versions.parkedStuck'));
    else if (result.ok) setNotice(null);
  };
  const doCommit = async () => {
    if (!message.trim()) return;
    if (await history.commit(message.trim())) { setMessage(''); setNotice(null); }
  };
  const doRestore = async (commit: Commit, discardFirst: boolean) => {
    setDialog(null);
    if (discardFirst && !(await history.discard())) return;
    const result = await history.restore(commit.commit);
    if (result.ok) setMessage(t('versions.restoredMessage').replace('{name}', commit.message));
    else if (result.code === 'dirty') setDialog({ kind: 'restore', commit });
  };
  const doDelete = async (name: string, force: boolean) => {
    setDialog(null);
    const result = await history.remove(name, force);
    if (!result.ok && result.code === 'unmerged') setDialog({ kind: 'deleteForce', branch: name, commits: result.commits ?? 1 });
  };
  const doMerge = async (name: string, text: string, prefer?: 'ours' | 'theirs') => {
    setDialog(null);
    const result = await history.merge({ branch: name, message: text, ...(prefer ? { prefer } : {}) });
    if (!result.ok && result.code === 'conflict') setDialog({ kind: 'mergeConflict', branch: name, message: text });
    else if (!result.ok && result.code === 'dirty') say(t('versions.errorDirty'));
    else if (result.ok && result.body.merged === false) say(t('versions.nothingToMerge').replace('{name}', name).replace('{branch}', branch));
  };

  const commitMenu = (commit: Commit, head: boolean): ContextMenuEntry[] => [
    ...(head && !changes ? [] : [{ id: 'restore', icon: <Undo2 size={14} />, label: t('versions.restore'), onSelect: () => setDialog({ kind: 'restore', commit }) }]),
    { id: 'branch', icon: <GitBranch size={14} />, label: t('versions.branchFrom'), onSelect: () => setDialog({ kind: 'newBranch', from: commit }) },
  ];

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
          {/* the title, and the branch checked out */}
          <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">{t('versions.title')}</span>
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
          {progress ? (
            <div role="status" className="shrink-0 px-4 pb-2">
              <div className="truncate text-[11.5px] text-[var(--text-muted)]">{progressText(progress, t)}</div>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-150" style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }} />
              </div>
            </div>
          ) : null}
          <div className="relative shrink-0 px-3 pb-2">
            <button
              type="button"
              onClick={() => setBranchesOpen((v) => !v)}
              disabled={!committed}
              aria-expanded={branchesOpen}
              aria-haspopup="listbox"
              aria-label={t('versions.branchOf').replace('{branch}', branch)}
              className="flex h-8 w-full items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 text-left text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-60"
            >
              <GitBranch size={13} className="shrink-0 text-[var(--text-dim)]" />
              <span className="min-w-0 flex-1 truncate font-medium">{branch}</span>
              {committed ? (
                <span className="shrink-0 text-[11.5px] text-[var(--text-faint)]">
                  {t(status && status.branches.length === 1 ? 'versions.branchCountOne' : 'versions.branchCount').replace('{n}', String(status?.branches.length ?? 1))}
                </span>
              ) : null}
              <ChevronDown size={13} className={`shrink-0 text-[var(--text-faint)] transition-transform ${branchesOpen ? 'rotate-180' : ''}`} />
            </button>
            {branchesOpen && status ? (
              <BranchList
                branches={status.branches}
                current={branch}
                now={now}
                busy={busy !== null}
                t={t}
                onSwitch={switchTo}
                onNew={() => { setBranchesOpen(false); setDialog({ kind: 'newBranch' }); }}
                onMerge={(name) => { setBranchesOpen(false); setDialog({ kind: 'merge', branch: name }); }}
                onRename={(name) => { setBranchesOpen(false); setDialog({ kind: 'rename', branch: name }); }}
                onDelete={(name) => { setBranchesOpen(false); setDialog({ kind: 'delete', branch: name }); }}
              />
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {notice ? (
              <p role="status" className="mb-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-dim)]">{notice}</p>
            ) : null}

            {/* what is not committed yet, and committing it */}
            {state === null ? (
              <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-[var(--text-faint)]" /></div>
            ) : changes || !committed ? (
              <section className="mb-3 rounded-xl border border-[var(--border)] p-2.5">
                <div className="flex items-center gap-2.5">
                  <Thumb src={`/api/projects/${encodeURIComponent(projectId)}/poster?v=${encodeURIComponent(`${status?.head ?? ''}:${changes?.count ?? 0}:${JSON.stringify(changes?.summary ?? null)}`)}`} large />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-[var(--text)]">{t('versions.changesTitle')}</div>
                    <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
                      {committed ? (changes ? summaryText(changes.summary, t) : '') : t('versions.firstCommitHint')}
                    </div>
                  </div>
                </div>
                <form
                  className="mt-2.5 flex items-center gap-2"
                  onSubmit={(event) => { event.preventDefault(); void doCommit(); }}
                >
                  <input
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={500}
                    aria-label={t('versions.messagePlaceholder')}
                    placeholder={t('versions.messagePlaceholder')}
                    disabled={busy !== null}
                    className="h-8 min-w-0 flex-1 rounded-lg bg-[var(--surface-2)] px-2.5 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--border-strong)]"
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                  <CardButton type="submit" weight="primary" disabled={busy !== null || !message.trim()}>
                    {busy === 'commit' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    {t('versions.commit')}
                  </CardButton>
                </form>
                {committed ? (
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: 'discard' })}
                    disabled={busy !== null}
                    className="mt-1.5 px-0.5 text-[11.5px] text-[var(--text-faint)] transition hover:text-[var(--err)] disabled:opacity-50"
                  >
                    {t('versions.discard')}
                  </button>
                ) : null}
              </section>
            ) : (
              <p className="mb-3 flex items-center gap-1.5 px-1 text-[12px] text-[var(--text-faint)]">
                <Check size={12} /> {t('versions.noChanges')}
              </p>
            )}

            {/* the branch's commits */}
            {committed ? (
              <>
                <div className="mb-1 px-1 text-[11.5px] font-medium text-[var(--text-faint)]">{t('versions.historyOf').replace('{branch}', branch)}</div>
                <ol>
                  {commits.map((commit, index) => (
                    <CommitRow
                      key={commit.commit}
                      projectId={projectId}
                      commit={commit}
                      head={commit.commit === status?.head}
                      last={index === commits.length - 1}
                      age={ageLabel(commit.at, now, t)}
                      busy={busy !== null}
                      menu={commitMenu(commit, commit.commit === status?.head)}
                      t={t}
                    />
                  ))}
                </ol>
              </>
            ) : null}

            {status?.files ? <FilesHeld projectId={projectId} files={status.files} t={t} /> : null}
          </div>
        </div>,
        document.body,
      )}
      <Questions
        dialog={dialog}
        branch={branch}
        t={t}
        onCancel={() => setDialog(null)}
        onSwitch={(target, carry) => void doCheckout({ branch: target, carry })}
        onNewBranch={(name, from) => {
          /* from where the folder is, or with nothing uncommitted: nothing to leave or bring */
          if (!from || from.commit === status?.head || !changes) { void doCheckout({ branch: name, create: true, ...(from ? { from: from.commit } : {}) }); return; }
          setDialog({ kind: 'newBranchCarry', name, from });
        }}
        onNewBranchCarry={(name, from, carry) => void doCheckout({ branch: name, create: true, from: from.commit, carry })}
        onRename={(from, name) => { setDialog(null); void history.rename(from, name); }}
        onDelete={(name, force) => void doDelete(name, force)}
        onMerge={(name, text, prefer) => void doMerge(name, text, prefer)}
        onRestore={(commit) => void doRestore(commit, Boolean(changes))}
        onDiscard={() => { setDialog(null); void history.discard().then((done) => { if (done) setMessage(''); }); }}
        dirty={Boolean(changes)}
      />
    </>
  );
}

/**
 * What history keeps of the folder: the film's files, and the other files it leaves alone (renders, frames, other
 * takes). Each opens to its list, loaded when opened.
 */
function FilesHeld({ projectId, files, t }: { projectId: string; files: HistoryFiles; t: Translate }) {
  const [open, setOpen] = React.useState<'held' | 'ignored' | null>(null);
  const [lists, setLists] = React.useState<{ held: HistoryFile[]; ignored: HistoryFile[] } | null>(null);
  const toggle = (which: 'held' | 'ignored') => {
    const next = open === which ? null : which;
    setOpen(next);
    if (next) void historyApi.files(projectId).then((l) => { if (l) setLists(l); });
  };
  const row = (which: 'held' | 'ignored', label: string) => (
    <button
      type="button"
      onClick={() => toggle(which)}
      aria-expanded={open === which}
      className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left text-[11.5px] text-[var(--text-faint)] transition hover:text-[var(--text-dim)]"
    >
      {open === which ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
  const n = (key: string, count: number) => t(count === 1 ? `${key}One` : key).replace('{n}', count.toLocaleString());
  const list = open && lists ? lists[open] : null;
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-2">
      {row('held', `${n('versions.heldFiles', files.held)} · ${formatBytes(files.heldBytes)}`)}
      {files.ignored ? row('ignored', n('versions.ignoredFiles', files.ignored)) : null}
      {open ? (
        list ? (
          <ul className="mt-1 max-h-[180px] overflow-y-auto rounded-lg bg-[var(--surface-2)] px-2 py-1.5">
            {list.map((f) => (
              <li key={f.path} className="flex items-center gap-2 py-[1px] text-[11px] text-[var(--text-muted)]" title={f.path}>
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
                <span className="shrink-0 tabular-nums text-[var(--text-faint)]">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex justify-center py-2"><Loader2 size={13} className="animate-spin text-[var(--text-faint)]" /></div>
        )
      ) : null}
    </div>
  );
}

/** The film's picture at a commit (or now): a placeholder until there is one. */
function Thumb({ src, large = false }: { src: string | null; large?: boolean }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [src]);
  const size = large ? 'h-[45px] w-[80px]' : 'h-[34px] w-[60px]';
  if (!src || failed) {
    return (
      <span className={`${size} flex shrink-0 items-center justify-center rounded-md bg-[var(--surface-2)] text-[var(--text-faint)]`}>
        <Clapperboard size={large ? 16 : 13} />
      </span>
    );
  }
  return <img src={src} alt="" onError={() => setFailed(true)} className={`${size} shrink-0 rounded-md bg-black object-cover`} />;
}

function CommitRow({ projectId, commit, head, last, age, busy, menu, t }: {
  projectId: string;
  commit: Commit;
  head: boolean;
  last: boolean;
  age: string;
  busy: boolean;
  menu: ContextMenuEntry[];
  t: Translate;
}) {
  const [anchor, setAnchor] = React.useState<{ x: number; y: number; top: number } | null>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const merge = commit.parents.length > 1;
  return (
    <li className="group relative flex items-stretch gap-2">
      {/* the rail: a line through the commits, a filled dot where the branch is */}
      <span className="relative w-[12px] shrink-0" aria-hidden>
        {!last ? <span className="absolute bottom-[-4px] left-[5.5px] top-[22px] w-px bg-[var(--border)]" /> : null}
        <span className={`absolute left-[2px] top-[17px] h-[8px] w-[8px] rounded-full ${head ? 'bg-[var(--text)]' : 'border border-[var(--border-strong)] bg-[var(--bg-surface)]'}`} />
      </span>
      <div className={`mb-0.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 transition ${head ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}>
        <Thumb src={commitPoster(projectId, commit.commit)} />
        <div className="min-w-0 flex-1" title={commit.body ? `${commit.message}\n\n${commit.body}` : commit.message}>
          <div className="flex min-w-0 items-center gap-1.5">
            {merge ? <GitMerge size={12} className="shrink-0 text-[var(--text-faint)]" /> : null}
            <span className={`truncate text-[12.5px] leading-snug ${head ? 'font-medium text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>{commit.message}</span>
            {commit.tags.map((tag) => (
              <span key={tag} className="flex shrink-0 items-center gap-0.5 rounded bg-[var(--surface-2)] px-1 text-[10.5px] text-[var(--text-muted)]"><Tag size={9} />{tag}</span>
            ))}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--text-faint)]">
            {[summaryText(commit.summary, t), age, commit.commit.slice(0, 7)].filter(Boolean).join(' · ')}
          </div>
        </div>
        {head ? <span className="shrink-0 text-[10.5px] text-[var(--text-muted)]">{t('versions.current')}</span> : null}
        <button
          ref={button}
          type="button"
          disabled={busy}
          aria-label={t('versions.moreActions')}
          aria-haspopup="menu"
          aria-expanded={anchor != null}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setAnchor((cur) => (cur ? null : { x: box.right, y: box.bottom + 4, top: box.top - 4 }));
          }}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${anchor ? '' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'}`}
        >
          <MoreHorizontal size={14} />
        </button>
        {anchor ? <ContextMenu x={anchor.x} y={anchor.y} flipTo={anchor.top} align="end" trigger={button} onClose={() => setAnchor(null)} items={menu} /> : null}
      </div>
    </li>
  );
}

function BranchList({ branches, current, now, busy, t, onSwitch, onNew, onMerge, onRename, onDelete }: {
  branches: Branch[];
  current: string;
  now: number;
  busy: boolean;
  t: Translate;
  onSwitch: (name: string) => void;
  onNew: () => void;
  onMerge: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label={t('versions.branches')}
      className="absolute left-3 right-3 top-[calc(100%-4px)] z-10 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg"
      style={{ animation: 'openfilm-rise 0.12s ease-out both' }}
    >
      <div className="max-h-[280px] overflow-y-auto p-1">
        {branches.map((b) => (
          <BranchRow key={b.name} branch={b} current={b.name === current} currentName={current} now={now} busy={busy} t={t}
            onSwitch={onSwitch} onMerge={onMerge} onRename={onRename} onDelete={onDelete} />
        ))}
      </div>
      <button
        type="button"
        onClick={onNew}
        disabled={busy}
        className="flex w-full items-center gap-2 border-t border-[var(--border)] px-3 py-2 text-left text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50"
      >
        <Plus size={13} /> {t('versions.newBranch')}
      </button>
    </div>
  );
}

function BranchRow({ branch, current, currentName, now, busy, t, onSwitch, onMerge, onRename, onDelete }: {
  branch: Branch;
  current: boolean;
  currentName: string;
  now: number;
  busy: boolean;
  t: Translate;
  onSwitch: (name: string) => void;
  onMerge: (name: string) => void;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [anchor, setAnchor] = React.useState<{ x: number; y: number; top: number } | null>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const items: ContextMenuEntry[] = [
    ...(current ? [] : [{ id: 'merge', icon: <GitMerge size={14} />, label: t('versions.mergeInto').replace('{branch}', currentName), onSelect: () => onMerge(branch.name) }]),
    { id: 'rename', icon: <Pencil size={14} />, label: t('versions.rename'), onSelect: () => onRename(branch.name) },
    ...(current ? [] : [
      { id: 'sep', separator: true as const },
      { id: 'delete', icon: <Trash2 size={14} />, label: t('versions.delete'), danger: true, onSelect: () => onDelete(branch.name) },
    ]),
  ];
  return (
    <div className="group flex items-center gap-1 rounded-lg transition hover:bg-[var(--bg-hover)]">
      <button
        type="button"
        role="option"
        aria-selected={current}
        aria-label={branch.name}
        disabled={busy}
        onClick={() => (current ? undefined : onSwitch(branch.name))}
        className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left disabled:opacity-60"
      >
        <span className="mt-[3px] w-[13px] shrink-0">{current ? <Check size={13} className="text-[var(--text)]" /> : null}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[12.5px] ${current ? 'font-medium text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>{branch.name}</span>
          <span className="block truncate text-[11px] text-[var(--text-faint)]">
            {[branch.message, ageLabel(branch.at, now, t)].filter(Boolean).join(' · ')}
            {branch.parked ? <span className="text-[var(--accent)]"> · {t('versions.parked')}</span> : null}
          </span>
        </span>
      </button>
      <button
        ref={button}
        type="button"
        disabled={busy}
        aria-label={t('versions.moreActions')}
        aria-haspopup="menu"
        aria-expanded={anchor != null}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setAnchor((cur) => (cur ? null : { x: box.right, y: box.bottom + 4, top: box.top - 4 }));
        }}
        className={`mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] ${anchor ? '' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'}`}
      >
        <MoreHorizontal size={14} />
      </button>
      {anchor ? <ContextMenu x={anchor.x} y={anchor.y} flipTo={anchor.top} align="end" trigger={button} onClose={() => setAnchor(null)} items={items} /> : null}
    </div>
  );
}

/** Every question the panel asks, as one dialog whose words and choices follow what is asked. */
function Questions({ dialog, branch, dirty, t, onCancel, onSwitch, onNewBranch, onNewBranchCarry, onRename, onDelete, onMerge, onRestore, onDiscard }: {
  dialog: Dialog | null;
  branch: string;
  dirty: boolean;
  t: Translate;
  onCancel: () => void;
  onSwitch: (target: string, carry: 'leave' | 'bring') => void;
  onNewBranch: (name: string, from?: Commit) => void;
  onNewBranchCarry: (name: string, from: Commit, carry: 'leave' | 'bring') => void;
  onRename: (from: string, name: string) => void;
  onDelete: (name: string, force: boolean) => void;
  onMerge: (name: string, message: string, prefer?: 'ours' | 'theirs') => void;
  onRestore: (commit: Commit) => void;
  onDiscard: () => void;
}) {
  const [value, setValue] = React.useState('');
  /* each question starts with its own default text */
  React.useEffect(() => {
    if (!dialog) return;
    setValue(dialog.kind === 'rename' ? dialog.branch : dialog.kind === 'merge' ? t('versions.mergeMessage').replace('{name}', dialog.branch) : '');
  }, [dialog, t]);
  if (!dialog) return null;
  const fill = (key: string, vars: Record<string, string | number> = {}) =>
    Object.entries({ branch, ...vars }).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), t(key));
  const cancel = { label: t('versions.cancel'), weight: 'quiet' as const, onClick: onCancel };
  const typed = value.trim();

  switch (dialog.kind) {
    case 'switch':
      return (
        <Ask title={fill('versions.switchTitle', { name: dialog.target })} body={fill('versions.switchBody')} onCancel={onCancel}
          actions={[cancel,
            { label: fill('versions.bringChanges', { name: dialog.target }), weight: 'secondary', onClick: () => onSwitch(dialog.target, 'bring') },
            { label: fill('versions.leaveChanges'), weight: 'primary', onClick: () => onSwitch(dialog.target, 'leave') }]} />
      );
    case 'newBranchCarry':
      return (
        <Ask title={fill('versions.switchTitle', { name: dialog.name })} body={fill('versions.switchBody')} onCancel={onCancel}
          actions={[cancel,
            { label: fill('versions.bringChanges', { name: dialog.name }), weight: 'secondary', onClick: () => onNewBranchCarry(dialog.name, dialog.from, 'bring') },
            { label: fill('versions.leaveChanges'), weight: 'primary', onClick: () => onNewBranchCarry(dialog.name, dialog.from, 'leave') }]} />
      );
    case 'newBranch':
      return (
        <Ask
          title={dialog.from ? fill('versions.newBranchFromTitle', { name: dialog.from.message }) : t('versions.newBranchTitle')}
          body={fill(dialog.from ? 'versions.newBranchFromBody' : dirty ? 'versions.newBranchBody' : 'versions.newBranchBodyClean')}
          input={{ value, onChange: setValue, placeholder: t('versions.branchName') }}
          onCancel={onCancel}
          actions={[cancel, { label: t('versions.create'), weight: 'primary', disabled: !typed, onClick: () => onNewBranch(typed, dialog.from) }]} />
      );
    case 'rename':
      return (
        <Ask title={fill('versions.renameTitle', { name: dialog.branch })} input={{ value, onChange: setValue, placeholder: t('versions.branchName') }} onCancel={onCancel}
          actions={[cancel, { label: t('versions.save'), weight: 'primary', disabled: !typed, onClick: () => onRename(dialog.branch, typed) }]} />
      );
    case 'delete':
      return (
        <Ask title={fill('versions.deleteTitle', { name: dialog.branch })} body={fill('versions.deleteBody', { name: dialog.branch })} onCancel={onCancel}
          actions={[cancel, { label: t('versions.delete'), weight: 'danger', onClick: () => onDelete(dialog.branch, false) }]} />
      );
    case 'deleteForce':
      return (
        <Ask title={fill('versions.deleteForceTitle', { name: dialog.branch })}
          body={fill(dialog.commits === 1 ? 'versions.deleteForceBodyOne' : 'versions.deleteForceBody', { name: dialog.branch, n: dialog.commits })} onCancel={onCancel}
          actions={[cancel, { label: t('versions.deleteForce'), weight: 'danger', onClick: () => onDelete(dialog.branch, true) }]} />
      );
    case 'merge':
      return (
        <Ask title={fill('versions.mergeTitle', { name: dialog.branch })} body={dirty ? fill('versions.errorDirty') : fill('versions.mergeBody', { name: dialog.branch })}
          input={dirty ? undefined : { value, onChange: setValue, placeholder: t('versions.messagePlaceholder') }} onCancel={onCancel}
          actions={[cancel, { label: t('versions.mergeConfirm'), weight: 'primary', disabled: dirty || !typed, onClick: () => onMerge(dialog.branch, typed) }]} />
      );
    case 'mergeConflict':
      return (
        <Ask title={fill('versions.mergeConflictTitle', { name: dialog.branch })} body={fill('versions.mergeConflictBody', { name: dialog.branch })} onCancel={onCancel}
          actions={[cancel,
            { label: fill('versions.keepTheirs', { name: dialog.branch }), weight: 'secondary', onClick: () => onMerge(dialog.branch, dialog.message, 'theirs') },
            { label: fill('versions.keepOurs'), weight: 'primary', onClick: () => onMerge(dialog.branch, dialog.message, 'ours') }]} />
      );
    case 'restore':
      return (
        <Ask title={fill('versions.restoreTitle', { name: dialog.commit.message })} body={fill(dirty ? 'versions.restoreDirtyBody' : 'versions.restoreBody')} onCancel={onCancel}
          actions={[cancel, dirty
            ? { label: t('versions.restoreDiscard'), weight: 'danger', onClick: () => onRestore(dialog.commit) }
            : { label: t('versions.restoreConfirm'), weight: 'primary', onClick: () => onRestore(dialog.commit) }]} />
      );
    case 'discard':
      return (
        <Ask title={t('versions.discardTitle')} body={t('versions.discardBody')} onCancel={onCancel}
          actions={[cancel, { label: t('versions.discard'), weight: 'danger', onClick: onDiscard }]} />
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
