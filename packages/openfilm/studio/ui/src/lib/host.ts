import React from 'react';

/**
 * The app Studio is embedded in, when there is one. An app that shows Studio in its own window (rather than a browser
 * tab) sets `window.openfilmHost` before Studio's modules run (a preload, or the app's own page that builds Studio's
 * editor in, served with `startStudio({ editorDir })`); Studio then leaves out what only makes sense in a browser,
 * such as the button that introduces the desktop app.
 */
export interface StudioHost {
  /** the version of this interface the app speaks */
  version: 1;
  /** the app's name, for the person */
  name?: string;
  /**
   * The window has no title bar of its own: Studio's top bar is where the window is dragged, and `inset` pixels at its
   * left (macOS) and `insetRight` at its right (Windows) are left free for the window's controls. `onChange` tells of a
   * new left inset (a full-screen window has no controls to make room for).
   */
  titlebar?: { inset: number; insetRight?: number; onChange?: (listener: (inset: number) => void) => void };
  /**
   * The app has a chat: whatever the person points at becomes a reference in the message being written. Studio calls
   * this from "Reference in chat" on its menus (clips, layers, tracks, media), from ⌘L (what is selected; the range
   * marked on the timeline; else the frame at the playhead) and from a box drawn on the picture with ⌘ held.
   * Studio's things can also be dragged into the app's composer: they carry STUDIO_REF_TYPE (see there).
   */
  refer?: (ref: StudioRef) => void;
  /**
   * What is selected in the project shown and where the playhead is, each time either changes (the time a few times
   * a second while playing): what a chat's "@current selection" and "@current time" point at.
   */
  onSelection?: (selection: StudioSelection) => void;
  /**
   * What the pointer is over in Studio, each time that changes (null: nothing it points at): a clip's block on the
   * timeline, a layer on the picture. A chat lights its pills that point at the same thing.
   */
  onHover?: (ref: StudioRef | null) => void;
  /**
   * A panel of the app's own on Studio's right, under the top bar (its chat), drawn by the app in Studio's page: Studio's
   * top bar runs over it; below the bar Studio leaves `width` px free for it while it is open, and its Layout menu
   * shows and hides it as it does its own panes. The panel's element carries `data-studio-host-panel`, so Studio's
   * shortcuts leave the keys pressed in it alone. `onChange` tells Studio of a new width, or of the panel opened or
   * closed from the app.
   *
   * `assets`, when the app has it, is where the project's media lives instead of Studio's own left pane (the viewer is
   * then first on the left): a button in the panel opens them over it, and Studio draws them there, above the bottom
   * `bottom` px the panel keeps (its composer). `setAssetsOpen` opens or closes them from Studio; `setWidth` sizes the
   * panel from the seam beside them (the panel's own seam is under them then); `done` ends a drag.
   */
  panel?: {
    label: string;
    open: boolean;
    width: number;
    assets?: { open: boolean; bottom: number };
    setOpen: (open: boolean) => void;
    setAssetsOpen?: (open: boolean) => void;
    setWidth?: (width: number, done?: boolean) => void;
    onChange: (listener: (state: { open: boolean; width: number; assets?: { open: boolean; bottom: number } }) => void) => void;
  };
  /** Let the app ask Studio to show something: Studio calls this once with its listener. */
  onCommand?: (listener: (command: StudioCommand) => void) => void;
  /**
   * The agents the app's chat can use, for Settings → Agents: connected or not, shown in the chat's menu or not, and
   * the person's own key for the one that takes one. `onChange` tells of every change (a sign-in finished, a key set up)
   * and returns a way to stop listening.
   */
  agents?: {
    list: () => Promise<HostAgent[]>;
    connect: (id: HostAgentId) => Promise<{ ok: boolean; error?: string }>;
    disconnect: (id: HostAgentId) => Promise<unknown>;
    setShown: (id: HostAgentId, shown: boolean) => Promise<unknown>;
    configureByok: (config: { format: HostByokFormat; baseUrl?: string; model: string; key?: string }) => Promise<{ ok: boolean; error?: string; code?: string }>;
    onChange: (listener: (agents: HostAgent[]) => void) => () => void;
  };
  /**
   * Questions an agent's `openfilm get` asks the person before it spends (a video clip), and what it tells them (a
   * provider with no balance left: "Manage" opens its page), for an app with a chat to show where the person talks to
   * the agent, above its composer, instead of Studio's own card: the agent's command waits for a question's answer. Studio calls `show` with every question waiting in the project shown (an
   * empty list when none is left), worded in the language shown; `answer` gives the person's answer.
   */
  asks?: { show: (asks: HostAsk[], answer: (id: string, allow: boolean) => void) => void };
  /**
   * The app's developer mode, for Settings → Developer: on, its chat shows each turn's full log (everything the agent
   * sent and was answered, as it happened). `onChange` tells of a change from anywhere and returns a way to stop.
   */
  developer?: {
    get: () => Promise<boolean>;
    set: (on: boolean) => Promise<unknown>;
    onChange: (listener: (on: boolean) => void) => () => void;
  };
  /**
   * The app picks folders, and knows where a dropped one is: the Projects list gets "Open…", which asks the app for a
   * folder to open as a project (`pick`: null when the person cancelled), and opens a folder dropped on it (`pathOf`:
   * its full path, '' when the app cannot tell).
   */
  folders?: { pick: () => Promise<string | null>; pathOf: (file: File) => string };
}

/** A question about spending, worded for the person (see `asks`). */
export interface HostAsk { id: string; title: string; body: string | null; allowLabel: string; denyLabel: string }

export type HostAgentId = 'codex' | 'claude' | 'gemini' | 'copilot' | 'cursor' | 'opencode' | 'codebuddy' | 'qwen' | 'kimi' | 'byok';
/** The API a person's own key is for: OpenAI's Responses or Chat Completions, or Anthropic's Messages. */
export type HostByokFormat = 'responses' | 'chat' | 'anthropic';

/**
 * One agent as the app has it. `status`: ready · off (disconnected in the app; its own sign-in is kept) · sign-in (its
 * own sign-in is needed) · waiting (signing in, in Terminal) · missing (not installed: `install` says where from) ·
 * key (no key set up) · unavailable (not offered yet) · checking.
 */
export interface HostAgent {
  id: HostAgentId;
  name: string;
  shown: boolean;
  status: 'ready' | 'off' | 'sign-in' | 'waiting' | 'missing' | 'key' | 'unavailable' | 'checking';
  install?: string | null;
  /** What installing it takes, when `install` is not a download: 'code-tab', Claude Code comes with the Claude app (its Code tab). */
  setupRequired?: string | null;
  error?: string;
  byok?: { format: HostByokFormat; baseUrl: string; model: string; last4: string };
}

/** A box on the picture, in the film's stage pixels (the stage is `stage.w` × `stage.h`, film.html's stage). */
export interface StageBox { x: number; y: number; w: number; h: number }

/**
 * A picture for a reference, for its pill and for the agent. Either `src`, an address the host can load (a clip's own
 * frame or a still on Studio's origin, a data: URL), or `viewer`: what the viewer shows right now, which the host
 * takes itself as it hears of the reference (a screenshot of the viewer). `crop`, when only part of it is meant (a
 * region, a layer), is that part in stage pixels of a picture that shows the whole stage (`stage`).
 *
 * The moment at the playhead, a region and a layer are `viewer` pictures: drawing the whole film on the server for
 * them was slow, and while it drew Studio answered nothing else (an edit waited half a minute). A range and a subtitle
 * line have none: their times and clips say enough.
 */
export interface StudioRefImage { src?: string; viewer?: boolean; crop?: StageBox; stage?: { w: number; h: number } }

/**
 * Something the person points at, as the host hears of it. Times are seconds of the film; `id`s are film.html clip
 * ids; `loc` is a clip's place (`film.html#<track>.<clip>`); `track` is film.html's track index (0 = the top one).
 *
 *   · clip    a clip on the timeline: its file, its span on the film, its trim (`in`, source seconds) and `speed`
 *   · layer   an element inside a page clip: its words and tag, where it is on the picture at `time` (`box`), and
 *             where it is written (`source`, `file:line` of the page, when Studio knows it)
 *   · region  a box drawn on the picture at `time`: the clips showing there, the words inside it
 *   · time    a moment of the film
 *   · range   a stretch of the film (marked on the timeline's ruler, or with I and O): the clips playing in it
 *   · track   a whole track
 *   · file    a file of the project (the media pane): its path, kind, and length / size when known
 *   · subtitle a line of the film's subtitles (the subtitle panel), or words picked inside one: their span on the film,
 *             the words, the language they are in when a translation is shown (`lang`), the line's number in the panel
 *             (`index`, from 1), and each word's own span when the transcript has word times (`words`)
 *
 * `image` is the picture its pill shows and the agent is given (see StudioRefImage): a clip's own frame, the viewer as
 * it is for a moment, a region and a layer, none for a range or a subtitle line.
 */
export type StudioRef = (
  | { kind: 'clip'; id: string | null; loc: string | null; label: string; clipKind: string; src: string | null; start: number; end: number; track?: number; in?: number; speed?: number }
  | { kind: 'layer'; label: string; loc: string | null; clipId: string | null; text: string | null; tag: string | null; time?: number; box?: StageBox; source?: string | null }
  | { kind: 'region'; time: number; box: StageBox; clipIds: string[]; texts: string[] }
  | { kind: 'time'; time: number }
  | { kind: 'range'; start: number; end: number; clipIds: string[] }
  | { kind: 'track'; track: number; label: string; clipIds: string[] }
  | { kind: 'file'; path: string; fileKind: string; duration?: number; w?: number; h?: number }
  | { kind: 'subtitle'; start: number; end: number; text: string; lang?: string | null; index?: number; words?: Array<{ text: string; start: number; end: number }> }
) & { image?: StudioRefImage };

/**
 * The drag type Studio's things carry when dragged out (a clip, a layer, the marked range, a file of the media pane,
 * a subtitle line or the words picked in it):
 * a JSON array of StudioRef. The app's composer takes them as references.
 */
export const STUDIO_REF_TYPE = 'application/x-openfilm-ref';

export interface StudioSelection {
  projectId: string;
  /** the playhead, in seconds */
  time: number;
  /** the clips selected, then the layer picked inside a page clip, then the subtitle line picked in the subtitle panel */
  refs: StudioRef[];
  /** the range marked on the timeline's ruler, when there is one */
  range?: { start: number; end: number } | null;
  /** the film's stage, for boxes in stage pixels */
  stage?: { w: number; h: number };
}

/**
 * What an app can ask Studio to show: a clip selected (by its film.html id, or its place), a moment, a range marked,
 * a box on the picture shown at its moment, a track, a file of the media pane, a subtitle line (its span marked, the
 * subtitle panel open on it).
 *
 * And what a chat points at, without moving the playhead or changing the selection: `highlight`, the thing a pill the
 * person hovers stands for, lit until the next one (null: none); `draft-refs`, the things the message being written
 * references, in its order (the numbers the agent reads them by), marked with those numbers until the next list
 * (empty: sent or cleared).
 */
export type StudioCommand =
  | { type: 'select-clip'; id?: string | null; loc?: string | null; seek?: boolean }
  | { type: 'seek'; time: number }
  | { type: 'show-range'; start: number; end: number }
  | { type: 'show-box'; time: number; box: StageBox }
  | { type: 'show-track'; track: number }
  | { type: 'show-file'; path: string }
  | { type: 'show-subtitle'; start: number; end: number }
  | { type: 'highlight'; ref: StudioRef | null }
  | { type: 'draft-refs'; refs: StudioRef[] }
  /* the app's chat sends the person to Settings (an agent to set up) */
  | { type: 'settings'; section?: 'agents' | 'providers' };

export const studioHost: StudioHost | null = (globalThis as { openfilmHost?: StudioHost }).openfilmHost ?? null;

/** Make room for the host window's controls, and let Studio's top bars drag the window (see `titlebar`). */
export function applyStudioHost(root: HTMLElement = document.documentElement) {
  const titlebar = studioHost?.titlebar;
  if (!titlebar) return;
  const set = (inset: unknown) => {
    if (typeof inset === 'number' && inset >= 0) root.style.setProperty('--titlebar-logo-x', `${Math.max(6, Math.min(inset, 200))}px`);
  };
  root.dataset.hostTitlebar = '';
  if (typeof titlebar.insetRight === 'number' && titlebar.insetRight > 0) root.style.setProperty('--titlebar-right-x', `${Math.min(titlebar.insetRight, 240)}px`);
  set(titlebar.inset);
  titlebar.onChange?.(set);
}

/** The app's own panel (see `panel`): whether it is open and how wide, and its assets drawer, kept current. Null without one. */
export type HostPanel = {
  label: string;
  open: boolean;
  width: number;
  setOpen: (open: boolean) => void;
  /** null: the app keeps no assets of its own (Studio's left pane holds them) */
  assets: { open: boolean; bottom: number; setOpen: (open: boolean) => void } | null;
  setWidth: (width: number, done?: boolean) => void;
};

export function useHostPanel(): HostPanel | null {
  const panel = studioHost?.panel;
  const read = (next: { open: boolean; width: number; assets?: { open: boolean; bottom: number } }) => ({
    open: Boolean(next.open),
    width: Math.max(0, Number(next.width) || 0),
    assetsOpen: Boolean(next.assets?.open),
    bottom: Math.max(0, Number(next.assets?.bottom) || 0),
  });
  const [state, setState] = React.useState(() => (panel ? read(panel) : null));
  React.useEffect(() => { panel?.onChange((next) => setState(read(next))); }, [panel]);
  if (!panel || !state) return null;
  const setAssetsOpen = panel.setAssetsOpen;
  return {
    label: panel.label,
    open: state.open,
    width: state.width,
    setOpen: (open) => panel.setOpen(open),
    setWidth: (width, done) => panel.setWidth?.(width, done),
    assets: setAssetsOpen ? { open: state.open && state.assetsOpen, bottom: state.bottom, setOpen: (open) => setAssetsOpen(open) } : null,
  };
}
