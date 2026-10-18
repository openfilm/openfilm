/**
 * The app's part of the diagnostic report Studio's Settings → Developer copies (the rest is `openfilm doctor` and the
 * page's browser): the app, where its PATH came from, and each of the person's own agents as the roster has it, with
 * its program and the version that program says. Paths in the home folder read ~; no account, key or token.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { homedir } from 'node:os';

/** A path as the report shows it: the home folder as ~. */
export function tidy(path, home = homedir()) {
  if (!path || !home || home.length < 2) return path;
  const starts = process.platform === 'win32' ? path.toLowerCase().startsWith(home.toLowerCase()) : path.startsWith(home);
  return starts ? `~${path.slice(home.length)}` : path;
}

/**
 * One agent's line: ✓ ready, ✗ something to fix (signed out, an error, a program that does not start), – neither (not
 * installed, disconnected here).
 * @param {{ id: string, name: string, status: string, path?: string | null, chosen?: string | null, error?: string, shown?: boolean }} agent
 * @param {{ ok: boolean, version?: string, error?: string } | null} version what `--version` said; null when not asked
 */
export function agentLine(agent, version, home = homedir()) {
  const bad = agent.status === 'sign-in' || Boolean(agent.error) || (version && !version.ok);
  const mark = agent.status === 'ready' && !bad ? '✓' : bad ? '✗' : '–';
  const where = agent.path ? ` · ${tidy(agent.path, home)}${agent.chosen ? ' (chosen)' : ''}` : '';
  const said = version ? ` · ${version.ok ? version.version || '(no version)' : `--version failed: ${oneLine(version.error)}`}` : '';
  const error = agent.error ? ` · ${oneLine(agent.error)}` : '';
  return `${mark} ${agent.name.padEnd(15)}${agent.status}${said}${where}${error}`;
}

const oneLine = (text = '') => {
  const line = String(text).replace(/\s+/g, ' ').trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

/**
 * The report's text.
 * @param {{ version: string, flavor: string, packaged: boolean, channel?: string | null, electron: string, pathSource: string | null,
 *           agents: Array<Parameters<typeof agentLine>[0]>, versions: Record<string, Parameters<typeof agentLine>[1]>, home?: string }} facts
 */
export function appReport({ version, flavor, packaged, channel = null, electron, pathSource, agents, versions, home = homedir() }) {
  const own = agents.filter((a) => a.id !== 'byok');
  const byok = agents.find((a) => a.id === 'byok');
  return [
    'OpenFilm desktop app',
    '',
    `  App            ${version} (${flavor}${packaged ? '' : ', from source'}${channel ? `, ${channel} updates` : ''}; Electron ${electron})`,
    `  PATH from      ${pathSource ?? 'not read yet'}`,
    '',
    'Agents',
    '',
    ...own.map((a) => `  ${agentLine(a, versions[a.id] ?? null, home)}`),
    ...(byok ? [`  ${agentLine({ ...byok, path: null }, null, home)}`] : []),
  ].join('\n');
}

/**
 * The report, gathered now: the roster's agents, and `--version` of each one found (at once, each in its own time).
 * @param {{ list: () => Promise<any[]>, check: (id: string, path: string) => Promise<{ ok: boolean, version?: string, error?: string }> }} roster
 * @param {Omit<Parameters<typeof appReport>[0], 'agents' | 'versions'>} app
 */
export async function gatherAppReport(roster, app) {
  const agents = await roster.list();
  const found = agents.filter((a) => a.id !== 'byok' && a.path);
  const answers = await Promise.all(found.map((a) => roster.check(a.id, a.path).catch((e) => ({ ok: false, error: e?.message ?? String(e) }))));
  const versions = Object.fromEntries(found.map((a, i) => [a.id, answers[i]]));
  return appReport({ ...app, agents, versions });
}
