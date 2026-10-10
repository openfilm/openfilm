/**
 * The parts of `window.openfilmDesktop` that are this app's own (src/preload-chat.cjs); the parts the copied chat code
 * uses (localAgents, pathForFile) are typed in lib/desktop-bridge.ts.
 */
import type { StudioRef, StudioSelection } from 'openfilm/studio-ui/lib/host.ts';

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
export interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'staging' | 'ready' | 'installing' | 'error';
  version: string;
  channel: 'stable' | 'beta';
  availableVersion: string | null;
  progress: number;
  checkedAt: number | null;
  error: string | null;
}

interface AppBridge {
  hello(): Promise<{ platform: string; flavor: string; theme: Theme; language: string; chatOpen: boolean; project: Project | null; selection: StudioSelection | null; ffmpeg: FfmpegState; update: UpdateState | null; version: string; chatMin: number }>;
  onTheme(listener: (theme: Theme) => void): () => void;
  /** Studio's language (its <html lang>) */
  onLanguage(listener: (language: string) => void): () => void;
  onProject(listener: (project: Project) => void): () => void;
  onChatOpen(listener: (open: boolean) => void): () => void;
  onStudioBrowser(listener: (state: { state: 'downloading' | 'ready' | 'failed'; message?: string }) => void): () => void;
  onStudioFailed(listener: (message: string) => void): () => void;
  onRefer(listener: (ref: StudioRef) => void): () => void;
  onFfmpeg(listener: (state: FfmpegState) => void): () => void;
  onUpdate(listener: (state: UpdateState) => void): () => void;
  /** take the person to a reference in Studio */
  showInStudio(ref: StudioRef): void;
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
  /** bring a file into the project (assets/upload/): from its path, or its bytes */
  importFile(file: { path: string; name: string } | { bytes: ArrayBuffer; name: string }): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  onSelection(listener: (selection: StudioSelection) => void): () => void;
  setChatWidth(width: number, done?: boolean): void;
  setChatOpen(open: boolean): void;
  /** install a ready update: refused (the update stays ready) while an agent works or Studio exports */
  restartToUpdate(): Promise<{ ok: boolean; error?: string }>;
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
    log(project: string, turnId: string): Promise<TurnLog | null>;
    reveal(project: string, turnId?: string): Promise<unknown>;
    /** a picture a message's reference points at, kept for its agent: .film/refs/<turn>-<n>.jpg (its path in the project) */
    saveRefImage(project: string, turnId: string, n: number, bytes: ArrayBuffer): Promise<{ path: string }>;
  };
  /** what an agent's command asks before it spends (a video clip), and what it tells the person (a provider with no
      balance left), worded by Studio: shown above the composer until answered; the command waits for a question */
  asks: { get(): SpendAsk[]; onChange(listener: (asks: SpendAsk[]) => void): () => void; answer(id: string, allow: boolean): void };
  /** Settings → Developer: on, each turn shows its full log */
  developer: { get(): Promise<boolean>; onChange(listener: (on: boolean) => void): () => void };
}

/** A question about spending, as Studio words it. */
export interface SpendAsk { id: string; title: string; body: string | null; allowLabel: string; denyLabel: string }

/** A turn's log as the app wrote it (src/chat-store.mjs): one event a line, each with its time `t` (ms). */
export interface TurnLog {
  file: string;
  /** too long to read whole: these are its last events */
  cut: boolean;
  size: number;
  events: Array<{ t: number; kind: string; [field: string]: unknown }>;
  /** the requests the model got and its answers, each only what is new since the one before (lib/model-calls.ts) */
  calls?: unknown[];
}

export const app = (window as unknown as { openfilmDesktop: AppBridge }).openfilmDesktop;
