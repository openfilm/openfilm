/** Version checks for the exact programs OpenFilm uses. Updating always belongs to their original installer. */
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { AGENT_DEFINITIONS, OWN_AGENT_IDS } from './agent-definitions.mjs';
import { installCommand, laterVersion } from './agent-installation.mjs';

export const UPDATE_PACKAGES = Object.freeze({
  codex: '@openai/codex', claude: '@anthropic-ai/claude-code', copilot: '@github/copilot',
  opencode: '@opencode/cli', codebuddy: '@tencent-ai/codebuddy-code', qwen: '@qwen-code/qwen-code',
  kimi: '@moonshot-ai/kimi-code', minimax: '@minimax-ai/code',
});
const DAY = 24 * 60 * 60_000;
const version = (text) => /\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/.exec(String(text ?? ''))?.[1] ?? null;
function newer(latest, current, id) {
  const core = s => s.split(/[+-]/)[0];
  if (core(latest) !== core(current)) return laterVersion(core(latest), core(current));
  if (id === 'cursor') return latest !== current; // dated builds carry a commit rather than a SemVer prerelease
  const pre = s => s.split('+')[0].split('-').slice(1).join('-');
  const a = pre(latest), b = pre(current);
  if (!a || !b) return !a && Boolean(b);
  const x = a.split('.'), y = b.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (x[i] === undefined || y[i] === undefined) return y[i] === undefined;
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
    return nx && ny ? Number(x[i]) > Number(y[i]) : nx !== ny ? ny : x[i] > y[i];
  }
  return false;
}
const quote = (s, win) => win ? `'${String(s).replace(/'/g, "''")}'` : `'${String(s).replace(/'/g, `'\\''`)}'`;
export function programIdentity(file) {
  try { const real = realpathSync(file), s = statSync(real); return `${real}\0${s.mtimeMs}\0${s.size}`; } catch { return file ?? ''; }
}

/** No command or URL from a renderer or remote response is executed. These plans use local paths and fixed vendors. */
export function agentUpdatePlan(agent, { win = process.platform === 'win32', realpath = realpathSync, read = readFileSync } = {}) {
  const id = agent.id, url = AGENT_DEFINITIONS[id]?.install;
  const parent = win ? win32.dirname : posix.dirname, child = win ? win32.join : posix.join;
  if (id === 'openfilm' || id === 'byok') return { kind: 'desktop' };
  if (!OWN_AGENT_IDS.includes(id) || !agent.path) return null;
  let real;
  try { real = realpath(agent.path); } catch { return { kind: 'link', url }; }
  // Bundled copies must be updated by their owning desktop app, never by installing another global CLI.
  if (/\.app[\\/]Contents[\\/]|[\\/]Claude[\\/]claude-code[\\/]|[\\/]WindowsApps[\\/]|[\\/]resources[\\/]/i.test(real)) return { kind: 'link', url, managed: true };
  const parts = real.split(/[\\/]/);
  const cask = parts.indexOf('Caskroom'), cellar = parts.indexOf('Cellar');
  const brew = cask >= 0 ? parts[cask + 1] : cellar >= 0 ? parts[cellar + 1] : null;
  if (brew && /^[a-z0-9@+_.-]+$/i.test(brew)) return { kind: 'command', command: `brew upgrade ${cask >= 0 ? '--cask ' : ''}${brew}` };
  for (let dir = parent(real), n = 0; n < 8; dir = parent(dir), n++) {
    let pkg;
    try { pkg = JSON.parse(read(child(dir, 'package.json'), 'utf8')); } catch { continue; }
    if (pkg.name !== UPDATE_PACKAGES[id] && !(id === 'opencode' && pkg.name === 'opencode-ai')) continue;
    const tag = id === 'claude' ? 'stable' : 'latest';
    // Other managers can have independent global stores. Let their official setup guide handle those copies.
    if (parts.some((part) => ['.bun', '.pnpm', 'pnpm', 'yarn'].includes(part))) return { kind: 'link', url, managed: true };
    // npm can have several Node prefixes on one computer. Target the prefix containing this actual installation.
    const beforeModules = dir.replace(/[\\/]node_modules[\\/].*$/, '');
    const prefix = /[\\/]lib$/.test(beforeModules) ? parent(beforeModules) : beforeModules;
    if (beforeModules === dir) return { kind: 'link', url, managed: true };
    return { kind: 'command', command: `npm install -g --prefix ${quote(prefix, win)} ${pkg.name}@${tag}` };
  }
  const command = { codex: 'update', claude: 'update', cursor: 'update', opencode: 'upgrade', copilot: 'update stable', codebuddy: 'update', kimi: 'upgrade', minimax: 'update' }[id];
  if (command) return { kind: 'command', command: `${win ? '& ' : ''}${quote(agent.path, win)} ${command}` };
  if (id === 'qwen' || id === 'antigravity') return { kind: 'command', command: installCommand(id, { win }) };
  return { kind: 'link', url, managed: true };
}

/** DeepSeek ships its CLI with an Electron app. Read that installation's channel, restricted to its official host. */
export function deepseekUpdateFeed(program, { read = readFileSync, realpath = realpathSync, platform = process.platform } = {}) {
  if (!program) return null;
  try {
    const real = realpath(program), resources = /^(.*[\\/]resources)[\\/]/i.exec(real)?.[1];
    if (!resources) return null;
    const child = platform === 'win32' ? win32.join : join;
    const config = String(read(child(resources, 'app-update.yml'), 'utf8'));
    const value = key => new RegExp(`^${key}:\\s*["']?([^\\r\\n"']+)["']?\\s*$`, 'm').exec(config)?.[1]?.trim();
    if (value('provider') !== 'generic') return null;
    const url = new URL(value('url'));
    if (url.origin !== 'https://download.deepseek.com' || !url.pathname.startsWith('/dsh-desk/feeds/')) return null;
    const channel = value('channel') || 'latest';
    if (!/^[a-z][a-z0-9-]*$/.test(channel)) return null;
    const suffix = platform === 'darwin' ? '-mac' : platform === 'linux' ? '-linux' : '';
    return new URL(`${channel}${suffix}.yml`, url.href.replace(/\/?$/, '/')).href;
  } catch { return null; }
}

/** Read only public first-party version metadata, never run an installer to "check". */
export async function latestAgentVersion(id, { fetch: get = fetch, platform = process.platform, arch = process.arch, current, program } = {}) {
  let url;
  // OpenCode 1 and 2 have separate official release lines; routine updates keep the installed major.
  const pkg = id === 'opencode' && current?.startsWith('1.') ? 'opencode-ai' : UPDATE_PACKAGES[id];
  if (pkg) url = `https://registry.npmjs.org/-/package/${encodeURIComponent(pkg)}/dist-tags`;
  else if (id === 'cursor') url = 'https://cursor.com/install';
  else if (id === 'antigravity') url = `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${platform === 'win32' ? 'windows' : platform}_${arch === 'arm64' ? 'arm64' : platform === 'win32' ? 'amd64' : 'x64'}.json`;
  else if (id === 'deepseek') { url = deepseekUpdateFeed(program, { platform }); if (!url) return null; }
  else return null;
  const response = await get(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json, text/plain', 'user-agent': 'OpenFilm update check' } });
  if (!response.ok) throw new Error(`Version service answered ${response.status}.`);
  const text = await response.text();
  let latest;
  if (id === 'cursor') latest = /downloads\.cursor\.com\/lab\/([^/"\s]+)/.exec(text)?.[1];
  else if (id === 'deepseek') latest = /^version:\s*["']?([\w.+-]+)/m.exec(text)?.[1];
  else { const data = JSON.parse(text); latest = id === 'antigravity' ? data.version : id === 'claude' ? data.stable ?? data.latest : data.latest; }
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(latest ?? '')) throw new Error('The official version service did not report a valid version.');
  return latest;
}

export function createAgentUpdates({ dataDir, getAgents, readVersion, onChange, onUpdated, openCommand, openLink, openDesktop,
  isBusy = () => false, fetch: get = fetch, now = Date.now, identity = programIdentity, plan = agentUpdatePlan, appVersion = '' }) {
  const file = join(dataDir, 'agent-updates.json');
  let saved;
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { saved = {}; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const states = new Map(Object.entries(saved).filter(([id, s]) => OWN_AGENT_IDS.includes(id) && s && typeof s === 'object').map(([id, s]) => [id,
    ['checking', 'queued', 'updating'].includes(s.status) ? { ...s, status: 'unchecked', checkedAt: 0 } : s]));
  const pending = new Map(), jobs = new Map();
  let stopped = false, timer = null, first = null, lastSweep = now();
  const persist = () => {
    try { mkdirSync(dataDir, { recursive: true }); writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(states)), { mode: 0o600 }); renameSync(`${file}.tmp`, file); } catch { /* checks still work without a writable cache */ }
  };
  const publish = (id, next) => { if (stopped) return; states.set(id, next); persist(); onChange(); };
  const agentOf = (id) => getAgents().find((a) => a.id === id);
  const state = (id) => id === 'openfilm' || id === 'byok' ? { status: 'managed', version: appVersion, action: { kind: 'desktop' } } : states.get(id) ?? { status: 'unchecked' };
  async function check(id, { fresh = false } = {}) {
    if (pending.has(id)) return pending.get(id);
    const agent = agentOf(id);
    if (!agent?.path || !OWN_AGENT_IDS.includes(id)) return state(id);
    if (jobs.has(id)) return state(id);
    const previous = states.get(id), stamp = identity(agent.path);
    const ttl = previous?.status === 'unknown' ? 30 * 60_000 : DAY;
    if (!fresh && ['current', 'available', 'managed', 'unknown'].includes(previous?.status) && previous.identity === stamp && now() - previous.checkedAt < ttl) return previous;
    const task = Promise.resolve().then(async () => {
      const action = plan(agent);
      const same = previous?.identity === stamp;
      publish(id, { ...previous, version: same ? previous?.version : null, identity: stamp, status: 'checking', action, error: null });
      let current = null;
      try {
        const answer = await readVersion(id, agent.path);
        if (!answer?.ok) throw new Error(answer?.error || 'The installed program could not be checked.');
        current = version(answer.version);
        if (!current) throw new Error('The installed program did not report its version.');
        const latest = await latestAgentVersion(id, { fetch: get, current, program: agent.path });
        if (identity(agentOf(id)?.path) !== stamp) return states.get(id);
        publish(id, { status: latest ? newer(latest, current, id) ? 'available' : 'current' : 'managed',
          version: current, latestVersion: latest, checkedAt: now(), identity: stamp, action });
      } catch (e) {
        if (identity(agentOf(id)?.path) !== stamp) return state(id);
        publish(id, { status: 'unknown', version: current ?? (same ? previous?.version : null) ?? null, latestVersion: same ? previous?.latestVersion ?? null : null,
          checkedAt: now(), identity: stamp, action, error: String(e?.message ?? e).slice(0, 200) });
      }
      // Model discovery must refresh even when the public version service is temporarily unavailable.
      if (!stopped && current && previous?.version && previous.version !== current && identity(agentOf(id)?.path) === stamp) {
        try { await onUpdated(id); }
        catch (e) { publish(id, { ...state(id), status: 'error', error: `The program changed, but refreshing its connection failed: ${String(e?.message ?? e).slice(0, 160)}` }); }
      }
      return state(id);
    }).finally(() => {
      pending.delete(id);
      const current = agentOf(id);
      if (!stopped && current?.path && identity(current.path) !== stamp) void check(id, { fresh: true });
    });
    pending.set(id, task);
    return task;
  }
  async function checkAll(options) {
    const ids = getAgents().filter((a) => a.path && OWN_AGENT_IDS.includes(a.id)).map((a) => a.id);
    for (let i = 0; i < ids.length; i += 3) await Promise.allSettled(ids.slice(i, i + 3).map((id) => check(id, options)));
    return getAgents();
  }
  async function launch(id, job) {
    if (stopped || job.launching) return;
    job.launching = true;
    if (agentOf(id)?.path !== job.path) { jobs.delete(id); await check(id, { fresh: true }); return; }
    publish(id, { ...state(id), status: 'updating', error: null });
    const result = await openCommand(id, job.action.command).catch((e) => ({ ok: false, error: String(e.message) }));
    if (!result?.ok) { jobs.delete(id); publish(id, { ...state(id), status: 'error', error: result?.error ?? 'The update terminal did not open.' }); return { ok: false, error: state(id).error }; }
    job.startedAt = now();
    job.completion = result.completion;
    return { ok: true };
  }
  async function update(id) {
    if (id === 'openfilm' || id === 'byok') { await openDesktop(); return { ok: true }; }
    if (jobs.has(id)) return { ok: true };
    await check(id, { fresh: true });
    if (jobs.has(id)) return { ok: true };
    const agent = agentOf(id), action = agent?.path ? plan(agent) : null;
    if (!action) return { ok: false, error: 'This agent is not installed.' };
    if (action.kind === 'link') { await openLink(action.url); return { ok: true, external: true }; }
    if (!state(id).version) return { ok: false, error: 'Check the installed program before updating it.' };
    const job = { path: agent.path, version: state(id).version, action, startedAt: null, launching: false };
    jobs.set(id, job);
    if (isBusy(id)) publish(id, { ...state(id), status: 'queued', error: null });
    else return await launch(id, job);
    return { ok: true };
  }
  async function poll() {
    for (const [id, job] of jobs) {
      if (job.polling) continue;
      job.polling = true;
      try {
        if (job.startedAt === null) { if (!isBusy(id)) await launch(id, job); continue; }
        const completed = await job.completion?.();
        const current = await readVersion(id, job.path).catch(() => null);
        if (current?.ok && version(current.version) && version(current.version) !== job.version) {
          jobs.delete(id);
          await check(id, { fresh: true });
        } else if (completed) {
          jobs.delete(id);
          await check(id, { fresh: true });
          if (completed.code !== 0 || state(id).status === 'available') publish(id, { ...state(id), status: 'error',
            error: completed.code === null ? 'The update terminal was closed before completion.' : completed.code !== 0 ? `The update command exited with code ${completed.code}. Check its terminal output.` : 'The installer finished, but this program still reports an older version. Check its terminal output and installation path.' });
        } else if (now() - job.startedAt > 15 * 60_000) {
          jobs.delete(id); publish(id, { ...state(id), status: 'error', error: 'No version change was detected. Check the update terminal, then check again.' });
        }
      } catch (e) {
        jobs.delete(id); publish(id, { ...state(id), status: 'error', error: String(e?.message ?? e).slice(0, 200) });
      } finally { job.polling = false; }
    }
  }
  return {
    state, check, checkAll, update, poll,
    sync(list) {
      for (const a of list) if (a.path && OWN_AGENT_IDS.includes(a.id) && !pending.has(a.id) && !jobs.has(a.id) && state(a.id).identity !== identity(a.path)) void check(a.id);
    },
    start() {
      first = setTimeout(() => { lastSweep = now(); void checkAll(); }, 15_000); first.unref?.();
      // Successful checks stay cached for a day; failed checks get another chance after 30 minutes.
      timer = setInterval(() => { void poll(); if (now() - lastSweep >= 30 * 60_000) { lastSweep = now(); void checkAll(); } }, 3000); timer.unref?.();
    },
    stop() { stopped = true; clearTimeout(first); clearInterval(timer); jobs.clear(); },
  };
}
