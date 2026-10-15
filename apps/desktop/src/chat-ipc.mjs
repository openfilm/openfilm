/**
 * The page's way to the chat's record (chat-store.mjs) and to the app's own preferences:
 *
 *   desktop:chat:load      { project } → { sessions, last, turns }
 *   desktop:chat:sessions  { project, sessions, last }
 *   desktop:chat:turn      { project, turn, items }
 *   desktop:chat:log       { project, turnId, unless? } → { file, cut, size, callsSize, events, calls } | { same } | null
 *                          a turn of another agent with no model log yet (running, or from before there was one) has
 *                          its requests read from the agent's own record (or log) as it is now (agent-records.mjs)
 *   desktop:chat:reveal    { project, turnId? }   the turn's log (or the logs folder) in the file manager
 *   desktop:chat:ref-image { project, turnId, n, bytes } → { path }   a reference's picture, kept for the agent
 *   desktop:chat:unsaved   { project, except? } → [{ turnId, events }]   turns with a log and no saved record
 *   desktop:chat:snapshot  { project, turnId }     the project's files as a turn starts (file-changes.mjs), kept here
 *   desktop:chat:changes   { project, turnId } → { files, cut } | null   what the turn changed in them since
 *   desktop:prefs          → { developer, changes } and `desktop:prefs:set` either; told on `desktop:prefs`
 *
 * `project` is a folder path, and only one Studio has as a project is read or written: the page cannot point the
 * app at any other folder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RECORDED_AGENTS, agentRecordCalls, compactCalls } from './agent-records.mjs';
import { chatDir, loadChat, readLog, saveRefImage, saveSessions, saveTurn, unsavedTurns } from './chat-store.mjs';
import { loginShellVariables } from './environment.mjs';
import { changes, snapshot } from './file-changes.mjs';

/** a turn's requests are those its agent's record has from a moment before it began to a moment after it ended */
const RECORD_MARGIN_MS = 1000;

/**
 * A log with no model requests, of a turn of an agent whose record (or log, `opened.log`) is read: its requests from
 * there, read now. The log as it was when there is none to read.
 */
export async function withAgentRecord(found) {
  if (!found || 'same' in found || found.calls?.length) return found;
  const prompt = found.events.find((e) => e.kind === 'prompt');
  const done = [...found.events].reverse().find((e) => e.kind === 'done');
  const sessionId = prompt?.session?.sessionId;
  if (!RECORDED_AGENTS.includes(prompt?.agent) || !sessionId) return found;
  const read = agentRecordCalls({
    agent: prompt.agent, sessionId, cwd: prompt.cwd, env: await loginShellVariables({ staleOk: true }), log: prompt.opened?.log ?? null,
    from: prompt.t - RECORD_MARGIN_MS, to: done ? done.t + RECORD_MARGIN_MS : Date.now() + RECORD_MARGIN_MS,
  });
  return read?.calls.length ? { ...found, calls: compactCalls(read.calls) } : found;
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
 *           reveal: (path: string) => void, tell: (channel: string, value: unknown) => void, log: (line: string) => void }} opts
 */
export function registerChatIpc(ipcMain, { trusted, projects, dataDir, reveal, tell, log }) {
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
  handle('desktop:chat:unsaved', async ({ project: path, except }) => unsavedTurns(await project(path), {
    except: Array.isArray(except) ? except.filter((id) => typeof id === 'string') : [],
  }));
  handle('desktop:chat:log', async ({ project: path, turnId, unless }) => withAgentRecord(readLog(await project(path), turnId, {
    unless: unless && Number.isFinite(unless.size) && Number.isFinite(unless.callsSize) ? unless : null,
  })));
  /* the files as each running turn found them, by the turn: compared, and let go, when the turn settles */
  const snapshots = new Map();
  handle('desktop:chat:snapshot', async ({ project: path, turnId }) => {
    const dir = await project(path);
    const taken = await snapshot(dir);
    snapshots.delete(turnId);
    snapshots.set(turnId, { dir, taken });
    while (snapshots.size > SNAPSHOTS_MAX) snapshots.delete(snapshots.keys().next().value);
    return { ok: true };
  });
  handle('desktop:chat:changes', async ({ project: path, turnId }) => {
    const dir = await project(path);
    const kept = snapshots.get(turnId);
    snapshots.delete(turnId);
    return kept && kept.dir === dir ? changes(dir, kept.taken) : null;
  });
  handle('desktop:chat:reveal', async ({ project: path, turnId }) => {
    const dir = await project(path);
    const found = typeof turnId === 'string' ? readLog(dir, turnId) : null;
    const logs = join(chatDir(dir), 'logs');
    mkdirSync(logs, { recursive: true });
    reveal(found?.file ?? logs);
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
