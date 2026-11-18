/**
 * `openfilm/studio`: what a plugin's element in Studio's page reaches of Studio, the same for OpenFilm's own plugins
 * and anyone's (packages/openfilm/plugins/README.md). It is named by the page's import map (studio/ui/workbenches.ts),
 * so a module loaded into the page imports it by that name, and it needs no framework: `openfilm/studio/react` is the
 * same for React.
 *
 * What it gives: the project shown, as a value that is told when it changes (`project`), with its film read and written
 * as the edit does; the toast; Settings opened; the app's chat pointed at (`chat`, in the desktop app); the app's
 * commands (`onCommand`); files put into another plugin's workbench (`addTo`) and what one's own takes (`provide`);
 * the person sent to a thing of the project by its link (`open`: `film.html#<clip>`, `film.html#t=12.5`, a file), shown
 * by the workbench that claims its file (`provide`'s `opens` and `show`), and a link read (`links`);
 * buttons on the top bar (`topBar`); the blocks its workbench is laid out in, drawn where Studio places them (`blocks`);
 * a plugin's own server routes and events (`pluginApi`, lib/plugin-api).
 *
 * It is read from the shell's frame (shell/frame) and kept apart from it: the frame and the wiring stay OpenFilm's own
 * (studio/internal), and may change with any version; this changes only with `version`.
 */
import { api, type Film, type MediaMade, type Op } from '@/api';
import { studioHost, type StudioCommand, type StudioRef, type StudioSelection } from '@/lib/host';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import type { ImportProgress } from '@/components/MediaPool';
import type { SettingsSection } from '@/components/settings/SettingsModal';
import { pluginApi, type PluginApi } from '@/lib/plugin-api';
import { frameStore } from '@/shell/frame';
import { addTo, editorHelps, onCommand, open, provide, topBarTools, type EditorHelp, type TopBarTool, type Workbench, type WorkbenchCommand } from './hub';
import { blockKey, drawing, mountOf, shownBlocks } from './blocks';
import { boxOf, parseLink, timeOf } from '@/lib/links';

/** The version of this interface: a change that breaks a plugin written for it comes with a new one. */
export const version = 1;

/**
 * A link read, as every workbench's `show` is given one (lib/links): `parse` its file and what after `#` (null: it
 * names nothing in the project); of that, `time` the moment (`{ at }`) or the stretch (`{ start, end }`) of `t=`, and
 * `box` the part of the picture of `xywh=` (in the picture's pixels), each null when the link has none. An element's
 * id is the fragment itself. A plugin reads its links with these, so they mean the same in every workbench.
 */
export const links = { parse: parseLink, time: timeOf, box: boxOf };

export type { ImportProgress, MediaSources, PluginApi, SettingsSection, TopBarTool, Workbench, WorkbenchCommand };
/** A file of the project, as Studio lists it: its path in the project's folder, its kind, and what is known of it. */
export type ProjectFile = WorkspaceResource;
/** How a file of the project was made by a service (`openfilm get`): the words it was asked with, who made it. */
export type FileMade = MediaMade;
/** film.html as a value: its stage and its tracks of clips (SPEC.md). */
export type FilmValue = Film;
/** An edit of film.html, by clip id, as the edit writes them (studio/server/ops.mjs). */
export type FilmOp = Op;
/** Something pointed at for the app's chat: a clip, a layer, a moment, a file… (lib/host.ts StudioRef). */
export type Ref = StudioRef;
/** What is selected and where the playhead is, as the app's chat is told it. */
export type Selection = StudioSelection;
/** What the app asks Studio to show. */
export type Command = StudioCommand;

/** The project shown, as a plugin sees it. The same value until something in it changes. */
export interface ProjectState {
  id: string;
  name: string;
  /** Its folder on this computer. */
  folder: string;
  /** The address its files are served from, ending in `/`: `film.html` and every file beside it, by its path. */
  film: string;
  /** Its media and its pages, as the library lists them (empty until they are listed). */
  files: readonly ProjectFile[];
  /** How its files were made, by path (only those a service made). */
  made: Readonly<Record<string, FileMade>>;
  /** Where a file's bytes, its poster and its waveform are read from. */
  sources: MediaSources;
  /** The workbench shown, by its name (`edit`, `canvas`, a plugin's); null: none is. */
  shown: string | null;
  /** The app's chat beside the project, in an app with one: open or not, and the way to open or fold it. */
  chat: { open: boolean; toggle: () => void } | null;
}

/** film.html as read: its text, its revision, its value (null: it does not read; `problems` say why). */
export interface FilmRead { text: string; rev: string; value: FilmValue | null; problems: readonly string[]; missing: boolean }

/** A project, read and written. */
export interface Project {
  readonly id: string;
  /** The project as it is now; null until Studio has read it. */
  get(): ProjectState | null;
  /** Be told each time `get()` changes; returns the way to stop. */
  subscribe(listener: () => void): () => void;
  /** Its film.html. */
  film: {
    read(): Promise<FilmRead>;
    /**
     * Write `ops`, made against revision `rev` (null: whichever is there). They are applied by clip id to the film as
     * it is, as the edit's are: a film that moved on meanwhile keeps what was written to it (`rebased`), and an op
     * whose clip is gone is refused (the promise rejects with why). The edit shows the result.
     */
    write(ops: readonly FilmOp[], rev: string | null): Promise<{ rev: string; value: FilmValue; rebased: boolean }>;
  };
  /** Bring files from this computer into the project, under `into` (`assets`); resolves with where each landed. */
  importFiles(files: readonly File[], options?: { into?: string; onProgress?: ImportProgress }): Promise<string[]>;
  /** Open the library on a file of the project, the file pointed out there. */
  showFile(path: string): void;
}

/** The frame of the project `id`, when it is the one shown. */
const frameOf = (id: string) => { const frame = frameStore.get(); return frame?.projectId === id ? frame : null; };

type Frame = NonNullable<ReturnType<typeof frameStore.get>>;
/** What a project's state is made from; the same inputs make the same value. */
const inputsOf = (frame: Frame) => [
  frame.loaded, frame.listing, frame.mediaMade, frame.mediaSources, frame.noBench, frame.surface, frame.canvasOpen, frame.chat,
] as const;

/** The project's state from its frame; `was`, the last one made, gives its list of files while the listing is the same. */
function stateOf(id: string, frame: Frame, was: { inputs: ReturnType<typeof inputsOf>; state: ProjectState | null } | null): ProjectState | null {
  const { loaded, listing } = frame;
  if (!loaded) return null;
  return {
    id, name: loaded.project.name, folder: loaded.project.path, film: loaded.folder,
    files: was?.state && was.inputs[1] === listing ? was.state.files : listing ? [...listing.files, ...listing.pages] : [],
    made: frame.mediaMade, sources: frame.mediaSources,
    shown: frame.noBench ? null : frame.surface ?? (frame.canvasOpen ? 'canvas' : 'edit'),
    chat: frame.chat ?? null,
  };
}

const projects = new Map<string, Project>();

/** The project `id`: the same object each time it is asked for. */
export function project(id: string): Project {
  const known = projects.get(id);
  if (known) return known;
  /* the last value of this project, kept while another is shown (a workbench is taken down a moment after) */
  let kept: { inputs: ReturnType<typeof inputsOf>; state: ProjectState | null } | null = null;
  const get = () => {
    const frame = frameOf(id);
    if (!frame) return kept?.state ?? null;
    const inputs = inputsOf(frame);
    if (!kept || inputs.some((input, i) => !Object.is(input, kept!.inputs[i]))) kept = { inputs, state: stateOf(id, frame, kept) };
    return kept.state;
  };
  const made: Project = {
    id,
    get,
    subscribe: (listener) => {
      let was = get();
      return frameStore.subscribe(() => { const now = get(); if (now !== was) { was = now; listener(); } });
    },
    film: {
      read: async () => {
        const read = await api.film(id);
        return { text: read.text, rev: read.rev, value: read.value, problems: read.problems, missing: Boolean(read.filmMissing) };
      },
      write: async (ops, rev) => {
        const done = await api.edit(id, rev, [...ops]);
        return { rev: done.rev, value: done.value, rebased: done.rebased };
      },
    },
    importFiles: async (files, options = {}) => {
      const frame = frameOf(id);
      if (!frame) throw new Error(`Project ${id} is not the one shown.`);
      return frame.onImport([...files], options.into ?? 'assets', options.onProgress ?? (() => {}));
    },
    showFile: (path) => { frameOf(id)?.showFile(path, true); },
  };
  projects.set(id, made);
  return made;
}

/** Say something in the toast at the foot of the page (`error`: as an error). */
export function toast(message: string, options: { error?: boolean } = {}): void {
  const shown = frameStore.get()?.toast;
  if (options.error) shown?.showError(message); else shown?.show(message);
}

/** Open Settings, on one of its sections (`models`: the services that make media). */
export function openSettings(section: SettingsSection = 'general'): void {
  frameStore.get()?.setSettingsOpen(section);
}

/**
 * The app's chat, in an app that has one (the desktop app); in a browser each is undefined. `refer`: a reference put in
 * the message being written; `unrefer`: one taken out of it again. `select`: what is selected now and where the
 * playhead is (its "@current selection").
 * `hover`: what the pointer is over (null: nothing), whose pills the chat lights.
 */
export const chat: {
  readonly refer: ((ref: Ref) => void) | undefined;
  readonly unrefer: ((ref: Ref) => void) | undefined;
  readonly select: ((selection: Selection) => void) | undefined;
  readonly hover: ((ref: Ref | null) => void) | undefined;
} = {
  get refer() { return studioHost?.refer; },
  get unrefer() { return studioHost?.unrefer; },
  get select() { return studioHost?.onSelection; },
  get hover() { return studioHost?.onHover; },
};

/** Buttons on the top bar, drawn before the workbench switch: `owner`'s (a plugin's id) in place of those it put there before; null takes them off. */
export const topBar = {
  set(owner: string, bar: { tools: readonly TopBarTool[] } | null): void { topBarTools.set(owner, bar?.tools ?? null); },
};

/**
 * More of how an editor is used, in its help (the dialog its "?" and the ? key open), under what its plugin says of it:
 * `help.set(editor, draw)`, `draw(into)` filling the element it is given and returning the way to take it out; null
 * takes it away.
 */
export const help = {
  set(editor: string, draw: EditorHelp | null): void { editorHelps.set(editor, draw); },
};

/**
 * The blocks a workbench is laid out in (its plugin's openfilm.json `blocks`): Studio arranges them with the page's own
 * (the chat, the library) and those of other workbenches, and the workbench draws each into its place. `owner` is the
 * workbench that declares the block (its element's `plugin`), `id` the block's.
 * - `slot(owner, id)`: the place to draw the block in, an element that is the same one for the page's life. Studio puts
 *   it wherever the block is in the arrangement shown (and takes it out while the block is not in it); what is drawn
 *   in it stays drawn.
 * - `draw(owner, id)`: say the block is drawn; returns the way to say it no longer is. Studio lays out a slot for a
 *   block only while it is drawn.
 * - `shown(owner, id)`: whether it is in the arrangement shown now, and visible; `subscribe(listener)` is told when that
 *   changes (returns the way to stop).
 * - `open(owner, id, open)`: show or hide it in the arrangement shown, as the person does from the layout's menu.
 */
export const blocks = {
  slot(owner: string, id: string): HTMLElement { return mountOf(owner, id); },
  draw(owner: string, id: string): () => void { return drawing(owner, id); },
  shown(owner: string, id: string): boolean { return shownBlocks.get().has(blockKey(owner, id)); },
  subscribe(listener: () => void): () => void { return shownBlocks.subscribe(listener); },
  open(owner: string, id: string, open: boolean): void { frameStore.get()?.openBlock(owner, id, open); },
};

/**
 * `pluginApi(id)`: the routes the plugin `id`'s `server.mjs` answers under `/api/plugins/<id>/…`, called from the page as
 * Studio's own requests are (`get`, `post`, `put`, `patch`, `delete`, each with the route's path), and what its server
 * code tells the project's pages (`events(projectId, listener)`).
 */
export { addTo, onCommand, open, pluginApi, provide };
