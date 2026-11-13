/**
 * `openfilm/studio/react`: `openfilm/studio` for an element drawn with React. It uses the page's own React (the import
 * map's `react`), so an element that imports `react` by that name shares it; one that bundles its own React uses
 * `openfilm/studio` instead.
 */
import * as React from 'react';
import { onCommand, project, provide, topBar, type Command, type ProjectState, type TopBarTool, type Workbench } from './index';

/** The project `id` as it is now, drawn again each time it changes; null until Studio has read it. */
export function useProject(id: string): ProjectState | null {
  const of = project(id);
  return React.useSyncExternalStore(of.subscribe, of.get);
}

/** What the workbench `name` takes from others (`provide`), while the component is there; its functions as the latest render gave them. */
export function useProvide(name: string, workbench: Workbench): void {
  const latest = React.useRef(workbench);
  latest.current = workbench;
  React.useEffect(() => provide(name, {
    add: (paths, options) => latest.current.add?.(paths, options),
    command: (command) => latest.current.command?.(command),
    settle: () => latest.current.settle?.(),
    restored: () => latest.current.restored?.(),
  }), [name]);
}

/** Listen to the app's commands that are not the page's own while the component is there, with the latest `listener`. */
export function useCommand(listener: (command: Command) => void): void {
  const latest = React.useRef(listener);
  latest.current = listener;
  React.useEffect(() => onCommand((command) => latest.current(command)), []);
}

/** `owner`'s buttons on the top bar while the component is there (`tools`: the same list until they change). */
export function useTopBar(owner: string, tools: readonly TopBarTool[]): void {
  React.useEffect(() => { topBar.set(owner, { tools }); }, [owner, tools]);
  React.useEffect(() => () => topBar.set(owner, null), [owner]);
}
