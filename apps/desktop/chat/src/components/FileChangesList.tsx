/**
 * Under the agent's reply: what the turn changed in the project's files (lib/file-changes), as a coding agent's app
 * lists them. One card, a row per file: its name, its lines added and removed, and on a click its changed lines. The
 * first few rows show; the rest open from the last row. Settings → Developer turns it off.
 */
import React from 'react';
import { ChevronRight, File, FileAudio, FileCode, FileImage, FileJson, FileText, FileVideo } from 'lucide-react';
import { useT } from '@/i18n';
import type { FileChange, FileHunk } from '@/lib/file-changes';
import { StickToBottomContext } from './useStickToBottom';

/** rows shown before "N more files" */
const ROWS_SHOWN = 4;

const ICONS: Array<[RegExp, typeof File]> = [
  [/\.(html?|css|[cm]?js|jsx|tsx?|py|sh)$/i, FileCode],
  [/\.json$/i, FileJson],
  [/\.(md|txt|srt|vtt|csv|ya?ml|toml|xml)$/i, FileText],
  [/\.(png|jpe?g|gif|webp|avif|svg)$/i, FileImage],
  [/\.(mp3|m4a|wav|aac|ogg|flac|opus)$/i, FileAudio],
  [/\.(mp4|mov|webm|mkv|m4v)$/i, FileVideo],
];
const iconOf = (path: string) => ICONS.find(([test]) => test.test(path))?.[1] ?? File;

export function FileChangesList({ changes }: { changes: FileChange[] }) {
  const t = useT();
  const thread = React.useContext(StickToBottomContext);
  const [all, setAll] = React.useState(false);
  const shown = all ? changes : changes.slice(0, ROWS_SHOWN);
  const hidden = changes.length - shown.length;
  /* opening a row or the rest makes the reply taller: the thread stays where it is, as it does for the work summary */
  const keepPlace = () => thread?.skipNextPin();

  return (
    <div className="min-w-0 overflow-hidden rounded-[10px] border border-[var(--border)]">
      {shown.map((change, i) => (
        <FileRow key={change.path} change={change} first={i === 0} onToggle={keepPlace} />
      ))}
      {hidden > 0 || changes.length > ROWS_SHOWN ? (
        <button
          type="button"
          onClick={() => { keepPlace(); setAll((value) => !value); }}
          className="flex h-9 w-full items-center border-t border-[var(--border)] px-3 text-left text-[12.5px] text-[var(--text-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          {hidden > 0 ? t('fileChanges.more').replace('{n}', String(hidden)) : t('fileChanges.fewer')}
        </button>
      ) : null}
    </div>
  );
}

function FileRow({ change, first, onToggle }: { change: FileChange; first: boolean; onToggle: () => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const Icon = iconOf(change.path);
  const slash = change.path.lastIndexOf('/');
  const name = change.path.slice(slash + 1);
  const folder = slash > 0 ? change.path.slice(0, slash) : '';
  const lines = change.added != null || change.removed != null;
  const canOpen = Boolean(change.hunks?.length);
  const row = (
    <>
      <Icon size={14} aria-hidden className="shrink-0 text-[var(--text-faint)]" />
      <span className={`min-w-0 truncate text-[13px] text-[var(--text)] ${change.change === 'removed' ? 'line-through opacity-70' : ''}`} title={change.path}>
        {name}
        {folder ? <span className="ml-1.5 text-[12px] text-[var(--text-faint)]">{folder}</span> : null}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-3 font-mono text-[12px] tabular-nums">
        {lines ? (
          <>
            {change.added ? <span className="text-[var(--ok)]">+{change.added}</span> : null}
            {change.removed ? <span className="text-[var(--err)]">−{change.removed}</span> : null}
          </>
        ) : (
          <span className="font-sans text-[var(--text-faint)]">{t(`fileChanges.${change.change}`)}</span>
        )}
      </span>
      <ChevronRight size={13} aria-hidden className={`shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-90' : ''} ${canOpen ? '' : 'invisible'}`} />
    </>
  );
  const shell = `flex h-9 w-full min-w-0 items-center gap-2 px-3 text-left ${first ? '' : 'border-t border-[var(--border)]'}`;
  return (
    <div className="min-w-0">
      {canOpen ? (
        <button type="button" aria-expanded={open} onClick={() => { onToggle(); setOpen((value) => !value); }}
          className={`${shell} transition-colors hover:bg-[var(--bg-hover)]`}>
          {row}
        </button>
      ) : <div className={shell}>{row}</div>}
      {open && change.hunks ? <Hunks hunks={change.hunks} cut={change.cut === true} /> : null}
    </div>
  );
}

/* the changed lines as git shows them: each hunk's place, then its lines, removed (−) and added (+) */
function Hunks({ hunks, cut }: { hunks: FileHunk[]; cut: boolean }) {
  const t = useT();
  return (
    <div className="max-h-[360px] min-w-0 overflow-auto border-t border-[var(--border)] font-mono text-[11.5px] leading-[18px]">
      {hunks.map((hunk, i) => (
        <React.Fragment key={i}>
          <div className="w-max min-w-full whitespace-pre px-3 text-[var(--text-faint)] opacity-80">
            @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </div>
          {hunk.lines.map((line, j) => {
            const sign = line[0];
            return (
              <div key={j} className={`flex w-max min-w-full whitespace-pre pr-3 ${sign === '-' ? 'bg-[var(--err)]/15 text-[var(--err)]' : sign === '+' ? 'bg-[var(--ok)]/15 text-[var(--ok)]' : 'text-[var(--text-faint)]'}`}>
                <span aria-hidden className="w-6 shrink-0 select-none text-center opacity-80">{sign === '-' ? '−' : sign === '+' ? '+' : ''}</span>
                <span>{line.slice(1)}</span>
              </div>
            );
          })}
        </React.Fragment>
      ))}
      {cut ? <div className="px-3 py-1 font-sans text-[12px] text-[var(--text-faint)]">{t('fileChanges.cut')}</div> : null}
    </div>
  );
}
