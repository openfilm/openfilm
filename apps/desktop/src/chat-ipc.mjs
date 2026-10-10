/**
 * The page's way to the chat's record (chat-store.mjs) and to the app's own preferences:
 *
 *   desktop:chat:load      { project } → { sessions, last, turns }
 *   desktop:chat:sessions  { project, sessions, last }
 *   desktop:chat:turn      { project, turn, items }
 *   desktop:chat:log       { project, turnId } → { file, cut, size, events } | null
 *   desktop:chat:reveal    { project, turnId? }   the turn's log (or the logs folder) in the file manager
 *   desktop:chat:ref-image { project, turnId, n, bytes } → { path }   a reference's picture, kept for the agent
 *   desktop:prefs          → { developer }         and `desktop:prefs:set` { developer }; told on `desktop:prefs`
 *
 * `project` is a folder path, and only one Studio has as a project is read or written: the page cannot point the
 * app at any other folder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chatDir, loadChat, readLog, saveRefImage, saveSessions, saveTurn } from './chat-store.mjs';

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
  handle('desktop:chat:log', async ({ project: path, turnId }) => readLog(await project(path), turnId));
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
  const read = () => {
    try { const raw = JSON.parse(readFileSync(file, 'utf8')); return { developer: raw.developer === true }; } catch { return { developer: false }; }
  };
  handle('desktop:prefs', async () => read());
  handle('desktop:prefs:set', async (next) => {
    const prefs = { ...read(), ...(typeof next.developer === 'boolean' ? { developer: next.developer } : {}) };
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(prefs, null, 2)}\n`);
    tell('desktop:prefs', prefs);
    return prefs;
  });
}
