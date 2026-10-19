/**
 * Each of the person's own agents, as the chat would use it on this computer: found where the app looks (its login
 * shell's PATH and the usual folders), started (`--version`), and spoken to over ACP through the app's own code
 * (agents.mjs AgentSession: the same environment, adapter and command line as the chat's). The nightly `agents`
 * workflow runs it after installing the newest of each, so an agent's update that breaks the chat shows there first.
 *
 *   node scripts/agent-check.mjs [agent…]
 *
 * Agents named must be found; with none named, every agent is tried and one not installed is left out. Nobody needs to
 * be signed in: an agent that asks for its sign-in, or refuses a session in its own words, was found, started and
 * spoke ACP, which is what this checks. Exit status 1 when one named is not found or does not get that far.
 * On GitHub Actions the table also goes to the job's summary.
 */
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AGENTS, AgentSession, checkAgentProgram, resolveAgentCli } from '../src/agents.mjs';
import { PATH_SEP, loginShellEnvironment } from '../src/environment.mjs';

const SESSION_MS = 120_000;

/**
 * How far an agent got: `found` (its program), `version` (what --version said), `acp` ('opened' a session, 'sign-in'
 * asked for, 'answered' with an error in ACP's own terms, else null) and `error` when it stopped short.
 * @param {string} id @param {string[]} pathDirs
 */
export async function checkAgent(id, pathDirs, { sessionMs = SESSION_MS } = {}) {
  const cli = resolveAgentCli(id, { pathDirs });
  if (!cli) return { id, found: null, version: null, acp: null, error: 'not found' };
  const started = await checkAgentProgram(id, cli.path);
  if (!started.ok) return { id, found: cli.path, version: null, acp: null, error: `--version: ${started.error}` };
  const cwd = mkdtempSync(join(tmpdir(), `openfilm-agent-check-${id}-`));
  const session = new AgentSession({ agent: id, cwd });
  let timer;
  try {
    await Promise.race([session.start(), new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(`no session within ${sessionMs / 1000} s`)), sessionMs); })]);
    return { id, found: cli.path, version: started.version, acp: 'opened', error: null };
  } catch (e) {
    const err = /** @type {any} */ (e);
    if (err?.code === 'sign-in') return { id, found: cli.path, version: started.version, acp: 'sign-in', error: null };
    /* an error with a JSON-RPC code came from the agent over ACP: it started and spoke */
    if (typeof err?.code === 'number') return { id, found: cli.path, version: started.version, acp: 'answered', error: null, said: String(err.message) };
    const stderr = session.stderr.trim().split(/\r?\n/).slice(-8).join('\n');
    return { id, found: cli.path, version: started.version, acp: null, error: `${err?.message ?? err}${stderr ? `\n${stderr}` : ''}` };
  } finally {
    clearTimeout(timer);
    session.close();
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* a process still in it (Windows) */ }
  }
}

/** The results as a Markdown table, for the job's summary. */
export function summary(results, { platform = process.platform } = {}) {
  const cell = (text) => String(text ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  return [
    `### Agents on ${platform}`,
    '',
    '| Agent | Result | Version | Program | Said |',
    '| --- | --- | --- | --- | --- |',
    ...results.map((r) => `| ${AGENTS[r.id]?.label ?? r.id} | ${r.error ? `✗ ${cell(r.error.split('\n')[0])}` : `✓ ${r.acp}`} | ${cell(r.version)} | ${cell(r.found)} | ${cell(r.said ?? (r.error?.includes('\n') ? r.error.split('\n').slice(1).join('\n') : ''))} |`),
    '',
  ].join('\n');
}

async function main() {
  const named = process.argv.slice(2);
  const unknown = named.filter((id) => !Object.hasOwn(AGENTS, id));
  if (unknown.length) {
    console.error(`agent-check: no agent ${unknown.join(', ')} (there are ${Object.keys(AGENTS).join(', ')})`);
    process.exit(2);
  }
  const ids = named.length ? named : Object.keys(AGENTS);
  const pathDirs = (await loginShellEnvironment({ maxAgeMs: 0 })).PATH.split(PATH_SEP);
  const results = [];
  /* one at a time: each starts a program that may be heavy, and their outputs stay apart */
  for (const id of ids) {
    const r = await checkAgent(id, pathDirs);
    if (!named.length && r.error === 'not found') continue;
    results.push(r);
    const label = AGENTS[id].label;
    console.log(r.error ? `✗ ${label}: ${r.error}` : `✓ ${label}: ${r.version} · ${r.acp}${r.said ? ` (${r.said})` : ''} · ${r.found}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(results));
  /* the adapters' children and stdio pipes would keep the process up */
  process.exit(results.some((r) => r.error) ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
