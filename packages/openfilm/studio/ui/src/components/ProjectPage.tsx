/**
 * A project's page: Studio's shell. What is worked in is a plugin's workbench, an element its plugin brings
 * (src/skills.mjs elementIn; OpenFilm's own in plugins/<id>, loaded as anyone's is), put here and told the project.
 *
 * For now the edit still draws more than its own panes (the top bar, the dialogs): they are moved up here one at a
 * time. What is here already is the project's frame (shell/ProjectFrame): the project's files and the media pane's
 * operations on them, the toast, which workbench is shown, with what takes the panes' place when it is not the edit
 * (the canvas, another plugin's surface), and the library, its pane and its drawer (shell/library); a workbench is
 * given them through shell/frame.
 */
import React from 'react';
import { useT } from '@/i18n';
import { useStudioPlugins } from '@/lib/plugins';
import { ProjectFrame } from '@/shell/ProjectFrame';
import { elementTag } from './surfaces';

export function ProjectPage({ projectId }: { projectId: string }) {
  const t = useT();
  const plugins = useStudioPlugins();
  const module = plugins?.find((p) => p.id === 'edit')?.element ?? null;
  const host = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<'loading' | 'shown' | { error: string }>('loading');
  React.useEffect(() => {
    if (!plugins) return;
    if (!module) { setState({ error: 'plugins/edit' }); return; }
    let live = true, element: HTMLElement | null = null;
    elementTag(module).then((tag) => {
      if (!live || !host.current) return;
      element = document.createElement(tag);
      element.setAttribute('project-id', projectId);
      host.current.append(element);
      setState('shown');
    }, (e) => { if (live) setState({ error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; element?.remove(); };
  }, [module, projectId, Boolean(plugins)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {typeof state === 'object' ? (
        <div className="workspace-shell flex items-center justify-center bg-[var(--bg-app)]">
          <p className="max-w-[420px] whitespace-pre-wrap px-8 text-center text-[13px] leading-relaxed text-[var(--text-muted)]">{`${t('assetDrawer.surfaceFailed')}\n\n${state.error}`}</p>
        </div>
      ) : null}
      <ProjectFrame projectId={projectId} covered={typeof state === 'object'}>
        <div ref={host} style={{ display: 'contents' }} />
      </ProjectFrame>
    </>
  );
}
