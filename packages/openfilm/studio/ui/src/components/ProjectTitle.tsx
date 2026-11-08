/** Desktop tabs select projects; the browser title opens its project card. Both keep inline rename. */
import React from 'react';
import { ChevronDown, Clapperboard } from 'lucide-react';
import { useT } from '@/i18n';
import { ProjectCard, type ProjectActions, type ProjectFacts } from './ProjectCard';
import tabStyles from './ProjectTabs.module.css';

const TITLE = 'box-border h-[26px] min-w-0 px-2 text-left text-[13px] font-medium leading-5 text-[var(--text-muted)]';

export function ProjectTitle({ name, editing, draft, onDraft, onRename, onCommit, onCancel, onAll, facts, actions, tab = false }: {
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
  tab?: boolean;
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
  const input = editing ? <input autoFocus aria-label={t('projectMenu.rename')} value={draft} maxLength={56}
    onFocus={event => event.currentTarget.select()} onChange={event => onDraft(event.target.value)} onBlur={() => finish(true)}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter');
      }
    }}
    style={tab ? undefined : { width: 'calc(100% - 20px)' }}
    className={tab ? tabStyles.rename : `${TITLE} absolute left-0 top-0 rounded bg-transparent py-[3px] outline-none selection:bg-[var(--text-selection)]`} /> : null;

  if (tab) return <div data-project-title className="relative flex min-w-0 flex-1 self-stretch">
    <button data-project-title-name type="button" role="tab" aria-selected="true" aria-label={label} aria-hidden={editing || undefined} tabIndex={editing ? -1 : 0}
      onMouseDown={event => { if (event.button === 0 && event.detail === 2) { event.preventDefault(); event.stopPropagation(); onRename(); } }}
      onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); onRename(); }}
      onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); onRename(); } }}
      className="flex h-full min-w-0 flex-1 items-center gap-[7px] pl-[11px] pr-[7px] text-left text-[12px] text-[var(--text)] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]">
      <Clapperboard size={13} strokeWidth={1.5} className="shrink-0 text-[var(--text-muted)]" /><span className={`min-w-0 truncate ${editing ? 'invisible' : ''}`}>{label}</span>
    </button>
    {input}
  </div>;

  return <div data-project-title className="relative inline-flex min-w-0 max-w-[28ch]">
    <ProjectCard name={name} facts={facts} actions={actions} onAll={onAll} disabled={editing}
      trigger={(popup, activity) => <div aria-hidden={editing || undefined} className={`flex h-[26px] min-w-0 max-w-[28ch] items-center rounded-md transition-colors hover:bg-[var(--bg-hover)] ${editing ? 'invisible' : ''}`}>
        <button data-project-title-name type="button" aria-label={t('switcher.label')} aria-haspopup="dialog" aria-expanded={popup.open && !editing} tabIndex={editing ? -1 : undefined}
          onClick={event => { event.stopPropagation(); popup.toggle(); }}
          onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); popup.dismiss(); onRename(); }}
          onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); popup.dismiss(); onRename(); } }}
          className={`${TITLE} flex min-w-0 items-center gap-1.5 rounded py-[3px] outline-none hover:text-[var(--text)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]`}>
          <span className="min-w-0 truncate">{label}</span><span data-project-title-arrow className="flex shrink-0 items-center text-[var(--text-faint)]"><ChevronDown size={13} /></span>
        </button>
        {activity ? <span aria-label={t(`switcher.${activity}`)} className={`pointer-events-none absolute left-full top-1/2 ml-1 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${activity === 'asking' ? 'bg-[#e8a23a]' : 'status-breathe bg-[var(--text-muted)]'}`} /> : null}
      </div>} />
    {input}
  </div>;
}
