/**
 * The production line in the top bar: a small gauge of the film's stages while the agent works on it, opening to the
 * stages, what each leaves, and what the check says the film still needs. A project with no line shows nothing: a
 * line exists only where it was started (`openfilm pipeline start`), and its state is read as it stands.
 */
import React from 'react';
import { Check, Circle, CircleDot, Clapperboard } from 'lucide-react';
import { api, type Pipeline, type PipelineCheck, type PipelineStage, type PipelineState } from '@/api';
import { useT } from '@/i18n';
import { nextStage, progress } from '@/lib/pipeline';
import { POPOVER_CHROME } from './Card';
import { Popover } from './Popover';
import { Tooltip } from './Tooltip';

const TOP_BTN = 'flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

const MARK = {
  done: <Check size={13} className="text-[var(--accent)]" />,
  doing: <CircleDot size={13} className="text-[var(--accent)]" />,
  todo: <Circle size={13} className="text-[var(--text-dim)]" />,
} as const;

/** One stage of the line: its mark, its name, what the agent said it left, and what it leaves. A stage the panel has
    no words for (a line from a newer OpenFilm) says what the server sent it. */
function StageRow({ stage }: { stage: PipelineStage }) {
  const t = useT();
  const key = `pipeline.stage.${stage.name}`;
  const said = t(key);
  return (
    <li className="flex items-start gap-2 py-[3px]">
      <span className="mt-[2px] shrink-0">{MARK[stage.status]}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={`text-[12px] ${stage.status === 'todo' ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{stage.name}</span>
          {stage.note ? <span className="truncate text-[11px] text-[var(--text-dim)]" title={stage.note}>{stage.note}</span> : null}
        </div>
        <div className="text-[11px] text-[var(--text-dim)]">{said === key ? stage.leaves : said}</div>
      </div>
    </li>
  );
}

/** The line whole: its stages, the next thing, and what the check says is still missing. */
function PipelineCard({ pipeline, check }: { pipeline: Pipeline; check: PipelineCheck | null }) {
  const t = useT();
  const at = nextStage(pipeline);
  return (
    <>
      {pipeline.title ? (
        <p className="truncate text-[12px] font-medium text-[var(--text)]">
          {pipeline.title}
          {pipeline.seconds != null ? <span className="pl-1.5 font-normal text-[var(--text-dim)]">{pipeline.seconds}s</span> : null}
        </p>
      ) : null}
      <ul className="mt-1">
        {pipeline.stages.map((stage) => <StageRow key={stage.name} stage={stage} />)}
      </ul>
      <p className="mt-2 border-t border-[var(--border-strong)] pt-2 text-[11px] text-[var(--text-dim)]">
        {at ? t('pipeline.next').replace('{stage}', at.name) : t('pipeline.allDone')}
      </p>
      <div className="mt-2 border-t border-[var(--border-strong)] pt-2">
        {check == null ? (
          <p className="text-[11px] text-[var(--text-dim)]">{t('pipeline.noStoryboard')}</p>
        ) : check.ok ? (
          <p className="text-[11px] text-[var(--accent)]">{t('pipeline.checkOk')}</p>
        ) : (
          <>
            <p className="text-[11px] text-[var(--text)]">{t('pipeline.check')}</p>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-[var(--text-muted)]">{check.lines.join('\n')}</pre>
          </>
        )}
      </div>
    </>
  );
}

/** The line read again while it shows: the agent works while the person watches. */
function usePipeline(projectId: string, open: boolean): PipelineState | null {
  const [state, setState] = React.useState<PipelineState | null>(null);
  /* another project's line is not this one's: the last one read goes before this one's first read answers */
  React.useEffect(() => { setState(null); }, [projectId]);
  React.useEffect(() => {
    let live = true;
    const read = () => api.pipeline(projectId).then((s) => { if (live) setState(s); }, () => {});
    read();
    const tick = setInterval(read, open ? 3_000 : 10_000);
    return () => { live = false; clearInterval(tick); };
  }, [projectId, open]);
  return state;
}

export function PipelineButton({ projectId }: { projectId: string }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const state = usePipeline(projectId, open);
  if (!state || (!state.pipeline && !state.problem)) return null;
  return (
    <Popover open={open} onOpenChange={setOpen} placement="auto" align="end" trigger={(
      <Tooltip label={t('pipeline.label')} side="bottom">
        <button type="button" aria-label={t('pipeline.label')} aria-haspopup="dialog" aria-expanded={open}
          className={`${TOP_BTN} ${open ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}>
          <Clapperboard size={14} />
          {state.pipeline ? <span className="tabular-nums">{progress(state.pipeline).done}/{state.pipeline.stages.length}</span> : null}
        </button>
      </Tooltip>
    )}>
      <div style={POPOVER_CHROME} role="dialog" aria-label={t('pipeline.label')} className="w-80 p-3">
        {state.problem ? (
          <p className="text-[12px] text-[var(--text)]">
            {t('pipeline.problem')}
            <br />
            <span className="text-[11px] text-[var(--text-dim)]">{state.problem}</span>
          </p>
        ) : state.pipeline ? (
          <PipelineCard pipeline={state.pipeline} check={state.check} />
        ) : null}
      </div>
    </Popover>
  );
}
