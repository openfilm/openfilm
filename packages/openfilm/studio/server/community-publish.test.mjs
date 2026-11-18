import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPublished } from './community-publish.mjs';

const C = 'c'.repeat(40);
const remote = { 'skills/brand/SKILL.md': '---\nname: brand\ndescription: Brand.\n---\nUse it.\n', 'skills/brand/openfilm.json': '{"version":"1.0.0"}' };

test('a published skill is read in the person\'s repository, compared file by file, and its listing made', async (t) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/repos/someone/brand-skill/commits/HEAD') { res.writeHead(200).end(C); return; }
    if (url.pathname.startsWith('/repos/someone/brand-skill/git/trees/')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ tree: Object.entries(remote).map(([p, text]) => ({ path: p.slice('skills/brand/'.length), type: 'blob', mode: '100644', size: text.length })) }));
      return;
    }
    const raw = /^\/someone\/brand-skill\/[0-9a-f]{40}\/(.+)$/.exec(url.pathname);
    if (raw && remote[decodeURIComponent(raw[1])] !== undefined) { res.writeHead(200).end(remote[decodeURIComponent(raw[1])]); return; }
    if (url.pathname === '/users/someone') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() })); return; }
    res.writeHead(404).end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(null)));
  t.after(() => server.close());
  const at = `http://127.0.0.1:${server.address().port}`;
  const root = mkdtempSync(join(tmpdir(), 'of-publish-verify-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'brand');
  mkdirSync(folder);
  for (const [p, text] of Object.entries(remote)) writeFileSync(join(folder, p.slice('skills/brand/'.length)), text);
  writeFileSync(join(folder, '.DS_Store'), 'x');
  const skill = { name: 'brand', folder, version: '1.0.0', kind: 'skill' };
  const hosts = { api: at, raw: at };
  const same = await verifyPublished(skill, 'https://github.com/someone/brand-skill', { hosts });
  assert.equal(same.same, true);
  assert.equal(same.commit, C);
  assert.equal(same.ageDays, 3);
  assert.equal(same.registryPath, 'registry/skill/someone/brand.json');
  assert.deepEqual(Object.keys(same.entry), ['name', 'repo', 'path', 'version', 'commit', 'files']);
  assert.match(same.proposeUrl, /^https:\/\/github\.com\/openfilm\/community\/new\/main\?filename=registry%2Fskill%2Fsomeone%2Fbrand\.json&value=/);
  assert.equal(JSON.parse(decodeURIComponent(new URL(same.proposeUrl).searchParams.get('value'))).commit, C);
  /* changed here, and one not pushed: said */
  writeFileSync(join(folder, 'SKILL.md'), 'changed');
  writeFileSync(join(folder, 'extra.md'), 'not pushed');
  const differs = await verifyPublished(skill, 'github.com/someone/brand-skill', { hosts });
  assert.deepEqual([differs.same, differs.differ, differs.onlyHere], [false, ['SKILL.md'], ['extra.md']]);
  await assert.rejects(verifyPublished(skill, 'https://gitlab.com/a/b', { hosts }), /GitHub/);
});
