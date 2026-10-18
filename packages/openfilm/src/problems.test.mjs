import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEEP_MAX, problemLine, problemLines, recentProblems, recordProblem, redact, trimProblems } from './problems.mjs';

const fileIn = () => join(mkdtempSync(join(tmpdir(), 'openfilm-problems-')), 'logs', 'problems.jsonl');

test('a problem is kept as a line, tidied: the home folder as ~, no keys, tokens or email addresses', () => {
  const file = fileIn();
  recordProblem({ area: 'agent', agent: 'Codex', step: 'session/prompt', what: 'Codex stopped\nwithout saying why.', project: '/home-of-someone/Projects/Film', stderr: 'Authorization: Bearer abcdefghijklmnop for ana@example.com' }, { file, now: new Date('2026-10-18T13:13:15Z') });
  const [p] = recentProblems({ file, now: new Date('2026-10-18T14:00:00Z') });
  assert.equal(p.t, '2026-10-18T13:13:15.000Z');
  assert.equal(p.what, 'Codex stopped without saying why.');
  assert.equal(p.agent, 'Codex');
  assert.equal(p.step, 'session/prompt');
  assert.doesNotMatch(p.stderr, /abcdefghijklmnop|ana@example\.com/);
  assert.equal(redact('/home-of-someone/x', '/home-of-someone'), '~/x');
  assert.equal(redact('key sk-proj-abcdefghijklmnopqrstu end'), 'key (key hidden) end');
  assert.equal(redact('{"api_key": "xxxxxxxxxxxx"}'), '{"api_key": "(hidden)"}');
  assert.equal(redact('https://x.dev/?token=abcdef123456&a=1'), 'https://x.dev/?token=(hidden)&a=1');
});

test('one with nothing to say is not kept; one that cannot be written does not throw', () => {
  const file = fileIn();
  recordProblem({ area: 'agent', what: '  ' }, { file });
  assert.deepEqual(recentProblems({ file }), []);
  assert.doesNotThrow(() => recordProblem({ area: 'x', what: 'y' }, { file: '/dev/null/cannot/problems.jsonl' }));
});

test('kept: the last two weeks, at most KEEP_MAX; a broken line is left out', () => {
  const file = fileIn();
  const now = new Date('2026-10-18T12:00:00Z');
  recordProblem({ area: 'export', what: 'old' }, { file, now: new Date('2026-10-01T12:00:00Z') });
  for (let i = 0; i < KEEP_MAX + 5; i += 1) recordProblem({ area: 'export', what: `p${i}` }, { file, now: new Date(now.getTime() - (KEEP_MAX + 5 - i) * 1000) });
  writeFileSync(file, `${readFileSync(file, 'utf8')}{"t":"half`);
  trimProblems({ file, now });
  const kept = recentProblems({ file, now });
  assert.equal(kept.length, KEEP_MAX);
  assert.equal(kept[0].what, 'p5');
  assert.equal(kept.at(-1).what, `p${KEEP_MAX + 4}`);
  assert.ok(!kept.some((p) => p.what === 'old'));
});

test('read in the order they happened, whichever process wrote one first', () => {
  const file = fileIn();
  recordProblem({ area: 'agent', what: 'later' }, { file, now: new Date('2026-10-18T12:00:00Z') });
  recordProblem({ area: 'studio', what: 'earlier' }, { file, now: new Date('2026-10-18T11:00:00Z') });
  assert.deepEqual(recentProblems({ file, now: new Date('2026-10-18T13:00:00Z') }).map((p) => p.what), ['earlier', 'later']);
});

test("the report's lines: the last week's, the last few, each when, what about and what it said; none without any", () => {
  const file = fileIn();
  const now = new Date('2026-10-18T12:00:00Z');
  assert.deepEqual(problemLines({ file, now }), []);
  recordProblem({ area: 'studio', what: 'last month' }, { file, now: new Date('2026-10-05T12:00:00Z') });
  for (let i = 0; i < 12; i += 1) recordProblem({ area: 'agent', agent: 'Codex', step: 'start', what: `failed ${i}` }, { file, now: new Date(now.getTime() - (12 - i) * 60_000) });
  const lines = problemLines({ file, now, count: 3 });
  assert.equal(lines[0], 'Problems in the last 7 days (12, the last 3):');
  assert.equal(lines.length, 4);
  assert.match(lines[3], /^ {2}\d{4}-\d\d-\d\d \d\d:\d\d {2}Codex · start {2}failed 11$/);
  assert.match(problemLine({ t: 'x', area: 'export', what: 'no codec' }), /^x {2}export {2}no codec$/);
});
