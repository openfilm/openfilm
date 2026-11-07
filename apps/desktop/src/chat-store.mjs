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
 *   <turn>.jsonl           each turn as it happened, one event a line: the prompt and its settings, every
 *                          update the agent sent (what it said and thought, each tool call with its input and output),
 *                          every question and permission and the answer, how it ended; for whoever needs every detail.
 *                          A picture in an event is kept as a file (images/), a text longer than STRING_MAX in a line
 *                          still over LINE_MAX is cut, and past LOG_MAX the agent's updates are no longer kept (a
 *                          `cut` line says so, and at the end how many were left out): a log stays a size to read
 *   <turn>.model.jsonl     each request the agent made to its model in that turn, and the answer: the app's own
 *                          agent's as Pi sends it (pi-agent.mjs); Claude Code's and Codex's read from their own records
 *                          once the turn ends (agent-records.mjs). A request carries the whole conversation, so a
 *                          line keeps only what is new: `prefix`, how many of the last request's messages come first,
 *                          then its own; `systemPrompt` and `tools` only when they changed. Its pictures are files
 *                          too, and past MODEL_LOG_MAX no more requests are kept (a `cut` line says so)
 *   images/<sha1>.<ext>    each picture a message carried to its agent or a tool gave back, by its content (the log
 *                          names the file)
 *
 * the pictures a message's references point at, `.film/refs/`:
 *   <turn>-<n>.jpg         the picture of the message's reference [n] (a frame, or the part of it pointed at), for its
 *                          agent to look at: the message names the path
 *
 * the files pasted into a message, `.film/attachments/`:
 *   <name>                 a file with no place on the disk of its own (a screenshot, a picture copied from a page),
 *                          kept for the agent: the message names the path. A file or folder dragged in from the disk
 *                          stays where it is, and the message names that path instead
 *
 * `.film/` is Studio's own (its projects.mjs says what else is there): a film never reads it, and nothing in it is
 * served. Reads no Electron module, so `node --test` can use it.
 */
import { createHash } from 'node:crypto';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** a turn's id (`local:…`) and the file it names (no `:`, which Windows does not allow in a name) */
const ID = /^[\w:-]{1,120}$/;
const fileOf = (id) => id.replace(/:/g, '-');
/** the most of a log's events given at once, as they are shown (pictures' bytes left out): a longer log is given as
    its first line (the prompt) and its end, as the last of a very long turn is what explains how it ended */
const EVENTS_READ_MAX = 8 * 1024 * 1024;
/** the most of a log's file read for that: its end (a reader further behind than this starts over) */
const RAW_READ_MAX = 64 * 1024 * 1024;
/** a turn's log keeps the agent's updates up to this size; past it, only the turn's own events (how it ended) */
const LOG_MAX = 32 * 1024 * 1024;
/** a turn's model log keeps requests up to this size */
const MODEL_LOG_MAX = 64 * 1024 * 1024;
/** a line longer than this has its pictures kept as files (written) or left out (read) */
const PICTURES_FROM = 16 * 1024;
/** a line still longer than this, once its pictures are out, has each text longer than STRING_MAX cut */
const LINE_MAX = 1024 * 1024;
const STRING_MAX = 64 * 1024;

export const chatDir = (project) => join(project, '.film', 'chat');
export const logsDir = (project) => join(project, '.film', 'logs');
export const refsDir = (project) => join(project, '.film', 'refs');
export const attachmentsDir = (project) => join(project, '.film', 'attachments');
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

/**
 * Keep a file pasted into a message; → its path in the project (`.film/attachments/<name>`). The name is cut to its last
 * part and cleaned here, so the page cannot write anywhere else; a name already there gets ` 2`, ` 3`… before its ending.
 */
export function saveAttachment(project, name, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
  if (!data || !data.length) throw new Error('the file is empty');
  const clean = String(name ?? '').split(/[/\\]/).pop().replace(/[\u0000-\u001f<>:"|?*]+/g, '').replace(/^[.\s]+/, '').trim().slice(0, 200) || 'file';
  const dot = clean.lastIndexOf('.');
  const [stem, ending] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
  const dir = attachmentsDir(project);
  mkdirSync(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const file = n === 1 ? clean : `${stem} ${n}${ending}`;
    if (existsSync(join(dir, file))) continue;
    writeAtomic(join(dir, file), data);
    return { path: `.film/attachments/${file}` };
  }
}

/**
 * What each path dragged into a message is: a file (its size) or a folder; `error` for one that is not there or cannot
 * be read. Nothing is copied: the message names the path where it is.
 */
export function describePaths(paths) {
  return (Array.isArray(paths) ? paths : []).map((path) => {
    if (typeof path !== 'string' || !isAbsolute(path)) return { path: String(path), error: 'That is not a file.' };
    try {
      const found = statSync(path);
      return found.isDirectory() ? { path, folder: true } : { path, folder: false, size: found.size };
    } catch {
      return { path, error: 'That file is not there any more.' };
    }
  });
}

/** A picture's bytes (base64) in a log's value: Pi's and ACP's image blocks (`data`), a provider's (`source.data`). */
function pictureData(value) {
  if (!value || typeof value !== 'object' || value.type !== 'image') return null;
  const data = typeof value.data === 'string' ? value.data : typeof value.source?.data === 'string' ? value.source.data : null;
  return data ? data : null;
}

/**
 * A copy of `value` (as JSON gives it) with each picture as `swap(block, data)` says, and (`cut`) each text longer than
 * STRING_MAX cut to it, saying how much more there was.
 */
function reshaped(value, swap, cut) {
  const walk = (v) => {
    if (typeof v === 'string') return cut && v.length > STRING_MAX ? `${v.slice(0, STRING_MAX)}… [${v.length - STRING_MAX} more characters not kept]` : v;
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    const data = pictureData(v);
    if (data) return swap(v, data);
    const out = {};
    for (const [key, x] of Object.entries(v)) out[key] = walk(x);
    return out;
  };
  return walk(value);
}

/** A picture block without its bytes: its type and size, and what else `more` adds (its file). */
function pictureWithout(block, data, more = {}) {
  const { data: _data, source, ...rest } = block;
  const mimeType = block.mimeType ?? source?.media_type;
  return { ...rest, ...(source ? { source: { ...source, data: undefined } } : {}), mimeType, bytes: Buffer.byteLength(data, 'base64'), ...more };
}

/** A log's line as it is kept: a long one with its pictures as files (saveLogImage), and its long texts cut if still too long. */
function keptLine(project, line) {
  if (line.length <= PICTURES_FROM) return line;
  const swap = (block, data) => pictureWithout(block, data, { file: saveLogImage(project, data, block.mimeType ?? block.source?.media_type) });
  const out = JSON.stringify(reshaped(JSON.parse(line), swap, false));
  return out.length > LINE_MAX ? JSON.stringify(reshaped(JSON.parse(out), swap, true)) : out;
}

/** A line of a log as read: parsed, a long one without its pictures' bytes (a log from before they were kept as files). */
function readLine(text) {
  let value;
  try { value = JSON.parse(text); } catch { return null; /* half a line, from a crash mid-write */ }
  if (text.length <= PICTURES_FROM) return value;
  const out = reshaped(value, (block, data) => pictureWithout(block, data), false);
  return text.length > LINE_MAX && JSON.stringify(out).length > LINE_MAX ? reshaped(out, (block) => block, true) : out;
}

/** A value read with its pictures' bytes left out (an agent's own record, read as it runs). */
export const withoutPictures = (value) => reshaped(value, (block, data) => pictureWithout(block, data), false);

/**
 * Each whole line of `file` from byte `from` to `to`, read a part at a time (a log is never in memory at once);
 * → where the last whole line ends (a line being written stays for the next read).
 */
function eachLine(file, from, to, onLine) {
  const fd = openSync(file, 'r');
  try {
    const part = Buffer.alloc(1024 * 1024);
    let pending = [];
    let at = from;
    let end = from;
    while (at < to) {
      const got = readSync(fd, part, 0, Math.min(part.length, to - at), at);
      if (!got) break;
      let start = 0;
      for (let i = part.indexOf(10, 0); i !== -1 && i < got; i = part.indexOf(10, i + 1)) {
        const line = pending.length ? Buffer.concat([...pending, part.subarray(start, i)]) : part.subarray(start, i);
        pending = [];
        onLine(line.toString('utf8'));
        start = i + 1;
        end = at + start;
      }
      if (start < got) pending.push(Buffer.from(part.subarray(start, got)));
      at += got;
    }
    return end;
  } finally { closeSync(fd); }
}

const statOf = (file) => { try { return statSync(file); } catch { return null; } };

/** Where a turn's log is (it may not be there yet); null: not a turn's id. */
export function logFile(project, turnId) {
  return typeof turnId === 'string' && ID.test(turnId) ? join(logsDir(project), `${fileOf(turnId)}.jsonl`) : null;
}

/** A turn's first event, its prompt (who was asked, with what), read alone; null: no log, or no line yet. */
export function logPrompt(project, turnId) {
  const file = logFile(project, turnId);
  const found = file ? statOf(file) : null;
  if (!found) return null;
  let first = null;
  eachLine(file, 0, Math.min(found.size, LINE_MAX), (text) => { first ??= text; });
  return first === null ? null : readLine(first);
}

/**
 * A turn's log as a reader is shown it: { file, cut, events, calls, callsCut, at } — its events ([{ t, kind, … }], a
 * broken line left out), its first and as many of its last as EVENTS_READ_MAX holds (`cut`: some between are not), and its
 * model requests (`callsCut`: past its most, the later ones were not kept), pictures' bytes left out. `at`: where this
 * read stopped. `since`: an earlier read's `at`: only what was written after it, `whole` false (`callsWhole` false:
 * the requests too); nothing new: `{ same: true }`. A reader too far behind, or a model log written again since, is
 * given it whole again. `calls` false: the events alone.
 */
export function readLog(project, turnId, { since = null, calls: withCalls = true } = {}) {
  const file = logFile(project, turnId);
  const found = file ? statOf(file) : null;
  if (!found) return null;
  const model = join(logsDir(project), `${fileOf(turnId)}.model.jsonl`);
  const modelFound = withCalls ? statOf(model) : null;
  const modelSize = modelFound?.size ?? 0;
  const modelId = modelFound?.ino ?? 0;
  if (since && since.events === found.size && since.calls === modelSize && since.callsFile === modelId) return { same: true };

  /* the events read, as many of the last as fit in EVENTS_READ_MAX as shown */
  const kept = [];
  let first = 0;
  let keptSize = 0;
  const add = (text) => {
    const event = readLine(text);
    if (!event) return;
    const size = text.length <= PICTURES_FROM ? text.length : JSON.stringify(event).length;
    kept.push({ event, size });
    keptSize += size;
    while (keptSize > EVENTS_READ_MAX && first < kept.length - 1) keptSize -= kept[first++].size;
  };
  const onward = since && since.events <= found.size && found.size - since.events <= RAW_READ_MAX;
  let eventsAt;
  let skipped = false;
  if (onward) eventsAt = eachLine(file, since.events, found.size, add);
  else if (found.size <= RAW_READ_MAX) eventsAt = eachLine(file, 0, found.size, add);
  else {
    /* from the first line that starts in the end read */
    let partial = true;
    eventsAt = eachLine(file, found.size - RAW_READ_MAX - 1, found.size, (text) => { if (partial) partial = false; else add(text); });
    skipped = true;
  }
  /* some left out: the first line (the prompt: who, with what) and the end; a reader reading on is given that whole */
  const cut = skipped || first > 0;
  const whole = !onward || first > 0;
  const events = kept.slice(first).map((k) => k.event);
  if (cut) {
    const head = logPrompt(project, turnId);
    if (head && (events[0]?.t !== head.t || events[0]?.kind !== head.kind)) events.unshift(head);
  }

  const calls = [];
  let callsCut = false;
  const onwardCalls = since && since.callsFile === modelId && since.calls <= modelSize;
  const callsAt = modelFound
    ? eachLine(model, onwardCalls ? since.calls : 0, modelSize, (text) => {
      const call = readLine(text);
      if (!call) return;
      if (call.kind === 'cut') callsCut = true;
      else calls.push(call);
    })
    : 0;
  return {
    file, cut, whole, events, calls, callsWhole: !onwardCalls, callsCut,
    at: { events: eventsAt, calls: callsAt, callsFile: modelId },
  };
}

/** how many turns found only in the logs are read at once (the newest), and the most of each log that is read */
const UNSAVED_MAX = 20;

/**
 * The turns that have a log and no saved record (`.film/chat/turns`): ones the app closed on, or crashed in, before it
 * kept them. Each with its events, for the chat to make what it shows of it again; the newest first, at most
 * UNSAVED_MAX. `except`: turn ids not to read (running now).
 */
export function unsavedTurns(project, { except = [] } = {}) {
  let names = [];
  try { names = readdirSync(logsDir(project)).filter((n) => n.endsWith('.jsonl') && !n.endsWith('.model.jsonl')); } catch { return []; }
  const saved = new Set((() => { try { return readdirSync(join(chatDir(project), 'turns')); } catch { return []; } })());
  const skip = new Set(except.map(fileOf));
  const found = names
    .map((name) => name.slice(0, -'.jsonl'.length))
    .filter((base) => !saved.has(`${base}.json`) && !skip.has(base))
    .map((base) => ({ base, at: statSync(join(logsDir(project), `${base}.jsonl`)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(0, UNSAVED_MAX);
  const out = [];
  for (const { base } of found) {
    const events = readLog(project, base, { calls: false })?.events ?? [];
    const prompt = events.find((e) => e.kind === 'prompt');
    /* only a turn the chat started knows its own id and conversation (its `meta`) */
    if (prompt?.meta?.turnId && typeof prompt.meta.turnId === 'string') out.push({ turnId: prompt.meta.turnId, events });
  }
  return out;
}

const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * Keep a picture a message carried (base64) in the logs, named by its content, so a turn's log can say which picture
 * went without carrying its bytes; → its path in the project (`.film/logs/images/<sha1>.<ext>`), or null.
 */
export function saveLogImage(project, data, mimeType) {
  try {
    const bytes = Buffer.from(String(data ?? ''), 'base64');
    if (!bytes.length) return null;
    const name = `${createHash('sha1').update(bytes).digest('hex')}.${IMAGE_EXT[mimeType] ?? 'bin'}`;
    const dir = join(logsDir(project), 'images');
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, name))) writeAtomic(join(dir, name), bytes);
    return `.film/logs/images/${name}`;
  } catch { return null; }
}

/** A message's blocks as the log keeps them: each picture's bytes kept apart (saveLogImage), the rest as it went. */
export function loggedBlocks(project, blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((b) => (b?.type === 'image' && typeof b.data === 'string'
    ? { type: 'image', mimeType: b.mimeType, bytes: Buffer.byteLength(b.data, 'base64'), file: saveLogImage(project, b.data, b.mimeType) }
    : b));
}

/**
 * Write a turn's model requests whole (lines as agent-records.mjs compactCalls makes them), in place of any before:
 * each line as openLog keeps it, and none past MODEL_LOG_MAX (a `cut` line says how many were left out).
 */
export function writeModelLog(project, turnId, lines) {
  if (typeof turnId !== 'string' || !ID.test(turnId)) return;
  const dir = logsDir(project);
  mkdirSync(dir, { recursive: true });
  const kept = [];
  let size = 0;
  for (const [i, call] of lines.entries()) {
    const line = keptLine(project, JSON.stringify(call));
    if (size + line.length > MODEL_LOG_MAX) {
      kept.push(JSON.stringify({ t: Date.now(), kind: 'cut', max: MODEL_LOG_MAX, dropped: lines.length - i }));
      break;
    }
    kept.push(line);
    size += line.length + 1;
  }
  writeAtomic(join(dir, `${fileOf(turnId)}.model.jsonl`), kept.map((line) => `${line}\n`).join(''));
}

/**
 * A turn's log, written as it happens: `write(kind, fields)` adds a line `{ t, kind, …fields }` (keptLine), `end()`
 * closes it. Past LOG_MAX it keeps no more of the agent's updates, past MODEL_LOG_MAX no more requests: a `cut` line
 * says so, and as it closes, how many were left out. Never throws: a log that cannot be written does not stop the turn.
 * `part` '.model': its model requests' log.
 */
export function openLog(project, turnId, onError = () => {}, part = '') {
  if (typeof turnId !== 'string' || !ID.test(turnId)) return { write() {}, end() {} };
  let stream = null;
  let size = 0;
  const max = part ? MODEL_LOG_MAX : LOG_MAX;
  let dropped = 0;
  try {
    const dir = logsDir(project);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${fileOf(turnId)}${part}.jsonl`);
    /* a turn's log opened again (the agent's work adopted after it ended) goes on from its size */
    size = statOf(file)?.size ?? 0;
    stream = createWriteStream(file, { flags: 'a' });
    stream.on('error', (e) => { onError(e); stream = null; });
  } catch (e) { onError(e); }
  const put = (line) => {
    stream.write(`${line}\n`);
    size += Buffer.byteLength(line) + 1;
  };
  return {
    write(kind, fields = {}) {
      if (!stream) return;
      try {
        if (dropped && (part || kind === 'update')) { dropped += 1; return; }
        const line = keptLine(project, JSON.stringify({ t: Date.now(), kind, ...fields }));
        if (size + line.length > max && (part || kind === 'update')) {
          dropped += 1;
          put(JSON.stringify({ t: Date.now(), kind: 'cut', max }));
          return;
        }
        put(line);
      } catch (e) { onError(e); }
    },
    end() {
      try { if (stream && dropped) put(JSON.stringify({ t: Date.now(), kind: 'cut', dropped })); } catch (e) { onError(e); }
      stream?.end();
      stream = null;
    },
  };
}
