/**
 * Which ways of working a project offers: the workbenches of the plugins that are on (lib/plugins; the library's
 * Plugins tab), in the plugins' order: the edit (cutting the film), the canvas (making material), motion (layers and
 * keyframes), and any other a plugin brings (components/surfaces). The edit and
 * the canvas are on until the person says. With one on, the top bar has no switch between them; with none, a project
 * shows no workbench, only its library (and the app's chat).
 */
import { useMemo } from 'react';
import { usePlugins, type Workbench } from './plugins.ts';

export type WorkMode = Workbench;

export function useWorkModes(): readonly WorkMode[] {
  const plugins = usePlugins();
  return useMemo(() => {
    return plugins.flatMap((p) => (p.workbench && p.on ? [p.workbench] : []));
  }, [plugins]);
}
