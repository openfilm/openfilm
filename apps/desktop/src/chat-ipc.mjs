/**
 * The page's way to the chat's record (chat-store.mjs) and to the app's own preferences:
 *
 *   desktop:chat:load      { project } → { sessions, last, turns }
 *   desktop:chat:sessions  { project, sessions, last }
 *   desktop:chat:turn      { project, turn, items }
 *   desktop:chat:log       { project, turnId, since? } → { file, cut, whole, events, calls, callsWhole, callsCut, at }
 *                          | { same } | null   (chat-store.mjs readLog): `since`, an earlier read's `at`, only what is
 *                          new; a turn of another agent with no model log yet (running, or from before there was one)
 *                          has its requests read from the agent's own record (or log) as it is now (agent-records.mjs)
 *   desktop:chat:reveal    { project, turnId? }   the turn's log (or the logs folder) in the file manager
 *   desktop:chat:ref-image { project, turnId, n, bytes } → { path }   a reference's picture, kept for the agent
 *   desktop:chat:attachment { project, name, bytes } → { path }   a file pasted into a message, kept for the agent
 *   desktop:chat:paths     { paths } → [{ path, folder, size? } | { path, error }]   files and folders dragged in
 *   desktop:chat:unsaved   { project, except? } → [{ turnId, events }]   turns with a log and no saved record
 *   desktop:chat:snapshot  { project, turnId }     the project's files as a turn starts (file-changes.mjs), kept here
 *   desktop:chat:changes   { project, turnId } → { files, cut, undoable? } | null   what the turn changed in them
 *                          since; `undoable`: the snapshot is kept, for the turn to be undone
 *   desktop:chat:undo      { project, turnId } → { ok, restored, missed } | { ok: false, code: 'gone' }   the files put
 *                          back as that turn found them (file-changes.mjs undoTurn), what was added since to the trash
 *   desktop:prefs          → { developer, changes } and `desktop:prefs:set` either; told on `desktop:prefs`
 *
 * `project` is a folder path, and only one Studio has as a project is read or written: the page cannot point the
 * app at any other folder.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RECORDED_AGENTS, agentRecordCalls, compactCalls } from './agent-records.mjs';
import { chatDir, describePaths, loadChat, logFile, logPrompt, readLog, saveAttachment, saveRefImage, saveSessions, saveTurn, unsavedTurns, withoutPictures } from './chat-store.mjs';
import { loginShellVariables } from './environment.mjs';
import { changes, dropHold, holdDir, snapshot, undoTurn } from './file-changes.mjs';

/** a turn's requests are those its agent's record has from a moment before it began to a moment after it ended */
const RECORD_MARGIN_MS = 1000;

/**
 * A log with no model requests, of a turn of an agent whose record (or log, `opened.log`) is read: its requests from
 * there, read now, whole (`callsWhole`) and without their pictures' bytes. The log as it was when there is none to
 * read. `prompt`: the turn's first event, when the read was only what is new (it does not have it).
 */
export async function withAgentRecord(found, prompt = null) {
  if (!found || 'same' in found || found.at.calls > 0) return found;
  const first = prompt ?? found.events.find((e) => e.kind === 'prompt');
  const done = [...found.events].reverse().find((e) => e.kind === 'done');
  const sessionId = first?.session?.sessionId;
  if (!RECORDED_AGENTS.includes(first?.agent) || !sessionId) return found;
  const read = agentRecordCalls({
    agent: first.agent, sessionId, cwd: first.cwd, env: await loginShellVariables({ staleOk: true }), log: first.opened?.log ?? null,
    from: first.t - RECORD_MARGIN_MS, to: done ? done.t + RECORD_MARGIN_MS : Date.now() + RECORD_MARGIN_MS,
  });
  return read?.calls.length ? { ...found, calls: withoutPictures(compactCalls(read.calls)), callsWhole: true } : found;
}

/**
 * The app's own preferences (`<dataDir>/preferences.json`): `developer`, each turn's log shown, and agents started with
 * their logging switches (off unless turned on); `changes`, what each turn changed, under its reply (on).
 */
export function readPreferences(dataDir) {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, 'preferences.json'), 'utf8'));
    return { developer: raw.developer === true, changes: raw.changes !== false };
  } catch { return { developer: false, changes: true }; }
}

/** how many turns' snapshots are kept at once: one per running turn, and a few whose end was never asked about */
const SNAPSHOTS_MAX = 8;

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ trusted: (event: any) => boolean, projects: () => Promise<string[]>, dataDir: string,
 *           reveal: (path: string) => void, tell: (channel: string, value: unknown) => void, log: (line: string) => void,
 *           filmPutBack: (dir: string, done?: boolean) => Promise<unknown> }} opts
 */
export function registerChatIpc(ipcMain, { trusted, projects, dataDir, reveal, trash, tell, log, filmPutBack }) {
  /* the projects Studio has, asked again when a path is not among them (a project opened a moment ago) */
  let known = new Set();
  const project = async (path) => {
    if (typeof path !== 'string' || !path) throw new Error('which project?');
    const want = resolve(path);
    if (!known.has(want)) known = new Set((await projects()).map((p) => resolve(p)));
    if (!known.has(want)) throw new Error('not a project of Studio\'s');
    return want;
  };
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, opts) => {
    if (!trusted(event)) throw new Error('not the window\'s page');
    try { return await fn(opts ?? {}); } catch (e) { log(`${channel}: ${e.message}\n`); throw e; }
  });

  handle('desktop:chat:load', async ({ project: path }) => loadChat(await project(path)));
  handle('desktop:chat:sessions', async ({ project: path, sessions, last }) => { saveSessions(await project(path), { sessions, last }); return { ok: true }; });
  handle('desktop:chat:turn', async ({ project: path, turn, items }) => { saveTurn(await project(path), { turn, items }); return { ok: true }; });
  handle('desktop:chat:ref-image', async ({ project: path, turnId, n, bytes }) => saveRefImage(await project(path), turnId, n, bytes));
  handle('desktop:chat:attachment', async ({ project: path, name, bytes }) => saveAttachment(await project(path), name, bytes));
  handle('desktop:chat:paths', async ({ paths }) => describePaths(paths));
  handle('desktop:chat:unsaved', async ({ project: path, except }) => unsavedTurns(await project(path), {
    except: Array.isArray(except) ? except.filter((id) => typeof id === 'string') : [],
  }));
  handle('desktop:chat:log', async ({ project: path, turnId, since }) => {
    const dir = await project(path);
    const at = since && ['events', 'calls', 'callsFile'].every((key) => Number.isFinite(since[key])) ? since : null;
    const found = readLog(dir, turnId, { since: at });
    /* only what is new has no prompt: the agent's record is found from the log's first line */
    return withAgentRecord(found, found && !('same' in found) && !found.whole ? logPrompt(dir, turnId) : null);
  });
  /* the files as each running turn found them, by the turn: compared when the turn settles; with each, its links to
     the files it found (file-changes.mjs hold) */
  const snapshots = new Map();
  /** the files as the turns that changed some found them, by the turn: the latest few, kept to undo each */
  const undoable = new Map();
  const forget = (/** @type {Map<string, { hold: string | null }>} */ kept, /** @type {string} */ turnId) => {
    void dropHold(kept.get(turnId)?.hold ?? null);
    kept.delete(turnId);
  };
  handle('desktop:chat:snapshot', async ({ project: path, turnId }) => {
    const dir = await project(path);
    const hold = holdDir(dir, turnId);
    /* links left from before (the app closed on a turn) are no use now: only the turns this launch knows keep theirs */
    const turnFiles = join(dir, '.film', 'cache', 'turn-files');
    const known = new Set([...snapshots.values(), ...undoable.values()].map((k) => k.hold));
    let left = [];
    try { left = readdirSync(turnFiles); } catch { /* none */ }
    await Promise.all(left.map((name) => join(turnFiles, name)).filter((p) => !known.has(p)).map(dropHold));
    const taken = await snapshot(dir, { hold, canvas: true });
    forget(snapshots, turnId);
    snapshots.set(turnId, { dir, taken, hold });
    while (snapshots.size > SNAPSHOTS_MAX) forget(snapshots, snapshots.keys().next().value);
    return { ok: true };
  });
  handle('desktop:chat:changes', async ({ project: path, turnId }) => {
    const dir = await project(path);
    const kept = snapshots.get(turnId);
    snapshots.delete(turnId);
    if (!kept || kept.dir !== dir) { void dropHold(kept?.hold ?? null); return null; }
    const found = await changes(dir, kept.taken);
    /* a folder too large to read whole is never undone: what lies past the reading would look added */
    if (!found.files.length || found.cut) { void dropHold(kept.hold); return found; }
    forget(undoable, turnId);
    undoable.set(turnId, kept);
    while (undoable.size > SNAPSHOTS_MAX) forget(undoable, undoable.keys().next().value);
    return { ...found, undoable: true };
  });
  handle('desktop:chat:undo', async ({ project: path, turnId }) => {
    const dir = await project(path);
    const kept = undoable.get(turnId);
    if (!kept || kept.dir !== dir) return { ok: false, code: 'gone' };
    /* Studio told first: else it takes the film put back for a write of the agent's, and merges the turn's clips into it */
    await filmPutBack(dir).catch((e) => log(`undo: Studio was not told the film goes back: ${e.message}`));
    const done = await undoTurn(dir, kept.taken, kept.hold, { trash });
    /* The canvas files are outside the filesystem watcher: reload their restored state and forget undo steps
       whose media may have just gone to the trash with the turn. */
    await filmPutBack(dir, true).catch((e) => log(`undo: Studio was not told the canvas went back: ${e.message}`));
    forget(undoable, turnId);
    return { ok: true, ...done };
  });
  handle('desktop:chat:reveal', async ({ project: path, turnId }) => {
    const dir = await project(path);
    const file = logFile(dir, turnId);
    const logs = join(chatDir(dir), 'logs');
    mkdirSync(logs, { recursive: true });
    reveal(file && existsSync(file) ? file : logs);
    return { ok: true };
  });

  /* the app's own preferences: kept by the app, not by the page (whose storage is its address's) */
  const file = join(dataDir, 'preferences.json');
  const read = () => readPreferences(dataDir);
  handle('desktop:prefs', async () => read());
  handle('desktop:prefs:set', async (next) => {
    const prefs = { ...read() };
    for (const key of ['developer', 'changes']) if (typeof next[key] === 'boolean') prefs[key] = next[key];
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(prefs, null, 2)}\n`);
    tell('desktop:prefs', prefs);
    return prefs;
  });
}
