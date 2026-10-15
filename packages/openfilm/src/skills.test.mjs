import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSkills, findSkill, listSkills, parseSkillFile, readSkill, skillText } from './skills.mjs';
import { skillCommand, skillsCommand } from './skills-cli.mjs';

const skill = (dir, name, description, body = 'How to make it.', extra = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
  for (const [file, text] of Object.entries(extra)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
};

test('a SKILL.md front matter: plain, quoted and block values; the body after it', () => {
  const { fields, body } = parseSkillFile([
    '---',
    'name: lyric-pv',
    'description: "Lyric videos: words on the beat"',
    'license: \'MIT\'',
    'when: |',
    '  a song',
    '  with words',
    'note: >',
    '  folded',
    '  into one',
    'long: starts here',
    '  and goes on',
    '---',
    '',
    '# Lyric PV',
  ].join('\n'));
  assert.deepEqual(fields, { name: 'lyric-pv', description: 'Lyric videos: words on the beat', license: 'MIT', when: 'a song\nwith words', note: 'folded into one', long: 'starts here and goes on' });
  assert.equal(body, '# Lyric PV');
  assert.deepEqual(parseSkillFile('no front matter').fields, {});
});

test('skills are listed from the project, then yours, then the official ones, the first holding a name winning', () => {
  const root = mkdtempSync(join(tmpdir(), 'of-skills-'));
  const project = join(root, 'film');
  const mine = join(root, 'mine');
  const official = join(root, 'official');
  skill(join(project, 'skills', 'brand'), 'brand', 'This film\'s brand');
  skill(join(mine, 'brand'), 'brand', 'My brand');
  skill(join(mine, 'lyric-pv'), 'lyric-pv', 'Lyric videos', 'Use the engine.', { 'scripts/build.sh': 'echo', 'lib/engine.js': '' });
  skill(join(official, 'brand'), 'brand', 'Official brand');
  mkdirSync(join(mine, 'not-a-skill'), { recursive: true });
  const all = listSkills({ project, mine, official });
  assert.deepEqual(all.map((s) => [s.name, s.source, s.description]), [['brand', 'project', 'This film\'s brand'], ['lyric-pv', 'mine', 'Lyric videos']]);
  assert.deepEqual(all[0].over, ['mine', 'official']);
  assert.deepEqual(all[1].scripts, ['lib/engine.js', 'scripts/build.sh'], 'what an agent could run, for the person to see');
  assert.equal(listSkills({ mine, official }).find((s) => s.name === 'brand').source, 'mine', 'without a project, yours first');
  assert.equal(findSkill('nothing', { mine, official }), null);
  const text = skillText(all[1]);
  assert.match(text, /^<skill name="lyric-pv" folder=".*mine\/lyric-pv">\n---/);
  assert.match(text, /Use the engine\.\n<\/skill>$/);
});

test('a skill is named by its front matter, else its folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-skill-'));
  mkdirSync(join(dir, 'kinetic'));
  writeFileSync(join(dir, 'kinetic', 'SKILL.md'), 'Just words.');
  assert.equal(readSkill(join(dir, 'kinetic'), 'mine').name, 'kinetic');
});

test('adding a skill copies it into yours (a folder of skills adds each), replacing one of the same name', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-add-'));
  const mine = join(root, 'mine');
  skill(join(mine, 'brand'), 'brand', 'Old');
  const one = skill(join(root, 'src', 'brand-kit'), 'brand', 'New', 'b', { '.git/HEAD': 'x' });
  const added = await addSkills(one, { mine });
  assert.deepEqual(added.map((s) => [s.name, s.description]), [['brand', 'New']]);
  assert.ok(!existsSync(join(mine, 'brand', '.git')), 'no git history');
  assert.ok(existsSync(one), 'a folder of the person\'s is copied, not moved');

  const pack = join(root, 'pack');
  skill(join(pack, 'skills', 'a'), 'a', 'A');
  skill(join(pack, 'skills', 'b'), 'b', 'B');
  assert.deepEqual((await addSkills(pack, { mine })).map((s) => s.name).sort(), ['a', 'b']);
  await assert.rejects(addSkills(join(root, 'src'), { mine: join(root, 'other') }).then(() => addSkills(mkdtempSync(join(tmpdir(), 'empty-')), { mine })), /not a skill/);
});

test('openfilm skills and skill: the list, one printed whole, one added from an address', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-cli-'));
  const home = join(root, 'home');
  const film = join(root, 'film');
  mkdirSync(film);
  writeFileSync(join(film, 'film.html'), '<!doctype html>');
  skill(join(film, 'skills', 'brand'), 'brand', 'This film\'s brand');
  const before = process.env.OPENFILM_HOME;
  process.env.OPENFILM_HOME = home;
  try {
    const listed = skillsCommand('openfilm', { cwd: film });
    assert.ok(listed.lines.some((l) => /brand\s+this project/.test(l)));
    assert.ok(listed.lines.some((l) => l.includes('This film\'s brand')));
    assert.match(skillsCommand('openfilm', { cwd: root }).lines[0], /^No skills yet/);

    const printed = await skillCommand(['brand'], 'openfilm', { cwd: film });
    assert.ok(printed.ok);
    assert.match(printed.lines[0], /^<skill name="brand"/);
    const missing = await skillCommand(['nope'], 'openfilm', { cwd: film });
    assert.deepEqual([missing.ok, missing.usage], [false, true]);

    /* an address: fetched (here, made) into a folder of the one it is given */
    const fetched = await skillCommand(['add', 'https://github.com/someone/skills/tree/main/lyric-pv'], 'openfilm', {
      cwd: film,
      fetch: async (_url, into) => skill(join(into, 'lyric-pv'), 'lyric-pv', 'Lyric videos', 'x', { 'scripts/make.py': '' }),
    });
    assert.ok(fetched.ok, fetched.lines.join('\n'));
    assert.match(fetched.lines.join('\n'), /Added lyric-pv: Lyric videos[\s\S]*scripts\/make\.py[\s\S]*only skills you trust/);
    assert.ok(readFileSync(join(home, 'skills', 'lyric-pv', 'SKILL.md'), 'utf8').includes('Lyric videos'));
    assert.deepEqual(listSkills({ mine: join(home, 'skills'), official: join(root, 'none') }).map((s) => s.name), ['lyric-pv'], 'nothing left from the fetch');
  } finally {
    if (before === undefined) delete process.env.OPENFILM_HOME; else process.env.OPENFILM_HOME = before;
  }
});
