/**
 * What crosses between Studio's shell and the workbench shown in it. A workbench is an element with a React root of
 * its own (workbenches/edit.tsx, components/surfaces), so no context reaches it: the two sides share these two stores,
 * read with useSyncExternalStore.
 *
 * The frame is what the shell holds of the project for any workbench (shell/ProjectFrame: its files, how they were
 * made, the media pane's file operations, the toast, which workbench is shown, the library): the shell writes it, a
 * workbench reads it with `useFrame`. The wiring is what the workbench shown lets the shell reach of its own: that
 * workbench writes it, and the shell reads it when it needs it (`wiringStore.get()` inside a callback or an effect,
 * `useWiring` to draw), so nothing of a workbench's is held here.
 *
 * Both are written in a layout effect, so the other side is drawn with the new value before the page is painted.
 */
import * as React from 'react';
import type { CaptionsActions } from '@/components/library/CaptionsPane';
import type { LibraryActions } from '@/components/library/LibraryDrawer';
import type { SettingsSection } from '@/components/settings/SettingsModal';
import type { LibraryVoice, VoiceAccess } from '@/lib/library-voices';
import type { DockRect } from '@/lib/workspace-dock';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import type { LibraryDock, PanelSide } from '@/lib/workspaces';
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
  /**
   * What the library (shell/library) does in the workbench. Without it the library is only browsed: nothing of it is
   * put in a film, taken in hand or tried.
   */
  library?: {
    /** "+" or Enter on a file of the media pane: put in the film at the playhead (`saved`: one of Saved, brought into the project first). */
    add: (file: WorkspaceResource, saved: boolean) => void;
    /** The file of the media pane in hand, shown in the workbench's viewer and inspector (null: none), and whether it is one of Saved. */
    pickedPath: string | null;
    pickedSaved: boolean;
    /** Take a file of the media pane in hand (null: let go). `saved`: one of Saved. `quiet`: in hand only, what plays and the panes left as they are. */
    pick: (file: WorkspaceResource | null, how?: { saved?: boolean; quiet?: boolean }) => void;
    /** The files the film's clips play (each clip's `src`): the media pane marks them, and counts them before one is deleted. */
    usedSrcs: readonly string[];
    /** Files of the project are going to the trash: their clips taken off the film first (null, or why not). */
    onDropClipsForAssets: (paths: readonly string[]) => Promise<string | null>;
    /** The file the app's chat points at, lit in the media pane. */
    litPath: string | null;
    /** What Enter or "+" and a click do with a thing of the library. */
    actions: LibraryActions;
    /** The thing of the library being tried (its id). */
    tried: string | null;
    /** The templates whose try failed. */
    templateStatus: Partial<Record<string, 'failed'>>;
    /**
     * Where a thing of the library is tried in the workbench's viewer: the place of its transport (`bar`) and of its
     * cover (`picture`), each null when there is none now; `dismissRef`, which the drawer writes the way to end the try
     * into; and `begin`, called as a try starts.
     */
    preview: { bar: HTMLDivElement | null; picture: HTMLDivElement | null; dismissRef: React.RefObject<() => boolean>; begin: () => void };
    /** Where a caption track comes from (components/library/CaptionsPane). */
    captions: CaptionsActions;
    /** Words spoken in a voice of the library, put on the film at the playhead: null, or why not. */
    speak: (voice: LibraryVoice, access: VoiceAccess, text: string) => Promise<string | null>;
  };
  /**
   * Where the library's pane is, as the workbench lays the window out (for now): open or not, the side it is docked on
   * and its box, `free` when the panes float, how much of its foot the app's composer covers (`under`), and the seam
   * that sizes the app's panel while the pane covers it (`seam`; null: none). `setOpen` opens or closes the pane,
   * `onResize` keeps a new size of it, `setPanelWidth` sizes the app's panel (`done`: the drag is over).
   */
  libraryPane?: {
    open: boolean;
    dock: LibraryDock;
    rect: DockRect;
    free: boolean;
    under: number;
    seam: { label: string; width: number; bottom: number; side: PanelSide } | null;
    setOpen: (open: boolean) => void;
    onResize: (size: { assetsWidth?: number; libraryHeight?: number }) => void;
    setPanelWidth: (width: number, done?: boolean) => void;
  };
}

export const wiringStore = createStore<Wiring | null>(null);

/** A workbench's: keep its wiring told while it is shown. */
export function usePublishWiring(value: Wiring): void {
  usePublish(wiringStore, value);
}

/**
 * A workbench's: `value` to put in its wiring, the same one while what it holds is the same. Its functions are stood
 * for by ones that call the latest given, so a function made anew by every render changes nothing; its other fields
 * are compared as they are (a list or an object among them is to be the same one until it changes).
 */
export function useSteady<T extends object>(value: T): T {
  const latest = React.useRef(value);
  latest.current = value;
  const kept = React.useRef<{ of: T; steady: T } | null>(null);
  const isFunction = (field: unknown): field is (...args: unknown[]) => unknown => typeof field === 'function';
  const keys = Object.keys(value) as (keyof T)[];
  const was = kept.current;
  if (was && keys.length === Object.keys(was.of).length && keys.every((key) => (isFunction(value[key]) ? isFunction(was.of[key]) : Object.is(value[key], was.of[key])))) return was.steady;
  const steady = { ...value };
  for (const key of keys) {
    if (!isFunction(value[key])) continue;
    const call = (...args: unknown[]) => { const now = latest.current[key]; return isFunction(now) ? now(...args) : undefined; };
    steady[key] = call as T[keyof T];
  }
  kept.current = { of: value, steady };
  return steady;
}

/**
 * The shell's: these fields of the wiring of the workbench shown (null: none is), to draw with; the same object until
 * one of them changes, so what draws with some of the wiring is not drawn again when the rest of it changes. A
 * callback reads `wiringStore.get()` instead.
 */
export function useWiring<K extends keyof Wiring>(...fields: K[]): Pick<Wiring, K> | null {
  const kept = React.useRef<Pick<Wiring, K> | null>(null);
  return React.useSyncExternalStore(wiringStore.subscribe, () => {
    const now = wiringStore.get();
    const was = kept.current;
    if (!now) kept.current = null;
    else if (!was || fields.some((field) => !Object.is(was[field], now[field]))) {
      const next = {} as Pick<Wiring, K>;
      for (const field of fields) next[field] = now[field];
      kept.current = next;
    }
    return kept.current;
  });
}
