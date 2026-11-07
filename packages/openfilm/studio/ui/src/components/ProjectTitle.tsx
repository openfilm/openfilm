/** The title opens Projects immediately; its arrow and hover card keep the project's actions. */
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { useT } from '@/i18n';
import { ProjectCard, type ProjectActions, type ProjectFacts } from './ProjectCard';

const TITLE = 'box-border h-[26px] min-w-0 px-2 text-left text-[13px] font-medium leading-5 text-[var(--text-muted)]';

export function ProjectTitle({ name, editing, draft, onDraft, onRename, onCommit, onCancel, onAll, facts, actions }: {
  name: string;
  editing: boolean;
  draft: string;
  onDraft: (name: string) => void;
  onRename: () => void;
  onCommit: () => void;
  onCancel: () => void;
  onAll: () => void;
  facts?: ProjectFacts;
  actions: ProjectActions;
}) {
  const t = useT();
  const label = name || t('project.untitled');
  const finished = React.useRef(false);
  React.useLayoutEffect(() => { if (editing) finished.current = false; }, [editing]);
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit) onCommit(); else onCancel();
  };

  return (
    <div data-project-title className="relative inline-flex min-w-0 max-w-[28ch]">
      <ProjectCard name={name} facts={facts} actions={actions} onAll={onAll} disabled={editing}
        trigger={(hover, activity) => {
          return (
            <div {...hover.trigger} aria-hidden={editing || undefined} className={`flex h-[26px] min-w-0 max-w-[28ch] items-center rounded-md transition-colors hover:bg-[var(--bg-hover)] ${editing ? 'invisible' : ''}`}>
              <button data-project-title-name type="button" aria-label={t('switcher.all')} aria-haspopup="dialog" tabIndex={editing ? -1 : undefined}
                onPointerDown={() => hover.dismiss()}
                onClick={(event) => { event.stopPropagation(); hover.dismiss(); onAll(); }}
                onContextMenu={() => hover.dismiss()}
                onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); hover.dismiss(); onRename(); } }}
                className={`${TITLE} flex-1 truncate rounded py-[3px] outline-none hover:text-[var(--text)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]`}
              >{label}</button>
              <button data-project-title-arrow type="button" aria-label={t('switcher.label')} aria-haspopup="dialog" aria-expanded={hover.open && !editing} tabIndex={editing ? -1 : undefined}
                onClick={(event) => { event.stopPropagation(); hover.toggle(); }}
                className="flex h-[26px] w-5 shrink-0 items-center justify-center rounded text-[var(--text-faint)] outline-none hover:text-[var(--text)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]">
                <ChevronDown size={13} />
              </button>
              {activity ? <span aria-label={t(`switcher.${activity}`)} className={`pointer-events-none absolute left-full top-1/2 ml-1 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${activity === 'asking' ? 'bg-[#e8a23a]' : 'status-breathe bg-[var(--text-muted)]'}`} /> : null}
            </div>
          );
        }}
      />
      {editing ? (
        <input autoFocus aria-label={t('projectMenu.rename')} value={draft} maxLength={56}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter');
            }
          }}
          style={{ width: 'calc(100% - 20px)' }}
          className={`${TITLE} absolute left-0 top-0 rounded bg-transparent py-[3px] outline-none selection:bg-[var(--text-selection)]`}
        />
      ) : null}
    </div>
  );
}
