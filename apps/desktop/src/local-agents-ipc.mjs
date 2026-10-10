/**
 * The chat's IPC for its agents (the sessions themselves: agents.mjs), as the chat's lib/local-agent-run.ts talks to
 * them:
 *
 *   desktop:local-agents:list        → [{ id, label, cli: { path, source } | null, signedIn, install, setupRequired }]
 *   desktop:local-agents:sign-in     { agent } → Terminal runs its own sign-in, which opens its own page
 *   desktop:local-agents:probe       { agent } → { ok, info }: a session opened and closed, only for its options
 *                                    (model, reasoning effort), so the menu shows them before the first message
 *   desktop:local-agents:start       { agent, cwd } → { ok, key, info } | { ok: false, error, code? }
 *   desktop:local-agents:prompt      { key, text, meta?, images? } → { ok, stopReason } | { ok: false, error }
 *                                    images: [{ data (base64), mimeType }], the pictures of the message's references,
 *                                    sent after the text to an agent that takes pictures (the text names their files
 *                                    either way)
 *   desktop:local-agents:cancel      { key }
 *   desktop:local-agents:set-option  { key, configId, value }
 *   desktop:local-agents:permission  { key, requestId, optionId | null }   the page answers a permission request
 *   desktop:local-agents:answer      { key, requestId, answers | null }    the page answers its question (null: skip)
 *   desktop:local-agents:close       { key }
 *   desktop:local-agents:running     → [{ key, agent, cwd, meta, done, events }]  a reloaded page puts the turn back
 *   desktop:local-agents:ack         { key, turnId }  the page has the turn: it is forgotten here
 *
 * One channel to the page, `desktop:local-agents:event`, carrying { key, kind, … }:
 *   'update' { update }, 'permission' { requestId, params }, 'question' { requestId, message, toolCallId, questions },
 *   'exit' { code, stderr }, 'done' { turnId, ok, stopReason | error }.
 *
 * A session belongs to the page that opened it: when the page goes, its sessions close, no orphan processes. A
 * reload in the middle of a turn loses nothing: the running turn (the page's meta and every event since) is kept
 * here until the reloaded page takes it.
 *
 * Every turn is also written down as it happens, in the project's `.film/logs/<turn>.jsonl` (chat-store.mjs):
 * the prompt and the session it ran in, every event above, each answer the page gave, how it ended.
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { AgentSession, HARNESS_AGENTS, isAgentId, isChatAgent, listAgents, openAgentSignIn } from './agents.mjs';
import { openLog } from './chat-store.mjs';

const TURN_LOG_MAX = 5000;
/** the pictures one message may carry, and how big each (base64 of a JPEG at most 1280 px wide) */
const PROMPT_IMAGES_MAX = 8;
const PROMPT_IMAGE_MAX_CHARS = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** The page's pictures as ACP image blocks; anything not one is left out. */
function imageBlocks(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image) => typeof image?.data === 'string' && image.data.length > 0 && image.data.length <= PROMPT_IMAGE_MAX_CHARS && IMAGE_TYPES.has(image.mimeType))
    .slice(0, PROMPT_IMAGES_MAX)
    .map((image) => ({ type: 'image', data: image.data, mimeType: image.mimeType }));
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * `harness(id)` gives the app's own agent ('byok') what it runs with (agent-roster.mjs), resolved as
 * each session starts.
 * `onWorking` hears the folders agents are working in (a turn running there) each time they change.
 * @param {{ trusted: (event: any) => boolean, binDir?: string | null, env?: Record<string, string>,
 *           harness?: (id: string) => Promise<any>, onWorking?: (folders: string[]) => void }} opts
 */
export function registerLocalAgentIpc(ipcMain, { trusted, binDir = null, env = {}, harness = async () => null, log = () => {}, onWorking = () => {} }) {
  const harnessFor = async (agent) => (HARNESS_AGENTS.includes(agent) ? harness(agent) : undefined);
  /** @type {Map<string, { session: AgentSession, sender: import('electron').WebContents, pending: Map<string, (answer: any) => void>, agent: string, cwd: string, turn: any }>} */
  const sessions = new Map();
  let activePrompts = 0;
  /** the folders a turn is running in now: what a project cannot be deleted from under */
  const working = () => [...new Set([...sessions.values()].filter((entry) => entry.running > 0).map((entry) => entry.cwd))];
  const handle = (channel, fn) => ipcMain.handle(channel, (event, opts) => {
    if (!trusted(event)) throw new Error('not the chat');
    return fn(event, opts);
  });

  const send = (entry, key, payload) => {
    if (entry.turn && !entry.turn.done) { const { kind, ...fields } = payload; entry.turn.file.write(kind, fields); }
    const log = entry.turn?.log;
    if (log && !entry.turn.done) {
      log.push(payload);
      /* a very long turn: keep the questions and permission requests, let the oldest updates go */
      if (log.length > TURN_LOG_MAX) {
        const i = log.findIndex((e) => e.kind === 'update');
        if (i >= 0) log.splice(i, 1);
      }
    }
    if (!entry.sender.isDestroyed()) entry.sender.send('desktop:local-agents:event', { key, ...payload });
  };
  const close = (key) => {
    const entry = sessions.get(key);
    if (!entry) return;
    for (const answer of entry.pending.values()) answer(null);
    entry.session.close();
    sessions.delete(key);
    if (entry.running > 0) onWorking(working());
  };

  handle('desktop:local-agents:list', () => listAgents());

  handle('desktop:local-agents:sign-in', (_event, opts) => {
    const agent = opts?.agent;
    if (!isAgentId(agent)) return { ok: false, error: `Unknown agent: ${String(agent)}` };
    return openAgentSignIn(agent);
  });

  /* disconnected in the app: its sessions here close; its own sign-in is not the app's to end */
  handle('desktop:local-agents:disconnect', (_event, opts) => {
    const agent = opts?.agent;
    if (!isAgentId(agent)) return { ok: false };
    for (const [key, entry] of [...sessions]) if (entry.agent === agent) close(key);
    return { ok: true };
  });

  handle('desktop:local-agents:probe', async (_event, opts) => {
    const agent = opts?.agent;
    if (!isChatAgent(agent)) return { ok: false, error: `Unknown agent: ${String(agent)}` };
    let session;
    try {
      session = new AgentSession({ agent, cwd: homedir(), binDir, env, harness: await harnessFor(agent) });
      return { ok: true, info: await session.start() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ...(e?.code ? { code: String(e.code) } : {}) };
    } finally {
      session?.close();
    }
  });

  handle('desktop:local-agents:start', async (event, opts) => {
    const agent = opts?.agent;
    const cwd = opts?.cwd;
    if (!isChatAgent(agent)) return { ok: false, error: `Unknown agent: ${String(agent)}` };
    if (typeof cwd !== 'string' || !cwd) return { ok: false, error: 'Missing project folder.' };
    const key = randomUUID();
    const pending = new Map();
    const entry = { sender: event.sender, pending, session: null, agent, cwd, turn: null };
    try {
      entry.session = new AgentSession({
        agent,
        cwd,
        binDir,
        env,
        harness: await harnessFor(agent),
        onUpdate: (update) => send(entry, key, { kind: 'update', update }),
        onPermission: (params) => new Promise((resolve) => {
          const requestId = randomUUID();
          pending.set(requestId, (optionId) => { pending.delete(requestId); resolve(optionId); });
          send(entry, key, { kind: 'permission', requestId, params });
        }),
        onQuestion: (ask) => new Promise((resolve) => {
          const requestId = randomUUID();
          pending.set(requestId, (answers) => { pending.delete(requestId); resolve(answers); });
          send(entry, key, { kind: 'question', requestId, ...ask });
        }),
        onExit: (info) => { send(entry, key, { kind: 'exit', ...info }); sessions.delete(key); if (entry.running > 0) onWorking(working()); },
      });
      sessions.set(key, entry);
      event.sender.once('destroyed', () => close(key));
      const info = await entry.session.start();
      entry.info = info;
      return { ok: true, key, info: { ...info, authMethods: [], mcp: false } };
    } catch (e) {
      close(key);
      return { ok: false, error: e instanceof Error ? e.message : String(e), ...(e?.code ? { code: String(e.code) } : {}) };
    }
  });

  handle('desktop:local-agents:prompt', async (_event, opts) => {
    const key = opts?.key;
    const entry = sessions.get(key);
    if (!entry) return { ok: false, error: 'This session has ended.' };
    const meta = opts?.meta && typeof opts.meta === 'object' ? opts.meta : null;
    const file = meta ? openLog(entry.cwd, meta.turnId, (e) => log(`turn log ${meta.turnId}: ${e.message}\n`)) : null;
    const turn = meta ? { meta, log: [], done: null, file } : null;
    const text = String(opts?.text ?? '');
    /* an agent that takes no pictures is given none: the text names each one's file, which it can open itself */
    const images = entry.info?.promptCapabilities?.image ? imageBlocks(opts?.images) : [];
    if (turn) {
      entry.turn = turn;
      file.write('prompt', { agent: entry.agent, cwd: entry.cwd, session: entry.info ?? null, meta, text, images: images.length });
    }
    activePrompts++;
    entry.running = (entry.running ?? 0) + 1;
    onWorking(working());
    let result;
    try {
      result = { ok: true, stopReason: await entry.session.prompt([{ type: 'text', text }, ...images], { turnId: meta?.turnId }) };
    } catch (e) {
      /* `balance`: the service the app's own agent runs on has no balance left (agents.mjs), and where to top it up */
      result = { ok: false, error: e instanceof Error ? e.message : String(e), ...(e?.balance ? { balance: e.balance } : {}) };
    } finally {
      activePrompts--;
      entry.running -= 1;
      onWorking(working());
    }
    if (turn) {
      /* a turn that failed: what the agent's process last wrote to stderr says why */
      turn.file.write('done', result.ok ? result : { ...result, stderr: String(entry.session?.stderr ?? '').slice(-8000) });
      turn.file.end();
      turn.done = result;
      /* the page that asked may be gone (reloaded): say it on the channel too */
      if (!entry.sender.isDestroyed()) entry.sender.send('desktop:local-agents:event', { key, kind: 'done', turnId: meta.turnId, ...result });
    }
    return result;
  });

  /* the turns a (reloaded) page should put back: still running, or finished and not yet taken */
  handle('desktop:local-agents:running', () => [...sessions]
    .filter(([, entry]) => entry.turn)
    .map(([key, entry]) => ({ key, agent: entry.agent, cwd: entry.cwd, meta: entry.turn.meta, done: entry.turn.done, events: entry.turn.log })));

  handle('desktop:local-agents:ack', (_event, opts) => {
    const entry = sessions.get(opts?.key);
    if (entry?.turn && entry.turn.done && entry.turn.meta?.turnId === opts?.turnId) entry.turn = null;
    return { ok: true };
  });

  /* what the page answered goes in the turn's log beside what was asked */
  const noted = (opts, kind, fields) => {
    const turn = sessions.get(opts?.key)?.turn;
    if (turn && !turn.done) turn.file.write(kind, fields);
  };

  handle('desktop:local-agents:cancel', async (_event, opts) => {
    noted(opts, 'cancel', {});
    await sessions.get(opts?.key)?.session.cancel();
    return { ok: true };
  });

  handle('desktop:local-agents:set-option', async (_event, opts) => {
    noted(opts, 'set-option', { configId: opts?.configId, value: opts?.value });
    const entry = sessions.get(opts?.key);
    if (!entry) return { ok: false, error: 'This session has ended.' };
    try {
      return { ok: true, result: await entry.session.setConfigOption(String(opts.configId), opts.value) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  handle('desktop:local-agents:permission', (_event, opts) => {
    noted(opts, 'permission-answer', { requestId: opts?.requestId, optionId: opts?.optionId ?? null });
    const answer = sessions.get(opts?.key)?.pending.get(opts?.requestId);
    answer?.(typeof opts?.optionId === 'string' ? opts.optionId : null);
    return { ok: Boolean(answer) };
  });

  handle('desktop:local-agents:answer', (_event, opts) => {
    noted(opts, 'question-answer', { requestId: opts?.requestId, answers: opts?.answers ?? null });
    const answer = sessions.get(opts?.key)?.pending.get(opts?.requestId);
    answer?.(opts?.answers && typeof opts.answers === 'object' ? opts.answers : null);
    return { ok: Boolean(answer) };
  });

  handle('desktop:local-agents:close', (_event, opts) => {
    close(opts?.key);
    return { ok: true };
  });

  return {
    isBusy: () => activePrompts > 0,
    working,
    closeAll: () => [...sessions.keys()].forEach(close),
    /** an agent disconnected in Settings: its sessions close */
    closeAgent: (agent) => { for (const [key, entry] of [...sessions]) if (entry.agent === agent) close(key); },
  };
}
