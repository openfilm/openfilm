import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSkills, findSkill, folderSize, folderSizeAsync, listSkills, migrateMySkills, mySkillsDir, parseSkillFile, readSkill, removeSkill, setSkillCover, setSkillInstalled, setSkillOn, skillOrigins, skillText } from './skills.mjs';
import { commitSkills, discardSkills, previewFolder, previewSkills, skillCommand, skillsCommand } from './skills-cli.mjs';

const skill = (dir, name, description, body = 'How to make it.', extra = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
  for (const [file, text] of Object.entries(extra)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
};

const coverPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('cover edits do not follow a personal skill folder outside its library or write through metadata symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'of-skill-cover-links-'));
  const mine = join(root, 'mine');
  mkdirSync(mine);
  const outside = skill(join(root, 'outside'), 'linked', 'Outside');
  symlinkSync(outside, join(mine, 'linked'), 'junction');
  assert.throws(() => setSkillCover('linked', coverPng, { mine }), /inside your skills folder/);
  assert.equal(existsSync(join(outside, 'openfilm.json')), false);
  const own = skill(join(mine, 'own'), 'own', 'Own');
  const metadata = join(root, 'shared.json');
  writeFileSync(metadata, '{"custom":"original"}');
  /* A file symlink needs privileges on Windows; the folder-junction boundary above still runs there. */
  if (process.platform === 'win32') return;
  symlinkSync(metadata, join(own, 'openfilm.json'));
  setSkillCover('own', coverPng, { mine });
  assert.equal(readFileSync(metadata, 'utf8'), '{"custom":"original"}');
  assert.equal(lstatSync(join(own, 'openfilm.json')).isSymbolicLink(), false);
  setSkillCover('own', null, { mine });
  assert.deepEqual(JSON.parse(readFileSync(join(own, 'openfilm.json'), 'utf8')), { custom: 'original' });
});

test('a chosen cover is kept with the copied skill, preserving its metadata and source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-skill-cover-'));
  const meta = { title: { en: 'A title' }, kind: 'style', custom: 'kept' };
  const from = skill(join(root, 'source'), 'covered', 'Covered skill', 'Steps', { 'openfilm.json': JSON.stringify(meta) });
  const [kept] = await addSkills(from, { mine: join(root, 'mine'), covers: { covered: coverPng } });
  assert.ok(kept.cover);
  assert.deepEqual(readFileSync(join(kept.folder, kept.cover)), Buffer.from(coverPng.split(',')[1], 'base64'));
  const saved = JSON.parse(readFileSync(join(kept.folder, 'openfilm.json'), 'utf8'));
  assert.deepEqual(saved, { ...meta, cover: kept.cover });
  assert.deepEqual(JSON.parse(readFileSync(join(from, 'openfilm.json'), 'utf8')), meta);
  assert.equal(existsSync(join(from, kept.cover)), false);
  assert.equal(readSkill(kept.folder, 'mine').cover, kept.cover, 'cover persists when read again');
});

test('covers follow each skill through a fetched collection; unselected covers remain unchanged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-skill-covers-'));
  const mine = join(root, 'mine');
  const { staging } = await previewSkills('https://github.com/x/y', { mine, fetch: async (_url, into) => {
    const pack = join(into, 'pack');
    skill(join(pack, 'one'), 'one', 'One');
    skill(join(pack, 'two'), 'two', 'Two', 'Steps', { 'openfilm.json': '{"cover":"original.png"}', 'original.png': Buffer.from(coverPng.split(',')[1], 'base64') });
    return pack;
  } });
  const kept = await commitSkills(staging, { mine, covers: { one: coverPng } });
  assert.ok(kept.find(s => s.name === 'one').cover);
  assert.equal(kept.find(s => s.name === 'two').cover, 'original.png');
});

test('invalid cover data is rejected before replacing an existing skill', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-skill-bad-cover-'));
  const mine = join(root, 'mine');
  const from = skill(join(root, 'from'), 'same', 'New');
  const previous = skill(join(mine, 'same'), 'same', 'Original');
  for (const data of ['data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,bm90IGEgcG5n', `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}`]) {
    await assert.rejects(addSkills(from, { mine, covers: { same: data } }), /Skill cover (must|exceeds|does)/);
    assert.equal(readSkill(previous, 'mine').description, 'Original');
  }
});

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
  assert.match(text, /^<skill name="lyric-pv" folder=".*mine[\\/]lyric-pv">\n---/);
  assert.match(text, /Use the engine\.\n<\/skill>$/);
});

test('a skill is named by its front matter, else its folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-skill-'));
  mkdirSync(join(dir, 'kinetic'));
  writeFileSync(join(dir, 'kinetic', 'SKILL.md'), 'Just words.');
  assert.equal(readSkill(join(dir, 'kinetic'), 'mine').name, 'kinetic');
});

test('adding a skill copies it into yours (a folder of skills adds each), the one of the same name to the trash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-add-'));
  const mine = join(root, 'mine');
  process.env.OPENFILM_TRASH_DIR = join(root, 'trash');
  skill(join(mine, 'brand'), 'brand', 'Old');
  const one = skill(join(root, 'src', 'brand-kit'), 'brand', 'New', 'b', { '.git/HEAD': 'x' });
  const added = await addSkills(one, { mine });
  assert.deepEqual(added.map((s) => [s.name, s.description]), [['brand', 'New']]);
  assert.ok(!existsSync(join(mine, 'brand', '.git')), 'no git history');
  assert.ok(existsSync(one), 'a folder of the person\'s is copied, not moved');
  assert.match(readFileSync(join(root, 'trash', 'brand', 'SKILL.md'), 'utf8'), /Old/, 'the one replaced is in the trash');
  assert.equal(await removeSkill('brand', { mine }), true);
  assert.ok(!existsSync(join(mine, 'brand')));
  assert.ok(existsSync(join(root, 'trash', 'brand 2')), 'removed: to the trash too');
  assert.equal(await removeSkill('nothing', { mine }), false);

  const pack = join(root, 'pack');
  skill(join(pack, 'skills', 'a'), 'a', 'A');
  skill(join(pack, 'skills', 'b'), 'b', 'B');
  assert.deepEqual((await addSkills(pack, { mine })).map((s) => s.name).sort(), ['a', 'b']);
  await assert.rejects(addSkills(join(root, 'src'), { mine: join(root, 'other') }).then(() => addSkills(mkdtempSync(join(tmpdir(), 'empty-')), { mine })), /not a skill/);
  delete process.env.OPENFILM_TRASH_DIR;
});

test('yours are kept beside the projects, and those kept in Studio\'s home before move there', () => {
  const before = { library: process.env.OPENFILM_LIBRARY, skills: process.env.OPENFILM_SKILLS };
  const root = mkdtempSync(join(tmpdir(), 'of-mine-'));
  delete process.env.OPENFILM_SKILLS;
  process.env.OPENFILM_LIBRARY = join(root, 'OpenFilm', 'Projects');
  try {
    assert.equal(mySkillsDir(), join(root, 'OpenFilm', 'Skills'));
    const old = join(root, 'home', 'skills');
    skill(join(old, 'brand'), 'brand', 'Mine');
    skill(join(old, 'kinetic'), 'kinetic', 'Old copy');
    skill(join(root, 'OpenFilm', 'Skills', 'kinetic'), 'kinetic', 'Already there');
    assert.deepEqual(migrateMySkills({ from: old, to: mySkillsDir() }), ['brand']);
    assert.ok(existsSync(join(mySkillsDir(), 'brand', 'SKILL.md')));
    assert.match(readFileSync(join(mySkillsDir(), 'kinetic', 'SKILL.md'), 'utf8'), /Already there/, 'one there already is not overwritten');
    assert.match(readFileSync(join(old, 'README.txt'), 'utf8'), /kept in .*Skills now[\s\S]*kinetic/);
    assert.deepEqual(migrateMySkills({ from: old, to: mySkillsDir() }), [], 'once moved, nothing more');
  } finally {
    if (before.library === undefined) delete process.env.OPENFILM_LIBRARY; else process.env.OPENFILM_LIBRARY = before.library;
    if (before.skills !== undefined) process.env.OPENFILM_SKILLS = before.skills;
  }
});

test('adding from an address is looked at first: kept, or let go', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-preview-'));
  const mine = join(root, 'mine');
  skill(join(mine, 'lyric-pv'), 'lyric-pv', 'Mine');
  const fetch = async (_url, into) => { skill(join(into, 'pack', 'skills', 'lyric-pv'), 'lyric-pv', 'Theirs', 'x', { 'scripts/a.py': 'print(1)' }); skill(join(into, 'pack', 'skills', 'charts'), 'charts', 'Charts'); return join(into, 'pack'); };
  const seen = await previewSkills('https://github.com/x/y', { mine, fetch });
  assert.deepEqual(seen.skills.map((s) => [s.name, s.replaces, s.scripts.length]).sort(), [['charts', false, 0], ['lyric-pv', true, 1]]);
  assert.ok(seen.skills.every((s) => s.size > 0));
  assert.deepEqual(listSkills({ mine, official: join(root, 'none') }).map((s) => s.description), ['Mine'], 'nothing kept yet');
  process.env.OPENFILM_TRASH_DIR = join(root, 'trash');
  const kept = await commitSkills(seen.staging, { mine });
  delete process.env.OPENFILM_TRASH_DIR;
  assert.deepEqual(kept.map((s) => s.name).sort(), ['charts', 'lyric-pv']);
  assert.ok(!existsSync(seen.staging), 'the fetch is cleared');
  const again = await previewSkills('https://github.com/x/y', { mine, fetch });
  await discardSkills(again.staging, { mine });
  assert.ok(!existsSync(again.staging));
  await assert.rejects(commitSkills(join(root, 'elsewhere'), { mine }), /Nothing is waiting/);
});

test('a folder on this computer looked at where it is; one already among the person\'s own, or not a skill, refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'of-folder-'));
  const mine = join(root, 'mine');
  skill(join(mine, 'charts'), 'charts', 'Mine');
  const pack = join(root, 'pack');
  skill(join(pack, 'charts'), 'charts', 'Theirs', 'x', { 'scripts/a.py': 'print(1)' });
  skill(join(pack, 'captions'), 'captions', 'Captions');
  const seen = previewFolder(pack, { mine });
  assert.deepEqual(seen.skills.map((s) => [s.name, s.replaces, s.scripts.length]).sort(), [['captions', false, 0], ['charts', true, 1]]);
  assert.deepEqual(previewFolder(join(pack, 'captions'), { mine }).skills.map((s) => s.name), ['captions'], 'one skill\'s own folder');
  assert.deepEqual(previewFolder(join(pack, 'captions', 'SKILL.md'), { mine }), previewFolder(join(pack, 'captions'), { mine }), 'its SKILL.md for it');
  assert.equal(readSkill(join(mine, 'charts'), 'mine')?.description, 'Mine', 'nothing copied yet');
  assert.throws(() => previewFolder(join(mine, 'charts'), { mine }), /among your skills/);
  assert.throws(() => previewFolder(mine, { mine }), /among your skills/);
  assert.throws(() => previewFolder(root + '-none', { mine }), /no SKILL\.md/);
  mkdirSync(join(root, 'empty'));
  assert.throws(() => previewFolder(join(root, 'empty'), { mine }), /no SKILL\.md/);
});

test('openfilm skills and skill: the list, one printed whole, one added from an address', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-cli-'));
  const home = join(root, 'home');
  const film = join(root, 'film');
  mkdirSync(film);
  writeFileSync(join(film, 'film.html'), '<!doctype html>');
  skill(join(film, 'skills', 'brand'), 'brand', 'This film\'s brand');
  const before = process.env.OPENFILM_SKILLS;
  const beforeHome = process.env.OPENFILM_HOME;
  const beforeShared = process.env.OPENFILM_SHARED_HOME;
  delete process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_SKILLS = join(home, 'skills');
  /* the skills kept in Studio's home before, moved as the commands run: a scratch home, never the person's */
  process.env.OPENFILM_HOME = join(root, 'studio-home');
  try {
    const listed = skillsCommand('openfilm', { cwd: film });
    assert.ok(listed.lines.some((l) => /brand\s+this project/.test(l)));
    assert.ok(listed.lines.some((l) => l.includes('This film\'s brand')));
    /* outside a project: none of this film's; OpenFilm's own once installed, and not while off */
    assert.match(skillsCommand('openfilm', { cwd: root }).lines[0], /^No skills installed\./);
    setSkillInstalled('replicate', true);
    const outside = skillsCommand('openfilm', { cwd: root }).lines;
    assert.match(outside[0], /^Skills\. /);
    assert.ok(!outside.some((l) => /this project/.test(l)) && outside.some((l) => /replicate\s+official/.test(l)));
    setSkillOn('replicate', false);
    assert.ok(!skillsCommand('openfilm', { cwd: root }).lines.some((l) => /replicate/.test(l)), 'off: offered to no agent');
    setSkillOn('replicate', true);

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
    if (before === undefined) delete process.env.OPENFILM_SKILLS; else process.env.OPENFILM_SKILLS = before;
    if (beforeHome === undefined) delete process.env.OPENFILM_HOME; else process.env.OPENFILM_HOME = beforeHome;
    if (beforeShared !== undefined) process.env.OPENFILM_SHARED_HOME = beforeShared;
  }
});

test('a skill as people see it: its openfilm.json title and summary by language; none, or not one, read as nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'of-shown-'));
  const dir = skill(join(root, 'replicate'), 'replicate', 'For the agent.');
  writeFileSync(join(dir, 'openfilm.json'), JSON.stringify({ title: { en: 'Replicate a video', 'zh-CN': '复刻视频', bad: 1, 'not a lang': 'x' }, summary: 'One line.' }));
  assert.deepEqual(readSkill(dir, 'official').shown, { title: { en: 'Replicate a video', 'zh-CN': '复刻视频' }, summary: { en: 'One line.' } });
  writeFileSync(join(dir, 'openfilm.json'), '{ not json');
  assert.equal(readSkill(dir, 'official').shown, undefined);
  assert.equal(readSkill(skill(join(root, 'plain'), 'plain', 'x'), 'mine').shown, undefined);
});

test("a skill's openfilm.json: its version, kind, order, mark and media; anything wrong left out; else the front matter's version", () => {
  const root = mkdtempSync(join(tmpdir(), 'of-skill-look-'));
  const a = skill(join(root, 'a'), 'a', 'Does a.', 'How.', {
    'openfilm.json': JSON.stringify({ version: '0.2.0', kind: 'style', order: 3, icon: 'film', cover: 'cover.jpg', preview: 'none.mp4' }),
    'cover.jpg': 'jpeg',
  });
  assert.deepEqual((({ version, kind, order, icon, cover, preview }) => ({ version, kind, order, icon, cover, preview }))(readSkill(a, 'official')),
    { version: '0.2.0', kind: 'style', order: 3, icon: 'film', cover: 'cover.jpg', preview: undefined });
  const b = skill(join(root, 'b'), 'b', 'Does b.', 'How.', { 'openfilm.json': JSON.stringify({ version: 'latest', kind: 'other', order: 'first', icon: 'Big Icon', cover: '../x.jpg' }) });
  const read = readSkill(b, 'mine');
  for (const key of ['version', 'kind', 'order', 'icon', 'cover']) assert.equal(read?.[key], undefined, key);
  mkdirSync(join(root, 'c'));
  writeFileSync(join(root, 'c', 'SKILL.md'), '---\nname: c\ndescription: Does c.\nversion: 1.4\n---\nHow.\n');
  assert.equal(readSkill(join(root, 'c'), 'mine')?.version, '1.4');
});

test('where the person\'s skills came from: a folder, or the address commitSkills was given; forgotten when removed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-skill-origin-'));
  const mine = join(root, 'mine');
  const src = skill(join(root, 'src', 'cards'), 'cards', 'Makes cards.');
  await addSkills(src, { mine });
  assert.deepEqual((({ from, address }) => ({ from, address }))(skillOrigins(mine).cards), { from: 'folder', address: src });
  const fetched = skill(join(root, 'net', 'lyrics'), 'lyrics', 'Makes lyric videos.');
  const { staging } = await previewSkills('https://github.com/someone/lyrics', { mine, fetch: async (_url, into) => { const to = join(into, 'lyrics'); cpSync(fetched, to, { recursive: true }); return to; } });
  await commitSkills(staging, { mine });
  assert.deepEqual((({ from, address }) => ({ from, address }))(skillOrigins(mine).lyrics), { from: 'link', address: 'https://github.com/someone/lyrics' });
  await removeSkill('cards', { mine });
  assert.equal(skillOrigins(mine).cards, undefined);
  assert.ok(skillOrigins(mine).lyrics);
});

test("a cover's format is what its bytes are, and a cover chosen before goes when it is replaced; the skill's own picture stays", () => {
  const root = mkdtempSync(join(tmpdir(), 'of-skill-cover-swap-'));
  const mine = join(root, 'mine');
  skill(join(mine, 'own'), 'own', 'Own', 'Steps', { 'openfilm.json': '{"cover":"original.png"}', 'original.png': Buffer.from(coverPng.split(',')[1], 'base64') });
  /* a JPEG the browser called a PNG, from its file's name */
  const jpeg = `data:image/png;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString('base64')}`;
  const first = setSkillCover('own', jpeg, { mine }).cover;
  assert.match(first, /^openfilm-cover-.+\.jpg$/);
  const second = setSkillCover('own', coverPng, { mine }).cover;
  assert.match(second, /\.png$/);
  assert.equal(existsSync(join(mine, 'own', first)), false, 'the cover chosen before is gone');
  assert.equal(existsSync(join(mine, 'own', 'original.png')), true);
  assert.equal(setSkillCover('own', null, { mine }).cover, undefined);
  assert.equal(existsSync(join(mine, 'own', second)), false);
  assert.equal(existsSync(join(mine, 'own', 'original.png')), true, 'a picture of the skill\'s own stays');
  assert.throws(() => setSkillCover('own', `data:image/png;base64,${Buffer.from('GIF89a......').toString('base64')}`, { mine }), /PNG, JPEG or WebP/);
});

test('the folder walk reads asynchronously: same bytes, and Studio still runs while the disk is read', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-skill-size-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.git', 'objects'), Buffer.alloc(1000));
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested', 'part'), '12345');
  writeFileSync(join(dir, 'top'), 'abc');

  const same = folderSize(dir);
  assert.equal(same, 8, '.git is left out, files in a folder inside it counted');
  assert.equal(await folderSizeAsync(dir), same, 'the asynchronous walk reads the same bytes');
  assert.equal(await folderSizeAsync(join(dir, 'gone')), 0, 'a folder that is not there holds nothing');

  /* a synchronous walk ends inside one tick: nothing else in Studio gets to run while a slow disk is read */
  let turns = 0;
  let walking = true;
  const turn = () => { if (walking) { turns++; setImmediate(turn); } };
  setImmediate(turn);
  await folderSizeAsync(dir);
  walking = false;
  assert.ok(turns > 0, 'the event loop turned while the walk waited for the disk');
});
