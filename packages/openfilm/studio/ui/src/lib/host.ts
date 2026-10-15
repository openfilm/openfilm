import React from 'react';

/**
 * The app Studio is embedded in, when there is one. An app that shows Studio in its own window (rather than a browser
 * tab) sets `window.openfilmHost` before Studio's modules run (a preload, or the app's own page that builds Studio's
 * editor in, served with `startStudio({ editorDir })`); Studio then leaves out what only makes sense in a browser,
 * such as the button that introduces the desktop app.
 */
/** A tab of the app's window (`tabs` below): a project's, its title as Studio shows it. */
export interface HostTab { id: string; projectId: string; title: string; active: boolean; working: boolean; asking: boolean; exporting: number | null }

/** Settings → Developer, as the app keeps it (`developer` below). */
export interface HostDeveloper { logs: boolean; changes: boolean }

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
  /**
   * The app's chat names a skill in the message being written: the examples (opened from the chat, `show-examples`)
   * call this for a skill picked in them.
   */
  useSkill?: (skill: { name: string; description: string }) => void;
  /** The person's own skills, where the app keeps them: one added (the app's own way: from a link, a folder, or made
      with the agent), their folder shown. The examples' skills offer both. */
  skills?: { add: () => void; reveal: () => void };
  /** Let the app ask Studio to show something: Studio calls this once with its listener. */
  onCommand?: (listener: (command: StudioCommand) => void) => void;
  /**
   * The agents the app's chat can use, for Settings → Agents: connected or not, shown in the chat's menu or not, and
   * the person's own key for the one that takes one. `onChange` tells of every change (a sign-in finished, a key set up)
   * and returns a way to stop listening. One of the person's own agents, found or not, can be pointed at a program
   * of the person's choosing (`locate`: the system's file dialog, with Studio's words; `{ ok: false }` and no error
   * when cancelled) and set back to being found (`useAutomatic`); `diagnose` says what was searched (an older app
   * has none of these).
   */
  agents?: {
    list: () => Promise<HostAgent[]>;
    connect: (id: HostAgentId) => Promise<{ ok: boolean; error?: string }>;
    disconnect: (id: HostAgentId) => Promise<unknown>;
    /** Codex: what is left of its plan, as it says for the account signed in (null: it can't say; other agents, null) */
    usage?: (id: HostAgentId, fresh?: boolean) => Promise<HostAgentUsage | null>;
    setShown: (id: HostAgentId, shown: boolean) => Promise<unknown>;
    locate?: (id: HostAgentId, words?: { title?: string; button?: string }) => Promise<{ ok: boolean; error?: string; code?: 'not-a-program' | 'did-not-start' | string }>;
    useAutomatic?: (id: HostAgentId) => Promise<unknown>;
    diagnose?: (id: HostAgentId) => Promise<HostAgentDiagnosis | null>;
    /**
     * One of the person's own models set up (no `id`) or changed: checked before it is kept. A key left empty keeps its
     * own, or takes the one of another model on the same address.
     */
    saveOwnModel: (config: HostOwnModelConfig) => Promise<{ ok: true; id: string } | { ok: false; error: string; code?: string }>;
    removeOwnModel: (id: string) => Promise<unknown>;
    /**
     * The MCP servers the person added to an agent themselves (its maker's not among them), each let into the app or
     * not: hidden there until let in. `filtered` false: the agent cannot be told, and has them all.
     */
    mcp?: (id: HostAgentId) => Promise<{ filtered: boolean; servers: Array<{ name: string; detail: string; allowed: boolean }> }>;
    allowMcp?: (id: HostAgentId, name: string, allowed: boolean) => Promise<unknown>;
    /** The same for the skills the person installed in an agent themselves (OpenFilm's own skill for terminal agents is never among them). */
    skills?: (id: HostAgentId) => Promise<{ filtered: boolean; skills: Array<{ name: string; description: string; allowed: boolean }> }>;
    allowSkill?: (id: HostAgentId, name: string, allowed: boolean) => Promise<unknown>;
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
   * The app's own updates, shown in Studio's top bar beside the projects button: a new version downloaded and ready,
   * and Restart to install it. `onChange` gives the state now and on every change (null: nothing to show), and returns
   * a way to stop listening. `restart` is refused while an agent works or Studio exports; the update then stays ready,
   * with the reason (`waiting`).
   */
  update?: {
    onChange: (listener: (update: HostUpdate | null) => void) => () => void;
    restart: () => Promise<{ ok: boolean; error?: string }>;
    /** Settings → About: the whole state now and on every change, and a check made now (it resolves when it ends) */
    onState?: (listener: (state: HostUpdateState) => void) => () => void;
    check?: () => Promise<HostUpdateState | null>;
  };
  /**
   * The app's chat, for Settings → Developer: `logs`, each turn's full log (everything the agent sent and was
   * answered, as it happened); `changes`, what each turn changed in the project's files, under its reply. `onChange`
   * tells of a change from anywhere and returns a way to stop.
   */
  developer?: {
    get: () => Promise<HostDeveloper>;
    set: (next: Partial<HostDeveloper>) => Promise<unknown>;
    onChange: (listener: (prefs: HostDeveloper) => void) => () => void;
  };
  /**
   * The app shows each project in a tab of its own window and draws no tab strip of its own: Studio draws the tabs in
   * its top bar (where the projects button and the title are otherwise), with a `+` that opens the projects window to
   * pick the project a new tab shows (`open`; one open already is shown). With no tab open the page is at `/`, and
   * Studio shows the projects there. `list` gives the tabs and which is this page's (`self`); `onChange` every change.
   * A page `report`s what it shows (its title, an export's progress, its project gone: its tab closes). Studio's
   * "open this project" (heard by every page) goes to `openRequest`, which the app settles once; `onPick` is the app
   * asking for the projects window (a new tab from its menu).
   */
  tabs?: {
    list: () => Promise<{ self: string | null; tabs: HostTab[] }>;
    onChange: (listener: (tabs: HostTab[]) => void) => () => void;
    show: (id: string) => void;
    close: (id?: string) => void;
    /** a project's tab: shown, opened when it is not */
    open: (projectId: string) => void;
    move: (id: string, index: number) => void;
    report: (state: { title?: string; exporting?: number | null; gone?: boolean }) => void;
    openRequest: (to: string) => void;
    onPick: (listener: () => void) => () => void;
  };

  /**
   * The app picks folders, and knows where a dropped one is: the Projects list gets "Open…", which asks the app for a
   * folder to open as a project (`pick`: null when the person cancelled), and opens a folder dropped on it (`pathOf`:
   * its full path, '' when the app cannot tell). The export's "Save to" asks with its own words and the folder it
   * starts in (`title`, `button`, `at`).
   */
  folders?: {
    pick: (options?: { title?: string; button?: string; at?: string }) => Promise<string | null>;
    pathOf: (file: File) => string;
  };
}

/** A question about spending, worded for the person (see `asks`). */
export interface HostAsk { id: string; title: string; body: string | null; allowLabel: string; denyLabel: string }

/**
 * Where the app's update is: `off` (this build never updates) · idle · checking · current · available · downloading
 * (`progress` 0–100) · staging (macOS unpacks it) · ready · installing · error. `availableVersion`: the newer version
 * found; `checkedAt`: when a check last answered (ms); `error`: offline · unavailable · failed (a check or download),
 * agent-busy · exporting · install-failed (a Restart not done).
 */
export interface HostUpdateState {
  status: 'off' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'staging' | 'ready' | 'installing' | 'error';
  version: string;
  channel: 'stable' | 'beta';
  availableVersion: string | null;
  progress: number;
  checkedAt: number | null;
  error: string | null;
}

/** An update of the app, ready to install or installing; `waiting`: why the last Restart did not go ahead. */
export type HostUpdate = { status: 'ready' | 'installing'; version: string; waiting?: 'agent-busy' | 'exporting' | 'install-failed' | null };

export type HostAgentId = 'codex' | 'claude' | 'gemini' | 'copilot' | 'cursor' | 'opencode' | 'codebuddy' | 'qwen' | 'kimi' | 'byok';
/**
 * What was searched for an agent (`agents.diagnose`): the report to copy, the program's name, where it was found, and
 * when it was not, why: chosen-missing (the program chosen is gone) · wsl (only inside WSL, which the app cannot use) ·
 * unusable (files with its name, none that starts) · none.
 */
export interface HostAgentDiagnosis { found: string | null; program?: string; hint: 'chosen-missing' | 'wsl' | 'unusable' | 'none' | null; text: string }

/** The API a person's own key is for: OpenAI's Responses or Chat Completions, or Anthropic's Messages. */
export type HostByokFormat = 'responses' | 'chat' | 'anthropic';

/**
 * One agent as the app has it. `status`: ready · off (disconnected in the app; its own sign-in is kept) · sign-in (its
 * own sign-in is needed) · waiting (signing in, in Terminal) · missing (not installed: `install` says where from) ·
 * key (no key set up) · unavailable (not offered yet) · checking. `account`: whose sign-in it uses, as the program says
 * (no key or token).
 */
export interface HostAgent {
  id: HostAgentId;
  name: string;
  shown: boolean;
  status: 'ready' | 'off' | 'sign-in' | 'waiting' | 'missing' | 'key' | 'unavailable' | 'checking';
  install?: string | null;
  /** What installing it takes, when `install` is not a download: 'code-tab', Claude Code comes with the Claude app (its Code tab). */
  setupRequired?: string | null;
  /** The program used (the person's own agents), and the one the person chose for it, if they did. */
  path?: string | null;
  chosen?: string | null;
  error?: string;
  account?: HostAgentAccount;
  /** The own key's models, each set up on its own; the first is the one a conversation starts on. */
  byok?: { models: HostOwnModel[] };
}

/**
 * One of the person's own models: its `id` (the app's), the `name` the chat's menu shows, its service (API `format`
 * and `baseUrl`), the `model` asked for there, its efforts, and the last four characters of its key.
 */
export interface HostOwnModel extends HostByokEffort { id: string; name: string; format: HostByokFormat; baseUrl: string; model: string; last4: string }

/** What setting up one of the person's own models sends: `id` to change one, no `key` to keep its key. */
export interface HostOwnModelConfig { id?: string; name?: string; format: HostByokFormat; baseUrl: string; model: string; key?: string; levels: HostByokEffortLevel[]; effort: HostByokEffortLevel }

/**
 * The reasoning efforts a model of the person's own key offers, in this order (`auto`: none is sent, the service decides),
 * and the one a conversation starts on. A model given none offers `auto` alone.
 */
export const BYOK_EFFORTS = ['auto', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type HostByokEffortLevel = (typeof BYOK_EFFORTS)[number];
export interface HostByokEffort { levels: HostByokEffortLevel[]; effort: HostByokEffortLevel }

/**
 * What is left of an agent's plan: each window's share used (0–100), how long it is (minutes) and when it resets (ms);
 * `kind`: five_hour · seven_day · window (another length).
 * `account`: whose it is, when the program says it here (Codex's email and plan).
 */
export interface HostAgentUsage {
  plan: string | null;
  windows: Array<{ kind: 'five_hour' | 'seven_day' | 'window'; minutes: number | null; usedPercent: number; resetsAt: number | null }>;
  account?: { email?: string; plan?: string };
}

/** Whose sign-in an agent uses: how (a claude.ai or ChatGPT account, an API key…), and what the program tells of it. */
export interface HostAgentAccount { method: 'claude.ai' | 'console' | 'api-key' | 'chatgpt' | 'other'; email?: string; org?: string; plan?: string }

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
 *   · example  an example film (ExamplesGallery), or a part of it (`start`–`end`, a `segment` it names): where it comes
 *             from (`url`), and its folder on this computer to read how it is made (`folder`: fetched by the app
 *             when the message is sent, if not yet)
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
  | { kind: 'example'; id: string; title: string; url: string; folder?: string; start?: number; end?: number; segment?: string }
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
  | { type: 'settings'; section?: 'agents' | 'providers' }
  /* the app's chat opens the examples over the film, to point at one or a part of one, or name a skill */
  | { type: 'show-examples' };

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

/** The app's update to show in the top bar (see `update`), kept current. Null without one. */
export function useHostUpdate(): { update: HostUpdate; restart: () => Promise<{ ok: boolean; error?: string }> } | null {
  const host = studioHost?.update;
  const [update, setUpdate] = React.useState<HostUpdate | null>(null);
  React.useEffect(() => host?.onChange(setUpdate), [host]);
  return host && update ? { update, restart: host.restart } : null;
}
