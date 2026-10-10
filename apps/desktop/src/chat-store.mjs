/**
 * The chat's record of a project, kept in the project's own folder, so it goes where the project goes and is there
 * whatever the window's address. Two parts, each its own folder (a project's export takes or leaves each one):
 *
 * the conversations, `.film/chat/`:
 *   sessions.json          the conversations (the session bar's list) and the one shown last
 *   turns/<turn>.json      each finished turn: what was asked and how it ended, and what the chat shows of it
 *   agent/                 the app's own agent's sessions (pi-agent.mjs), so a conversation goes on where it stopped
 *
 * the debug logs, `.film/logs/`:
 *   <turn>.jsonl           each turn as it happened, one event a line, untouched: the prompt and its settings, every
 *                          update the agent sent (what it said and thought, each tool call with its input and output),
 *                          every question and permission and the answer, how it ended; for whoever needs every detail
 *   <turn>.model.jsonl     each request the app's own agent made to its model in that turn (pi-agent.mjs): the
 *                          whole context, as Pi sends it, and the answer. A request carries the whole conversation, so a
 *                          line keeps only what is new: `prefix`, how many of the last request's messages come first,
 *                          then its own; `systemPrompt` and `tools` only when they changed
 *
 * the pictures a message's references point at, `.film/refs/`:
 *   <turn>-<n>.jpg         the picture of the message's reference [n] (a frame, or the part of it pointed at), for its
 *                          agent to look at: the message names the path
 *
 * `.film/` is Studio's own (its projects.mjs says what else is there): a film never reads it, and nothing in it is
 * served. Reads no Electron module, so `node --test` can use it.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** a turn's id (`local:…`) and the file it names (no `:`, which Windows does not allow in a name) */
const ID = /^[\w:-]{1,120}$/;
const fileOf = (id) => id.replace(/:/g, '-');
/** a log longer than this is read from its end: the last of a very long turn is what explains how it ended */
const LOG_READ_MAX = 32 * 1024 * 1024;

export const chatDir = (project) => join(project, '.film', 'chat');
export const logsDir = (project) => join(project, '.film', 'logs');
export const refsDir = (project) => join(project, '.film', 'refs');
/** a reference's picture: a JPEG, of a frame at most 1280 px wide (the page makes it so) */
const REF_IMAGE_MAX = 8 * 1024 * 1024;
const REF_MAX = 64;
/** where the app's own agent keeps its sessions of conversations in this project */
export const agentSessionsDir = (project) => join(chatDir(project), 'agent');

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** The project's conversations and finished turns, as the chat shows them. */
export function loadChat(project) {
  const dir = chatDir(project);
  const kept = readJson(join(dir, 'sessions.json'), {});
  const sessions = Array.isArray(kept.sessions) ? kept.sessions.filter((s) => s && typeof s.id === 'string') : [];
  const turns = [];
  let names = [];
  try { names = readdirSync(join(dir, 'turns')).filter((n) => n.endsWith('.json')); } catch { /* none yet */ }
  for (const name of names) {
    const entry = readJson(join(dir, 'turns', name), null);
    if (entry?.turn?.id && Array.isArray(entry.items)) turns.push(entry);
  }
  turns.sort((a, b) => String(a.turn.createdAt).localeCompare(String(b.turn.createdAt)));
  return { sessions, last: typeof kept.last === 'string' ? kept.last : null, turns };
}

export function saveSessions(project, { sessions, last }) {
  const dir = chatDir(project);
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, 'sessions.json'), `${JSON.stringify({ version: 1, last: typeof last === 'string' ? last : null, sessions: Array.isArray(sessions) ? sessions : [] }, null, 1)}\n`);
}

export function saveTurn(project, entry) {
  const id = entry?.turn?.id;
  if (typeof id !== 'string' || !ID.test(id) || !Array.isArray(entry.items)) throw new Error('not a turn');
  const dir = join(chatDir(project), 'turns');
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, `${fileOf(id)}.json`), JSON.stringify({ turn: entry.turn, items: entry.items }));
}

/**
 * Keep the picture of reference [n] of a turn; → its path in the project (`.film/refs/<turn>-<n>.jpg`). The name is
 * made here from the turn's id and the number, both checked, so the page cannot write anywhere else, nor anything but a
 * JPEG of a sensible size.
 */
export function saveRefImage(project, turnId, n, bytes) {
  if (typeof turnId !== 'string' || !ID.test(turnId)) throw new Error('not a turn');
  if (!Number.isInteger(n) || n < 1 || n > REF_MAX) throw new Error('not a reference number');
  const data = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
  if (!data || data.length < 3 || data.length > REF_IMAGE_MAX) throw new Error('not a picture');
  if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new Error('not a JPEG');
  const name = `${fileOf(turnId)}-${n}.jpg`;
  const dir = refsDir(project);
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, name), data);
  return { path: `.film/refs/${name}` };
}

/** A turn's events, as written: [{ t, kind, … }] (a broken line, from a crash mid-write, is left out). */
export function readLog(project, turnId) {
  if (typeof turnId !== 'string' || !ID.test(turnId)) return null;
  const file = join(logsDir(project), `${fileOf(turnId)}.jsonl`);
  if (!existsSync(file)) return null;
  let text = readFileSync(file, 'utf8');
  const cut = text.length > LOG_READ_MAX;
  if (cut) text = text.slice(text.length - LOG_READ_MAX).replace(/^[^\n]*\n/, '');
  const lines = (body) => body.split('\n').flatMap((line) => { try { return line ? [JSON.parse(line)] : []; } catch { return []; /* half a line */ } });
  const model = join(logsDir(project), `${fileOf(turnId)}.model.jsonl`);
  const calls = existsSync(model) ? lines(readFileSync(model, 'utf8')) : [];
  return { file, cut, size: statSync(file).size, events: lines(text), calls };
}

/**
 * A turn's log, written as it happens: `write(kind, fields)` adds a line `{ t, kind, …fields }`, `end()` closes it.
 * Never throws: a log that cannot be written does not stop the turn. `part` '.model': its model requests' log.
 */
export function openLog(project, turnId, onError = () => {}, part = '') {
  if (typeof turnId !== 'string' || !ID.test(turnId)) return { write() {}, end() {} };
  let stream = null;
  try {
    const dir = logsDir(project);
    mkdirSync(dir, { recursive: true });
    stream = createWriteStream(join(dir, `${fileOf(turnId)}${part}.jsonl`), { flags: 'a' });
    stream.on('error', (e) => { onError(e); stream = null; });
  } catch (e) { onError(e); }
  return {
    write(kind, fields = {}) {
      if (!stream) return;
      try { stream.write(`${JSON.stringify({ t: Date.now(), kind, ...fields })}\n`); } catch (e) { onError(e); }
    },
    end() { stream?.end(); stream = null; },
  };
}
