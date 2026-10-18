/**
 * The parts of `window.openfilmDesktop` that are this app's own (src/preload-chat.cjs); the parts the copied chat code
 * uses (localAgents, pathForFile) are typed in lib/desktop-bridge.ts.
 */
import type { CommunityItem, StudioRef, StudioSelection } from 'openfilm/studio-ui/lib/host.ts';
import type { FileChange } from './lib/file-changes';

/* what Studio and the chat say to each other about the film is Studio's own contract (its lib/host.ts) */
export type { StageBox, StudioCommand, StudioRef, StudioRefImage, StudioSelection } from 'openfilm/studio-ui/lib/host.ts';

export type Theme = 'light' | 'dark';
export interface Project { id: string; name: string; path: string }
/** Whether Studio has ffmpeg: the app downloads its own when the computer has none (null: not known yet). */
export type FfmpegState = boolean | null | { state: 'downloading'; progress?: number } | { state: 'failed'; message?: string };
/**
 * Where an update is (src/update-controller.mjs). The chat shows only a ready one, and why Restart had to wait
 * (`error`: 'agent-busy' | 'exporting' | 'install-failed'); a failed check is the menu's to say.
 */
interface AppBridge {
  hello(): Promise<{ platform: string; flavor: string; theme: Theme; language: string; chatOpen: boolean; project: Project | null; selection: StudioSelection | null; ffmpeg: FfmpegState; version: string; chatMin: number }>;
  onTheme(listener: (theme: Theme) => void): () => void;
  /** Studio's language (its <html lang>) */
  onLanguage(listener: (language: string) => void): () => void;
  onProject(listener: (project: Project) => void): () => void;
  onChatOpen(listener: (open: boolean) => void): () => void;
  onStudioBrowser(listener: (state: { state: 'downloading' | 'ready' | 'failed'; message?: string }) => void): () => void;
  onStudioFailed(listener: (message: string) => void): () => void;
  onRefer(listener: (ref: StudioRef) => void): () => void;
  onFfmpeg(listener: (state: FfmpegState) => void): () => void;
  /** take the person to a reference in Studio */
  showInStudio(ref: StudioRef): void;
  /** an example's folder on this computer, fetched when needed (a reference to one, as its message is sent) */
  exampleFolder?(id: string): Promise<string>;
  /** the examples over the film (Studio's), to point at one or a part of one, or name a skill */
  /** the Community over the film; `open`: on that skill's or example's page */
  showExamples?(open?: CommunityItem): void;
  /** a skill picked in the examples, to be named in the message */
  onUseSkill?(listener: (skill: { name: string; description: string }) => void): () => void;
  /** "Add a skill" in the examples */
  onAddSkill?(listener: () => void): () => void;
  /** name a skill in the message being written (as one picked in the examples) */
  useSkill?(skill: { name: string; description: string }): void;
  /** the reference with its picture: the viewer as it is now, for one that shows it (lib/host.ts StudioRefImage) */
  withPicture(ref: StudioRef): Promise<StudioRef>;
  /** light in Studio what a hovered pill points at, without moving there (null: the pointer left it) */
  highlightInStudio(ref: StudioRef | null): void;
  /** the references of the message being written, in its order: Studio marks them with their numbers ([] once sent) */
  draftRefsInStudio(refs: StudioRef[]): void;
  /** what the pointer is over in Studio (null: nothing it points at): pills pointing at the same thing light up */
  onStudioHover(listener: (ref: StudioRef | null) => void): () => void;
  /** the project's files (Studio's listing), for the @ menu */
  projectFiles(): Promise<{ files: Array<{ path: string; kind: string; size: number }>; pages?: Array<{ path: string; size: number }> }>;
  onSelection(listener: (selection: StudioSelection) => void): () => void;
  setChatWidth(width: number, done?: boolean): void;
  setChatOpen(open: boolean): void;
  /** the project's assets, drawn by Studio over this column while open (main.mjs `assets`) */
  assetsOpen(): boolean;
  setAssetsOpen(open: boolean): void;
  onAssets(listener: (open: boolean) => void): () => void;
  /** while the assets are open: the composer's height (all the view keeps), and a menu of ours open (it needs the column) */
  setComposerHeight(px: number): void;
  setMenuOpen(open: boolean): void;
  /** the project's chat record, in its folder: conversations and finished turns (.film/chat), each turn's log (.film/logs) */
  chat: {
    load(project: string): Promise<{ sessions: unknown[]; last: string | null; turns: unknown[] }>;
    saveSessions(project: string, sessions: unknown[], last: string | null): Promise<unknown>;
    saveTurn(project: string, turn: unknown, items: unknown[]): Promise<unknown>;
    /** `unless`: the sizes of the log already read; when it has not grown, `{ same: true }` */
    log(project: string, turnId: string, unless?: { size: number; callsSize: number }): Promise<TurnLog | { same: true } | null>;
    reveal(project: string, turnId?: string): Promise<unknown>;
    /** a picture a message's reference points at, kept for its agent: .film/refs/<turn>-<n>.jpg (its path in the project) */
    saveRefImage(project: string, turnId: string, n: number, bytes: ArrayBuffer): Promise<{ path: string }>;
    /** a file pasted into a message (it has no path of its own), kept for its agent: .film/attachments/<name> */
    saveAttachment(project: string, name: string, bytes: ArrayBuffer): Promise<{ path: string }>;
    /** what each path dragged into a message is, where it is (nothing is copied) */
    describePaths(paths: string[]): Promise<Array<{ path: string; folder: boolean; size?: number } | { path: string; error: string }>>;
    /** the turns with a log and no saved record (src/chat-store.mjs unsavedTurns), but those of `except` */
    unsaved?(project: string, except?: string[]): Promise<Array<{ turnId: string; events: TurnLog['events'] }>>;
    /** the project's files as a turn starts, kept by the app; then what the turn changed in them (src/file-changes.mjs) */
    snapshot(project: string, turnId: string): Promise<unknown>;
    changes(project: string, turnId: string): Promise<{ files: FileChange[]; cut: boolean } | null>;
  };
  /** what an agent's command asks before it spends (a video clip), and what it tells the person (a provider with no
      balance left), worded by Studio: shown above the composer until answered; the command waits for a question */
  asks: { get(): SpendAsk[]; onChange(listener: (asks: SpendAsk[]) => void): () => void; answer(id: string, allow: boolean): void };
  /** the composer's Skills button (apps/desktop/src/skills-ipc.mjs) */
  skills: {
    list(project: string, agent: string): Promise<SkillListing>;
    /** the skills a message names, as its agent reads each (its folder and its SKILL.md whole) */
    texts(project: string, agent: string, names: string[]): Promise<Array<{ name: string; text: string }>>;
    /** one of the agent's own skills let into OpenFilm, or not */
    allow(agent: string, name: string, allowed: boolean): Promise<{ ok: boolean }>;
    /** a GitHub or GitLab address fetched to be looked at; then kept (`commit`) or let go (`discard`) */
    preview(url: string): Promise<{ ok: true; id: string; skills: SkillPreview[] } | { ok: false; error: string }>;
    /** a folder on this computer looked at where it is: one dropped (its path), or null: picked in the system's dialog
        with these words (cancelled: nothing to show) */
    previewFolder(path: string | null, words?: { title: string; button: string }): Promise<{ ok: true; id: string; skills: SkillPreview[] } | { ok: false; error: string } | { ok: false; cancelled: true }>;
    commit(id: string): Promise<{ ok: true; skills: SkillInfo[] } | { ok: false; error: string }>;
    discard(id: string): Promise<unknown>;
    reveal(): Promise<unknown>;
  };
  /** Settings → Developer: `logs`, each turn shows its full log; `changes`, what it changed in the files, under its reply */
  developer: { get(): Promise<DeveloperPrefs>; onChange(listener: (prefs: DeveloperPrefs) => void): () => void };
}

export interface DeveloperPrefs { logs: boolean; changes: boolean }

/** One of OpenFilm's skills: the project's, the person's own, or official (openfilm/src/skills.mjs). */
export interface SkillInfo {
  name: string;
  description: string;
  source: 'project' | 'mine' | 'official';
  folder: string;
  /** what it brings that an agent could run */
  scripts: string[];
  /** the places with a skill of the same name it takes the place of */
  over?: Array<'project' | 'mine' | 'official'>;
  /** how people see it (its openfilm.json): title, summary and who it is for and what it does, by language */
  shown?: { title: Record<string, string>; summary: Record<string, string>; details?: Record<string, string> };
}

/** A skill fetched from an address, before it is kept: `replaces`, one of the person's has its name. */
export interface SkillPreview { name: string; description: string; scripts: string[]; size: number; replaces: boolean }

/** A skill the person installed in their agent themselves, let into OpenFilm or not. */
export interface OwnSkill { name: string; description: string; folder: string; allowed: boolean }

export interface SkillListing {
  openfilm: SkillInfo[];
  /** `filtered`: the agent's own are hidden unless let in; otherwise it has them all, as in its own terminal */
  own: { agent: string; filtered: boolean; skills: OwnSkill[] };
  /** the person's own skills folder */
  mine: string;
}

/** A question about spending, as Studio words it. */
export interface SpendAsk { id: string; title: string; body: string | null; allowLabel: string; denyLabel: string }

/** A turn's log as the app wrote it (src/chat-store.mjs): one event a line, each with its time `t` (ms). */
export interface TurnLog {
  file: string;
  /** too long to read whole: these are its last events */
  cut: boolean;
  size: number;
  callsSize?: number;
  events: Array<{ t: number; kind: string; [field: string]: unknown }>;
  /** the requests the model got and its answers, each only what is new since the one before (lib/model-calls.ts) */
  calls?: unknown[];
}

export const app = (window as unknown as { openfilmDesktop: AppBridge }).openfilmDesktop;
