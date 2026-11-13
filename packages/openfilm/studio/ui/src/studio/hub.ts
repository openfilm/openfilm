/**
 * What Studio's public module (studio/index, `openfilm/studio`) holds for the page outside the project's frame: the
 * app's commands and those who listen to them, what each workbench takes from others (its `add`, its commands) with
 * what was asked of it before it was there, and the buttons workbenches put on the top bar. The shell reads and
 * writes these too (shell/ProjectFrame, shell/top-bar), as the one page module they share.
 */
import type { StudioCommand } from '@/lib/host';

/** Several told of a change, each until it stops listening. */
function listeners<T>() {
  const set = new Set<(value: T) => void>();
  return {
    add: (listener: (value: T) => void) => { set.add(listener); return () => { set.delete(listener); }; },
    tell: (value: T) => { for (const listener of [...set]) listener(value); },
  };
}

/* ── the app's commands (lib/host.ts StudioCommand) that are not the page's own ── */
const commands = listeners<StudioCommand>();
/** Listen to the app's commands that are not the page's own (a clip to select, a moment to show); returns the way to stop. */
export const onCommand = (listener: (command: StudioCommand) => void): (() => void) => commands.add(listener);
/** The shell's: a command of the app's, told to every listener. */
export const tellCommand = (command: StudioCommand): void => commands.tell(command);

/* ── what a workbench takes from others ── */

/**
 * What the shell asks of one workbench alone: an app command that names a thing of it (`show-node`, a node of the
 * canvas), or a board to lay down (`lay-board`: an example's, copied into the project).
 */
export type WorkbenchCommand = StudioCommand | { type: 'lay-board'; board: unknown };

/** What a workbench lets others ask of it while it is in the page. Each is optional. */
export interface Workbench {
  /** Files of the project put into it, by their paths in the project's folder. `show`: it is shown after. */
  add?: (paths: readonly string[], options: { show: boolean }) => void;
  /** A command meant for it alone. */
  command?: (command: WorkbenchCommand) => void;
  /**
   * The project's version history is opened, or is about to save a version or put the project's files back: stop
   * what plays, and write what is still waiting to be written. The history waits for the promise before it saves or
   * puts files back.
   */
  settle?: () => Promise<unknown> | void;
  /**
   * The project's files were put back as a version had them, here or in another window: forget what was kept of them
   * before (undo steps), and read them again.
   */
  restored?: () => void;
}

type Ask = { add: readonly string[]; show: boolean } | { command: WorkbenchCommand };
const provided = new Map<string, Workbench>();
/** What was asked of a workbench not there yet, in order: given to it once it is. */
const waiting = new Map<string, Ask[]>();

function give(workbench: Workbench, ask: Ask): void {
  if ('add' in ask) workbench.add?.(ask.add, { show: ask.show });
  else workbench.command?.(ask.command);
}

function ask(name: string, what: Ask): void {
  const workbench = provided.get(name);
  if (workbench) { give(workbench, what); return; }
  waiting.set(name, [...(waiting.get(name) ?? []), what]);
}

/**
 * Say what the workbench `name` takes from others while it is there (its plugin's workbench name: `edit`, `canvas`);
 * what was asked of it before is given to it now. Returns the way to take it back.
 */
export function provide(name: string, workbench: Workbench): () => void {
  provided.set(name, workbench);
  const asked = waiting.get(name) ?? [];
  waiting.delete(name);
  for (const what of asked) give(workbench, what);
  return () => { if (provided.get(name) === workbench) provided.delete(name); };
}

/** Put files of the project into the workbench `name` (its `add`); kept until it is there. */
export function addTo(name: string, paths: readonly string[], options: { show?: boolean } = {}): void {
  ask(name, { add: [...paths], show: Boolean(options.show) });
}

/** The shell's: a command meant for the workbench `name` alone; kept until it is there. */
export const commandTo = (name: string, command: WorkbenchCommand): void => ask(name, { command });

/** The shell's: another project is shown, and nothing asked of a workbench for the last one is given to it. */
export const forgetAsked = (): void => waiting.clear();

/** The shell's: every workbench there settled (its `settle`) before the version history saves or puts files back. */
export const settleWorkbenches = async (): Promise<void> => {
  await Promise.all([...provided.values()].map((workbench) => workbench.settle?.()));
};

/** The shell's: every workbench there told that the project's files were put back as a version had them. */
export const tellRestored = (): void => { for (const workbench of [...provided.values()]) workbench.restored?.(); };

/* ── the top bar's buttons of the workbenches ── */

/**
 * A button a workbench puts on the top bar, drawn by the shell as its own are: an icon (`icon`, a name as a plugin's
 * openfilm.json gives one) or a few words (`text`), with `label` as its tooltip and accessible name.
 */
export interface TopBarTool {
  id: string;
  label: string;
  icon?: string;
  text?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

let tools: ReadonlyMap<string, readonly TopBarTool[]> = new Map();
const toolsChanged = listeners<void>();
/** The buttons on the top bar, by who put them there, in the order they were first put. */
export const topBarTools = {
  get: () => tools,
  subscribe: (listener: () => void) => toolsChanged.add(listener),
  /** `owner`'s buttons put on the top bar in place of the ones it put before (none, or null: taken off). */
  set: (owner: string, next: readonly TopBarTool[] | null) => {
    const map = new Map(tools);
    if (next?.length) map.set(owner, [...next]); else if (!map.delete(owner)) return;
    tools = map;
    toolsChanged.tell();
  },
};
