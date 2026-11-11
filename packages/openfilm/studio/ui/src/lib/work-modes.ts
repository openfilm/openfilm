/**
 * Which ways of working a project offers: the workbenches of the plugins that are on (lib/plugins; Settings →
 * Plugins): the edit (cutting the film), the canvas (making material) and motion (layers and keyframes). The edit and
 * the canvas are on until the person says; at least one stays on. With one on, the top bar has no switch between them.
 */
import { useMemo } from 'react';
import { usePlugins, type Workbench } from './plugins.ts';

export type WorkMode = Workbench;
export const WORK_MODES: readonly WorkMode[] = ['edit', 'canvas', 'motion'];

export function useWorkModes(): readonly WorkMode[] {
  const plugins = usePlugins();
  return useMemo(() => {
    const on = WORK_MODES.filter((m) => plugins.some((p) => p.workbench === m && p.on));
    return on.length ? on : ['edit'];
  }, [plugins]);
}
