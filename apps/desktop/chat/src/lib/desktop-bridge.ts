/**
 * The desktop shell's bridge. In the OpenFilm app (Electron) the window's page puts it on
 * `window.openfilmDesktop`; in a plain browser there is no such object.
 *
 * It holds only what a web page cannot do by itself, such as a system folder picker or showing a path
 * in Finder.
 *
 * The shape matches apps/desktop/shell/bridge.ts; change one, change the other.
 */
import type { Balance } from './balance';

/** The coding agents the shell can connect to its MCP endpoint. */
export type DesktopAgentId = 'claude' | 'codex' | 'cursor' | 'copilot' | 'gemini' | 'opencode' | 'codebuddy' | 'devin';

/** The chat's agents: the person's own (Codex, Claude Code, Gemini CLI, …), and the app's own on their own key. */
export type LocalAgentId = 'claude' | 'codex' | 'gemini' | 'copilot' | 'cursor' | 'opencode' | 'codebuddy' | 'qwen' | 'kimi' | 'byok';

/** One agent as the app's roster has it (apps/desktop/src/agent-roster.mjs; Studio's lib/host.ts HostAgent). */
export interface RosterAgent {
  id: LocalAgentId;
  name: string;
  shown: boolean;
  status: 'ready' | 'off' | 'sign-in' | 'waiting' | 'missing' | 'key' | 'checking';
  install?: string | null;
  setupRequired?: string | null;
  error?: string;
  byok?: { format: 'responses' | 'chat' | 'anthropic'; baseUrl: string; model: string; last4: string };
}

export interface LocalAgentState {
  setupRequired?: 'code-tab' | null;
  id: LocalAgentId;
  label: string;
  /** The executable it uses: the user's own install, or in development the official one among the adapter's dependencies. null = not installed. */
  cli: { path: string; source: 'installed' | 'bundled' } | null;
  /** Its own reported sign-in state; null when it cannot be asked. */
  signedIn: boolean | null;
  /** The official install page. When it is missing the UI points there; the app does not install it for the user. */
  install: string;
}

export interface LocalAgentSessionInfo {
  sessionId: string;
  agentInfo: { name: string; title?: string; version?: string } | null;
  authMethods: Array<{ id: string; name: string; description?: string }>;
  /** Whether our MCP tools were handed over (not when the agent does not take HTTP). */
  mcp: boolean;
  models: { availableModels: Array<{ modelId: string; name: string; description?: string }>; currentModelId: string } | null;
  modes: { availableModes: Array<{ id: string; name: string; description?: string }>; currentModeId: string } | null;
  configOptions: Array<{ id: string; name: string; description?: string; category?: string; type?: string; currentValue?: unknown; options?: Array<{ value: unknown; name: string; description?: string }> }> | null;
}

/** session/update as is (ACP's SessionUpdate); the UI picks what to draw by `sessionUpdate`. */
export type LocalAgentEvent =
  | { key: string; kind: 'update'; update: { sessionUpdate: string } & Record<string, unknown> }
  | { key: string; kind: 'permission'; requestId: string; params: { toolCall?: { title?: string }; options: Array<{ optionId: string; name: string; kind: string }> } }
  | { key: string; kind: 'question'; requestId: string; message: string; toolCallId: string | null; questions: LocalAgentQuestion[] }
  | { key: string; kind: 'exit'; code: number | null; stderr: string }
  /* the turn settled — also said on the channel, for a page that was reloaded while it ran */
  | { key: string; kind: 'done'; turnId: string; ok: boolean; stopReason?: string; error?: string; balance?: Balance };

/** A picture given to the agent with a message: base64 bytes and their type (an ACP image block). */
export interface PromptImage { data: string; mimeType: string }

/** What the page hands the shell with a prompt, so a reloaded page can put the running turn back. */
export interface LocalAgentTurnMeta {
  turnId: string;
  projectId: string;
  projectTitle: string;
  sessionId: string;
  agent: LocalAgentId;
  /** the user's words (without the attachment note) */
  prompt: string;
  turnNo: number;
  startedAt: number;
  /** the chat row as it was sent (a Turn) */
  turn: unknown;
}

/** A turn the shell still holds: running, or finished and not yet taken by a page. */
export interface LocalAgentRunningTurn {
  key: string;
  agent: LocalAgentId;
  cwd: string;
  meta: LocalAgentTurnMeta;
  done: { ok: true; stopReason: string } | { ok: false; error: string; balance?: Balance } | null;
  events: Array<Record<string, unknown> & { kind: string }>;
}

/** A question a local agent asks the user (read by the shell from the ACP form, see formQuestions in apps/desktop/src/agents.mjs). */
export interface LocalAgentQuestion {
  id: string;
  question: string;
  header: string | null;
  options: Array<{ label: string; description?: string }>;
  /** The free-text field; null = options only (except for text-only questions). */
  customId: string | null;
  multi: boolean;
}

/** An answer: the option picked, or the text written. */
export type LocalAgentAnswer = { label: string } | { text: string };

export interface DesktopBridge {
  /** The shell's version, to spot an old shell when debugging. */
  version: string;
  /** IPC contract version; separate from the installed application's version. */
  bridgeVersion?: string;
  /** darwin / win32 / linux. */
  platform: string;
  /** Opens the system folder picker. null if the user cancels. */
  chooseFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null>;
  /** Shows this path in the system file manager. */
  revealPath(path: string): Promise<void>;
  /**
   * The system "Save As" dialog (where a local export goes). null if the user cancels.
   * `defaultPath` defaults to the `exportsRoot()` folder.
   */
  saveDialog?(opts: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
  /** Where exports go by default: `~/Movies/OpenFilm/Exports` (created by the shell). null when unavailable. */
  exportsRoot?(): Promise<string | null>;
  /** Opens a file or folder with its default app. An empty string on success, else the reason. */
  openPath?(path: string): Promise<string>;
  /**
   * The folder made for a new project in the library (already created, ready to use).
   *
   * The shell makes it rather than asking: when the person presses New they do not yet know what the
   * film will become, and should not be asked where to put it. The library root is fixed under the
   * system Movies folder.
   */
  newProjectDir?(title: string): Promise<{ ok: true; dir: string } | { ok: false; error: string }>;
  /** Where local projects are stored, shown in Settings. null on an old shell or when unavailable. */
  libraryRoot?(): Promise<string | null>;
  /** The menu's File → Open Folder… was clicked. Returns an unsubscribe function. */
  onOpenLocalFolder?(cb: () => void): () => void;
  onMenuAction?(cb: (action: 'settings') => void): () => void;
  /**
   * The absolute path on disk of a browser File (dragged in, or chosen with `<input type=file>`).
   * A pasted file has no path and gives an empty string; then its bytes can only be uploaded.
   */
  pathForFile(file: File): string;
  /**
   * Connects a local coding agent (see DesktopAgentId) to the app's MCP endpoint: the shell edits the
   * agent's own config file. On success, a sentence saying what to do next; on failure, the reason.
   */
  connectAgent?(agent: DesktopAgentId): Promise<
    | { ok: true; how: string; next: string }
    /* `code` is 'not-installed' / 'not-ready': the UI words those in its own language; otherwise it shows `error` as is. */
    | { ok: false; error: string; code?: string; install?: string }
  >;
  /**
   * Disconnects: removes our entry from its config.
   *
   * There is no "reconnect": the only case it would fix is a changed address, which disconnecting and
   * connecting again handles, without one more button to explain. So there are two states: connected or not.
   */
  disconnectAgent?(agent: DesktopAgentId): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * `localAgents`: the user's own Claude Code / Codex in the chat panel (ACP, see
   * apps/desktop/src/local-agents-ipc.mjs). The thinking runs on the user's own subscription; the doing
   * is our MCP tools. Events come from `onEvent`.
   */
  /** The roster: the agents there are, connected or not, shown in the chat's menu or not. */
  agents?: {
    list(): Promise<RosterAgent[]>;
    connect(id: LocalAgentId): Promise<{ ok: boolean; error?: string }>;
    onChange(listener: (agents: RosterAgent[]) => void): () => void;
  };
  /** Studio's Settings, on Agents (or Providers). */
  openSettings?(section?: 'agents' | 'providers'): void;
  /** Studio's language, whenever it changes (its <html lang>). */
  onLanguage?(listener: (language: string) => void): () => void;
  localAgents?: {
    list(): Promise<LocalAgentState[]>;
    /** Close OpenFilm's open sessions with it (its own login is left alone). Older shells lack it. */
    disconnect?(agent: LocalAgentId): Promise<{ ok: boolean }>;
    /** Opens Terminal to run its own sign-in command, which opens Anthropic's / OpenAI's sign-in page. */
    signIn(agent: LocalAgentId): Promise<{ ok: true } | { ok: false; error: string }>;
    /** Opens a session and closes it at once, only for its options. Sends no message, so costs nothing. */
    probe(agent: LocalAgentId): Promise<{ ok: true; info: LocalAgentSessionInfo } | { ok: false; error: string; code?: string }>;
    start(agent: LocalAgentId, cwd: string): Promise<
      | { ok: true; key: string; info: LocalAgentSessionInfo }
      | { ok: false; error: string; code?: string; install?: string }
    >;
    /** `images`: pictures sent after the text, to an agent that takes them (the shell asks the session) */
    /** `balance`: the service the app's own agent runs on had no balance left for it */
    prompt(key: string, text: string, meta?: LocalAgentTurnMeta, images?: PromptImage[]): Promise<{ ok: true; stopReason: string } | { ok: false; error: string; balance?: Balance }>;
    /** Turns still held by the shell (a reload mid-turn). Older shells lack it. */
    running?(): Promise<LocalAgentRunningTurn[]>;
    /** The page has put this finished turn back: the shell forgets it. */
    ack?(key: string, turnId: string): Promise<{ ok: true }>;
    cancel(key: string): Promise<{ ok: true }>;
    setOption(key: string, configId: string, value: unknown): Promise<{ ok: boolean; error?: string }>;
    answerPermission(key: string, requestId: string, optionId: string | null): Promise<{ ok: boolean }>;
    /** Answers its question; null = skip. Older shells lack it (and never ask). */
    answerQuestion?(key: string, requestId: string, answers: Record<string, LocalAgentAnswer> | null): Promise<{ ok: boolean }>;
    close(key: string): Promise<{ ok: true }>;
    onEvent(cb: (event: LocalAgentEvent) => void): () => void;
  };
  /** System notifications, the Dock badge, and coming back from a notification. */
  tasks?: {
    notify(payload: { title: string; body?: string; href?: string }): Promise<{ ok: boolean }>;
    setBadge(count: number): void;
    onNavigate(cb: (href: string) => void): () => void;
  };
  /** OpenFilm Studio only: the page runs in a plain browser */
  studio?: boolean;
  /**
   * The agents' status: the MCP endpoint's half (who is connected, who is remembered) plus each agent's
   * config file (who was connected). When the endpoint is not running the first half is empty;
   * `configured` still holds, since it reads files on disk.
   */
  agentStatus?(): Promise<DesktopAgentStatus | null>;
}

export interface DesktopAgentStatus {
  /** Executable/app detection; leftover configuration is not installation evidence. */
  installed?: Partial<Record<DesktopAgentId, boolean>>;
  url: string;
  /** Whether the MCP endpoint is open (off by default; Connect opens it). */
  enabled?: boolean;
  sessions: Array<{
    id: string;
    clientName: string;
    clientVersion: string;
    createdAt: number;
    lastSeenAt: number;
    /** How it got in: the shell's pairing secret / approved in a dialog / test pass-through. */
    paired?: 'secret' | 'dialog' | 'auto';
    projectId?: string;
  }>;
  trusted: Array<{ name: string; approvedAt: number; expiresAt: number; secret?: true }>;
  audit: string;
  /**
   * The openfilm address each agent's config holds now; null if never connected.
   *
   * Not the same as `sessions`: connected only means the config is written; the agent connects on its
   * next start. The UI tells three states from the two: never connected / connected (waiting for the
   * agent) / live. An address that differs from `url` means the port changed: that entry is broken and
   * must be connected again.
   */
  configured?: Partial<Record<DesktopAgentId, string | null>>;
}

declare global {
  interface Window {
    openfilmDesktop?: DesktopBridge;
  }
}

/**
 * For a file with no path in a local project (a pasted image): the size up to which its bytes go in one
 * request; larger ones are streamed in parts. Not an upload limit. Files with a path (dragged from
 * Finder) are copied by path.
 */
export const LOCAL_PUT_MAX_BYTES = 15 * 1024 * 1024;

/** Whether this runs in the desktop shell. Always false during SSR. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.openfilmDesktop;
}

export function desktopBridge(): DesktopBridge | null {
  return typeof window !== 'undefined' ? window.openfilmDesktop ?? null : null;
}
