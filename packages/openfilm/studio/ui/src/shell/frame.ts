/**
 * What crosses between Studio's shell and the edit, OpenFilm-internal: NOT part of Studio's public interface. Any
 * workbench (the canvas, a plugin someone made) reaches the shell through `openfilm/studio` (studio/index), which is
 * read from the frame here; the edit reaches the rest of it through studio/internal. A workbench is an element with a
 * React root of its own (plugins/edit, plugins/canvas, components/surfaces), so no context reaches it: the sides share
 * these stores, read with useSyncExternalStore.
 *
 * The frame is what the shell holds of the project for any workbench (shell/ProjectFrame: the project as read, its
 * files, how they were made, the media pane's file operations, the toast, which workbench is shown, the library, the page's own windows,
 * how the window is laid out): the shell writes it, a workbench reads it with `useFrame`. A wiring is what a workbench
 * lets others reach of its own: each workbench writes its own under its name, and the shell reads them as one, the
 * workbench shown's first (`wiringStore.get()` inside a callback or an effect, `useWiring` to draw); a workbench
 * reaches another's with `wiringOf`. So nothing of a workbench's is held here. What a workbench takes from others
 * (files put into it, the app's commands) and its buttons on the top bar go through `openfilm/studio` (studio/hub).
 *
 * Both are written in a layout effect, so the other side is drawn with the new value before the page is painted.
 */
import * as React from 'react';
import type { CaptionsActions } from '@/components/library/CaptionsPane';
import type { CoversActions } from '@/components/library/CoversPane';
import type { LibraryActions } from '@/components/library/LibraryDrawer';
import type { SpeakVoice } from '@/lib/library-voices';
import type { Recorder } from '@/components/RecordPane';
import type { BlockSizer } from '@/lib/workspace-preview';
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
function usePublish<T extends object>(store: Pick<Store<T | null>, 'get' | 'set'>, value: T): void {
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
 * workbench is taken down a moment after the shell's frame (plugins/edit), and is never drawn with nothing,
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
  /** Motion was picked: the workbench opens what Motion is worked in. */
  motionShown?: () => void;
  /**
   * What the workbench has on the page's top bar, which the shell draws (shell/top-bar). `tools`: its own buttons, drawn
   * before the workbench switch. `menu`: a menu of its own that pops up at the pointer, kept in the bar (a right click
   * on it is quiet, as on the bar). Both are drawn in the shell's React root, so nothing in them reads a context of the
   * workbench's; each is the same one until what it shows changes. `film`: what the workbench knows of the film, said on
   * the project's card. `coverFromFrame`: make the picture at the playhead the project's cover.
   */
  topBar?: {
    tools: React.ReactNode;
    menu: React.ReactNode;
    film: { durationMs: number; stage: { w: number; h: number }; fps: number; clips: number };
    coverFromFrame: () => void;
  };
  /**
   * How the workbench's own blocks are drawn where the panels are docked (lib/workspace-preview BlockSizer): the
   * edit's timeline fitted to its tracks, its inspector left out of a narrow window while it has nothing in hand. The
   * layout (shell/layout) lays the blocks out with it wherever they are, and its menu draws the arrangements with it.
   * Without it, each block is drawn as declared.
   */
  blocks?: BlockSizer;
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
    /** While a cover is open: its looks and its picture (components/library/CoversPane). */
    covers?: CoversActions;
    /** Words spoken in a voice of the library, put on the film at the playhead: null, or why not. */
    speak: SpeakVoice;
    /** Recording from the microphone (the voice-over's Record line), the workbench's own: it goes on while the drawer shows other things. */
    recorder: Recorder;
  };
}

/** Each workbench's own wiring, by its workbench's name, in the order they were first told. */
const wirings = new Map<string, Wiring>();
/** The workbench shown (null: none is), as the shell last told it. */
let benchShown: string | null = null;

/**
 * What the shell draws and acts with: the wiring of the workbench shown, and for each field it does not say, the
 * first other wiring told that does (null: none is told). The same object until one of its fields changes.
 */
export const wiringStore = createStore<Wiring | null>(null);

/** Make `wiringStore` again from the wirings told and the workbench shown. */
function resolveWiring(): void {
  if (!wirings.size) { wiringStore.set(null); return; }
  const own = benchShown != null ? wirings.get(benchShown) : undefined;
  const next: Record<string, unknown> = {};
  for (const wiring of [...(own ? [own] : []), ...[...wirings].filter(([name]) => name !== benchShown).map(([, w]) => w)]) {
    for (const [key, field] of Object.entries(wiring)) if (next[key] === undefined && field !== undefined) next[key] = field;
  }
  const was = wiringStore.get();
  if (!was || !sameFields(was as Record<string, unknown>, next)) wiringStore.set(next as Wiring);
}

/** A workbench's, under its workbench's name (`edit` for the edit): keep its wiring told while it is there. */
export function usePublishWiring(workbench: string, value: Wiring): void {
  const slot = React.useMemo(() => ({
    get: () => wirings.get(workbench) ?? null,
    set: (next: Wiring | null) => { if (next) wirings.set(workbench, next); else wirings.delete(workbench); resolveWiring(); wiringsTold.set(wiringsTold.get() + 1); },
  }), [workbench]);
  usePublish(slot, value);
}

/** One workbench's own wiring (null: it told none): how one workbench reaches another, read when it is needed. */
export function wiringOf(workbench: string): Wiring | null {
  return wirings.get(workbench) ?? null;
}

/** Each workbench's own wiring, told whenever one of them changes (`wiringOf` read with it). */
const wiringsTold = createStore(0);

/** The shell's: one field of each workbench's own wiring, by the workbench's name, to draw with; the same object until one of them changes. */
export function useWiringsOf<K extends keyof Wiring>(field: K): ReadonlyMap<string, NonNullable<Wiring[K]>> {
  const kept = React.useRef<Map<string, NonNullable<Wiring[K]>>>(new Map());
  return React.useSyncExternalStore(wiringsTold.subscribe, () => {
    const next = new Map<string, NonNullable<Wiring[K]>>();
    for (const [name, wiring] of wirings) if (wiring[field] !== undefined) next.set(name, wiring[field] as NonNullable<Wiring[K]>);
    const was = kept.current;
    if (was.size !== next.size || [...next].some(([name, value]) => was.get(name) !== value)) kept.current = next;
    return kept.current;
  });
}

/** The shell's: tell which workbench is shown (null: none is), before the page is painted. */
export function usePublishShown(workbench: string | null): void {
  React.useLayoutEffect(() => {
    benchShown = workbench;
    resolveWiring();
  }, [workbench]);
}

/**
 * A workbench's, for its wiring (or the shell's, for the frame): `value`, the same one while what it holds is the
 * same. Its functions are stood for by ones that call the latest given, so a function made anew by every render
 * changes nothing; its other fields are compared as they are (a list or an object among them is to be the same one
 * until it changes).
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
 * The shell's: these fields of the wiring as it reads it (`wiringStore`; null: none is told), to draw with; the same object until
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
