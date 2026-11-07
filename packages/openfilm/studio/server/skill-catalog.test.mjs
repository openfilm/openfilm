import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSkill, listSkills, offeredSkills, usableSkills } from '../../src/skills.mjs';
import { catalogSkills, installSkill, installedStanding, readCatalog, readDiscover, refreshCatalog, uninstallSkill } from './skill-catalog.mjs';

/** A fake GitHub: its API lists a folder's files at a commit, its raw host sends each. `repos[commit]` → { path: text } */
async function github(/** @type {Record<string, Record<string, string>>} */ commits) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const tree = /^\/repos\/openfilm\/skill-demo\/git\/trees\/([0-9a-f]{40})(?:%3A|:)(.+)$/.exec(url.pathname);
    if (tree) {
      const files = commits[tree[1]];
      const folder = decodeURIComponent(tree[2]);
      if (!files) { res.writeHead(404).end('{}'); return; }
      const inside = Object.entries(files).filter(([p]) => p.startsWith(`${folder}/`)).map(([p, text]) => ({ path: p.slice(folder.length + 1), type: 'blob', mode: '100644', size: text.length }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ tree: inside }));
      return;
    }
    const raw = /^\/openfilm\/skill-demo\/([0-9a-f]{40})\/(.+)$/.exec(url.pathname);
    const text = raw ? commits[raw[1]]?.[decodeURIComponent(raw[2])] : undefined;
    if (text === undefined) { res.writeHead(404).end(); return; }
    res.writeHead(200).end(text);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(null)));
  const at = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  return { hosts: { api: at, raw: at }, close: () => server.close() };
}

const skill = (version, words) => ({
  'skills/demo/SKILL.md': `---\nname: demo\ndescription: A demo film\n---\n\n${words}\n`,
  'skills/demo/openfilm.json': JSON.stringify({ version, title: { en: 'Demo' }, summary: { en: 'One line.' } }),
});
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const entry = (commit, version) => ({ name: 'demo', repo: 'https://github.com/openfilm/skill-demo', path: 'skills/demo', version, commit });

test('Discover: the index read as it is now, each skill installed at its commit, an update said and made, one taken away still there', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-catalog-'));
  const keys = ['OPENFILM_SHARED_HOME', 'OPENFILM_HOME', 'OPENFILM_SKILLS_INDEX', 'OPENFILM_TRASH_DIR', 'OPENFILM_SKILLS', 'OPENFILM_OFFICIAL_SKILLS'];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  t.after(() => { for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });
  Object.assign(process.env, { OPENFILM_SHARED_HOME: join(root, 'home'), OPENFILM_HOME: join(root, 'home'), OPENFILM_SKILLS_INDEX: join(root, 'index.json'),
    OPENFILM_TRASH_DIR: join(root, 'trash'), OPENFILM_SKILLS: join(root, 'mine') });
  delete process.env.OPENFILM_OFFICIAL_SKILLS;
  mkdirSync(join(root, 'trash'));
  const gh = await github({ [A]: skill('1.0.0', 'First.'), [B]: skill('1.1.0', 'Second.') });
  t.after(gh.close);
  const index = (/** @type {object[]} */ skills) => writeFileSync(join(root, 'index.json'), JSON.stringify({ version: 1, skills }));

  assert.equal(readCatalog(), null, 'never read: nothing is said');
  index([entry(A, '1.0.0'), { name: 'Bad Name', repo: 'x', path: 'y', version: '1', commit: 'z' }]);
  await refreshCatalog({ hosts: gh.hosts });
  const shown = catalogSkills();
  assert.deepEqual(shown.map((k) => [k.uid, k.version, k.shown?.title.en]), [['openfilm/demo', '1.0.0', 'Demo']], 'the malformed entry left out');
  assert.deepEqual(listSkills(), [], 'in Discover, not installed');
  /* not installed, it can still be tried in a conversation: named, and found by its name */
  assert.equal(findSkill('demo')?.uid, 'openfilm/demo');
  assert.ok(offeredSkills().named.some((k) => k.uid === 'openfilm/demo') && !offeredSkills().given.some((k) => k.uid === 'openfilm/demo'));
  /* read a moment ago: asked again within its freshness, what was read; one reading for many askers */
  const read = readCatalog()?.read;
  assert.equal((await readDiscover({ fresh: 60_000 })).read, read);

  await installSkill('openfilm/demo');
  assert.deepEqual(usableSkills().map((k) => [k.uid, k.source]), [['openfilm/demo', 'official']], 'installed: agents get it');
  assert.match(readFileSync(join(usableSkills()[0].folder, 'SKILL.md'), 'utf8'), /First\./);
  assert.equal(installedStanding().size, 0, 'the commit Discover has');

  /* the index pins a newer commit: said, not taken until asked; taken, the old one goes to the trash */
  index([entry(B, '1.1.0')]);
  await refreshCatalog({ hosts: gh.hosts });
  assert.deepEqual(installedStanding().get('openfilm/demo'), { update: { version: '1.1.0', commit: B } });
  assert.match(readFileSync(join(usableSkills()[0].folder, 'SKILL.md'), 'utf8'), /First\./, 'still the commit installed');
  assert.equal(readdirSync(join(root, 'home', 'skill-catalog', 'openfilm')).length, 1, 'the catalog keeps only what the index names');
  await installSkill('openfilm/demo');
  assert.match(readFileSync(join(usableSkills()[0].folder, 'SKILL.md'), 'utf8'), /Second\./);
  assert.equal(readdirSync(join(root, 'trash')).length, 1, 'the old one in the trash');

  /* taken out of the index: gone from Discover, still installed and working, said to be retired */
  index([]);
  await refreshCatalog({ hosts: gh.hosts });
  assert.deepEqual(catalogSkills(), []);
  assert.deepEqual(installedStanding().get('openfilm/demo'), { retired: true });
  assert.equal(usableSkills().length, 1);
  await assert.rejects(installSkill('openfilm/demo'), /Discover has no such skill/);

  /* an index that cannot be read: what was read before stays */
  writeFileSync(join(root, 'index.json'), '{ not json');
  await assert.rejects(refreshCatalog({ hosts: gh.hosts }));
  assert.ok(readCatalog());

  assert.equal(await uninstallSkill('openfilm/demo'), true);
  assert.deepEqual(usableSkills(), []);
  assert.equal(readdirSync(join(root, 'trash')).length, 2, 'uninstalled to the trash');
  assert.equal(existsSync(join(root, 'home', 'skills-installed', 'openfilm-demo')), false);
});
