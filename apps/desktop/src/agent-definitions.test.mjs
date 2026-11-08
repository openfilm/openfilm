import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_DEFINITIONS, AGENT_IDS, OWN_AGENT_IDS, isAgentId } from './agent-definitions.mjs';
import { AGENTS } from './agents.mjs';
import { AGENT_PROGRAMS, AGENT_DOWNLOADS } from './agent-installation.mjs';
import { AGENT_IDS as rosterIds, AGENT_NAMES as rosterNames } from './agent-roster.mjs';

test('the desktop definitions cover exactly the existing launchers and discovery programs', () => {
  const own = [...OWN_AGENT_IDS].sort();
  assert.deepEqual(own, Object.keys(AGENTS).sort());
  assert.deepEqual(own, Object.keys(AGENT_PROGRAMS).sort());
  assert.deepEqual(own, Object.keys(AGENT_DOWNLOADS).sort());
  assert.deepEqual(AGENT_IDS.filter((id) => id !== 'openfilm' && id !== 'byok'), OWN_AGENT_IDS);
  assert.deepEqual(AGENT_IDS.slice(0, 3), ['codex', 'claude', 'openfilm']);
  for (const id of OWN_AGENT_IDS) {
    assert.equal(AGENT_DEFINITIONS[id].name, AGENTS[id].label);
    assert.equal(AGENT_DEFINITIONS[id].name, rosterNames[id]);
    assert.equal(AGENT_DEFINITIONS[id].install, AGENT_DOWNLOADS[id]);
    assert.equal(new URL(AGENT_DOWNLOADS[id]).protocol, 'https:');
  }
  assert.equal(AGENT_DEFINITIONS.byok.install, null);
  assert.equal(AGENT_DEFINITIONS.deepseek.install, 'https://www.deepseek.com/harness/');
});

test('the roster and installation API keep their existing metadata exports', () => {
  assert.equal(rosterIds, AGENT_IDS);
  assert.deepEqual(Object.keys(rosterNames), AGENT_IDS);
  assert.equal(rosterNames.byok, 'Own key');
});

test('agent id validation accepts own key and rejects unknown ids and inherited properties', () => {
  for (const id of AGENT_IDS) assert.equal(isAgentId(id), true);
  for (const value of [null, undefined, 0, {}, [], new String('codex'), '', 'unknown', 'Codex', '__proto__', 'constructor', 'toString']) {
    assert.equal(isAgentId(value), false);
  }
});
