/**
 * What crosses between Studio's shell and the workbench shown in it. A workbench is an element with a React root of
 * its own (workbenches/edit.tsx, components/surfaces), so no context reaches it: the two sides share these two stores,
 * read with useSyncExternalStore.
 *
 * The frame is what the shell holds of the project for any workbench (shell/ProjectFrame: its files, how they were
 * made, the media pane's file operations, the toast, which workbench is shown): the shell writes it, a workbench reads
 * it with `useFrame`. The wiring is what the workbench shown lets the shell reach of its own: that workbench writes it,
 * and the shell reads it when it needs it (`wiringStore.get()` inside a callback or an effect, `useWiring` to draw), so
 * nothing of a workbench's is held here.
 *
 * Both are written in a layout effect, so the other side is drawn with the new value before the page is painted.
 */
import * as React from 'react';
import type { SettingsSection } from '@/components/settings/SettingsModal';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import type { useProjectFrame } from './ProjectFrame';

/** A value kept outside React, with those told when it changes. */
interface Store<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** Whether two values have the same fields, each the very same. */
function sameFields<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

/**
 * Keep `value` in `store` while the component is there: written when a field of it changed, and taken out when the
 * component goes (unless another has written its own meanwhile).
 */
function usePublish<T extends object>(store: Store<T | null>, value: T): void {
  const told = React.useRef<T | null>(null);
  React.useLayoutEffect(() => {
    if (told.current && sameFields(told.current, value)) return;
    told.current = value;
    store.set(value);
  });
  React.useLayoutEffect(() => () => {
    if (store.get() === told.current) store.set(null);
    told.current = null;
  }, [store]);
}

/** What the shell holds of the project: whatever shell/ProjectFrame's hook returns. */
type FrameState = ReturnType<typeof useProjectFrame>;
/** That, as a workbench is given it: with the page's places there (the shell draws no workbench before they are). */
export type Frame = Omit<FrameState, 'slots'> & { slots: NonNullable<FrameState['slots']> };

export const frameStore = createStore<FrameState | null>(null);

/** The shell's: keep the project's frame told. */
export function usePublishFrame(value: FrameState): void {
  usePublish(frameStore, value);
}

/**
 * A workbench's: the frame of its project. It keeps the last one told of its project: as a project is left its
 * workbench is taken down a moment after the shell's frame (workbenches/edit.tsx), and is never drawn with nothing,
 * nor with the frame of the project gone to.
 */
export function useFrame(projectId: string): Frame {
  const kept = React.useRef<Frame | null>(null);
  const frame = React.useSyncExternalStore(frameStore.subscribe, () => {
    const now = frameStore.get();
    if (now?.projectId === projectId && now.slots) kept.current = now as Frame;
    return kept.current?.projectId === projectId ? kept.current : null;
  });
  if (!frame) throw new Error(`useFrame: no frame of project ${projectId} yet. A workbench is drawn inside the shell's <ProjectFrame>, after it has told the frame.`);
  return frame;
}

/** What a workbench may let the shell reach of its own. Each is optional: a workbench without one is left alone. */
export interface Wiring {
  /** Draw the picture again from the project's files: one it shows was made ready, or found again. */
  reloadPicture?: () => void;
  /** The files the film's clips play now (each clip's `src`). */
  srcsInUse?: () => readonly string[];
  /** Stop what plays: the canvas is about to be shown over the workbench. */
  pause?: () => void;
  /** Whether its panes are being rearranged: the workbench shown stays the one it is meanwhile. */
  rearranging?: () => boolean;
  /** Motion was picked: the workbench opens what Motion is worked in. */
  motionShown?: () => void;
  /** Put a file of the canvas in the film. */
  addToFilm?: (file: WorkspaceResource) => void;
  /** Put a cut of the canvas in the film, its files one after the other, then show the film. */
  sendToFilm?: (files: WorkspaceResource[]) => void;
  /** Find a file in the library's media (`highlight`: pointed out there, what is picked left as it is). */
  showFile?: (path: string, highlight?: boolean) => void;
  /** Open Settings on a section. */
  openSettings?: (section: SettingsSection) => void;
  /** The app's own panel beside the workbench (none: the app has no such panel): whether it is open, and the way to open or fold it. */
  chat?: { open: boolean; toggle: () => void };
  /**
   * How the workbench lays the window out, for what the shell draws in the panes' place: the room kept round the panes
   * with the edit shown (`edit`) and with the canvas shown (`canvas`), and the canvas's own frame where the panes float
   * (`canvasFrame`). Each is a style, the same one until it changes.
   */
  places?: { edit: React.CSSProperties; canvas: React.CSSProperties; canvasFrame: React.CSSProperties };
}

export const wiringStore = createStore<Wiring | null>(null);

/** A workbench's: keep its wiring told while it is shown. */
export function usePublishWiring(value: Wiring): void {
  usePublish(wiringStore, value);
}

/** The shell's: the wiring of the workbench shown (null: none is), to draw with. A callback reads `wiringStore.get()` instead. */
export function useWiring(): Wiring | null {
  return React.useSyncExternalStore(wiringStore.subscribe, wiringStore.get);
}
