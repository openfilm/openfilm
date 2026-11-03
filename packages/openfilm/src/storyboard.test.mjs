import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStoryboard, getVerbFor, parseStoryboard, readStoryboard, storyboardSeconds } from './storyboard.mjs';

/** A project: a folder with a film.html, as the check takes one. */
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-storyboard-'));
  writeFileSync(join(dir, 'film.html'), '<!doctype html>');
  return dir;
};

/** The storyboard written where the tools read it. */
const writeBoard = (dir, text) => {
  mkdirSync(join(dir, '.film', 'pipeline'), { recursive: true });
  writeFileSync(join(dir, '.film', 'pipeline', 'storyboard.md'), text);
};

const TEXT = `# Storyboard — a launch film

Prose between the shots is read past.

## Shot 1 — 4s — title
page: title.html
vo: One prompt, one film.
text: MAKE FILMS AT THE SPEED OF THOUGHT
media: assets/image/logo.png
media: assets/image/poster.jpg

## Shot 2 - 6.5s
page: demo.html
media: assets/video/screen.mp4
notes: the cursor leads the eye
`;

test('a storyboard is its shots: numbers, seconds, names and fields, the prose between them read past', () => {
  const { shots, problems } = parseStoryboard(TEXT);
  assert.deepEqual(problems, []);
  assert.deepEqual(shots.map((s) => s.n), [1, 2]);
  assert.deepEqual(shots.map((s) => s.seconds), [4, 6.5]);
  assert.equal(shots[0].name, 'title');
  assert.equal(shots[0].page, 'title.html');
  assert.equal(shots[0].vo, 'One prompt, one film.');
  assert.equal(shots[0].text, 'MAKE FILMS AT THE SPEED OF THOUGHT');
  assert.deepEqual(shots[0].media, ['assets/image/logo.png', 'assets/image/poster.jpg']);
  assert.equal(shots[1].notes, 'the cursor leads the eye');
  assert.equal(storyboardSeconds(shots), 10.5);
  assert.equal(getVerbFor('assets/video/screen.mp4'), 'video');
  assert.equal(getVerbFor('assets/audio/music/bed.mp3'), 'music');
  assert.equal(getVerbFor('assets/audio/sfx/hit.mp3'), 'sfx');
  assert.equal(getVerbFor('assets/logo.png'), null);
});

test('a storyboard not in its form says where: no seconds, a field no shot has, a number said twice', () => {
  const { shots, problems } = parseStoryboard([
    '## Shot 1 — 4s',
    'pages: title.html',
    '',
    '## Shot 1 — 2s',
    'page: a.html',
    '',
    '## Shot 2',
    'page: b.html',
  ].join('\n'), 's.md');
  assert.match(problems[0], /^s\.md:2: a shot has no pages/);
  assert.match(problems[1], /^s\.md:4: shot 1 twice/);
  assert.match(problems[2], /^s\.md:7: a shot heading says/);
  assert.equal(shots.length, 3);
  assert.equal(shots[0].page, null);
  assert.equal(shots[1].page, 'a.html');
  assert.equal(shots[2].page, 'b.html');
  assert.ok(!('seconds' in shots[2]));
});

test('a heading that is not a shot in form starts nothing: its fields are not another shot\'s', () => {
  const { shots, problems } = parseStoryboard([
    '## Shot 1 — 3s',
    'page: a.html',
    '## Shot',
    'page: b.html',
  ].join('\n'));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /a shot heading says/);
  assert.equal(shots.length, 1);
  assert.equal(shots[0].page, 'a.html');
});

test('a shot may be headed with one #: a h1 heading starts its own shot, not the last one\'s tail', () => {
  const { shots, problems } = parseStoryboard([
    '## Shot 1 — 4s',
    'page: a.html',
    '# Shot 2 — 2s',
    'page: b.html',
  ].join('\n'));
  assert.deepEqual(problems, []);
  assert.deepEqual(shots.map((s) => [s.n, s.seconds, s.page]), [[1, 4, 'a.html'], [2, 2, 'b.html']]);
});

test('a field that names a file names it as the project has it: escapes read, the fragment off', () => {
  const { shots, problems } = parseStoryboard([
    '## Shot 1 — 4s',
    'page: my%20page.html',
    'vo: Say #1, louder.',
    'media: assets/video/screen.mp4#t=2,8',
  ].join('\n'));
  assert.deepEqual(problems, []);
  assert.equal(shots[0].page, 'my page.html');
  assert.equal(shots[0].vo, 'Say #1, louder.');
  assert.deepEqual(shots[0].media, ['assets/video/screen.mp4']);
});

test('a film.html that does not read is said once, and the shots are not each said not cut', () => {
  const dir = project();
  writeBoard(dir, TEXT);
  writeFileSync(join(dir, 'title.html'), '<script>window.film={frame(){}}</script>');
  writeFileSync(join(dir, 'demo.html'), '<script>window.film={frame(){}}</script>');
  writeFileSync(join(dir, 'film.html'), '<html><body><section><iframe src="title.html#t=0,4"');
  const said = checkStoryboard(dir, readStoryboard(dir)).lines.join('\n');
  assert.match(said, /film\.html does not read as a film/);
  assert.doesNotMatch(said, /is not cut into film\.html/);
});

test('a page named with an escape is held to film.html as the file it is', () => {
  const dir = project();
  writeBoard(dir, ['## Shot 1 — 4s', 'page: my%20page.html', ''].join('\n'));
  writeFileSync(join(dir, 'my page.html'), '<script>window.film={frame(){}}</script>');
  writeFileSync(join(dir, 'film.html'), '<section><iframe src="my%20page.html#t=0,4"></iframe></section>');
  const hold = checkStoryboard(dir, readStoryboard(dir));
  assert.equal(hold.ok, true, hold.lines.join('\n'));
});

test('a field that names a file is its file: a media fragment, written as film.html would, does not hide it', () => {
  const { shots, problems } = parseStoryboard([
    '## Shot 1 — 4s',
    'page: title.html#t=0,4',
    'vo: Say #1, louder.',
    'media: assets/video/screen.mp4#t=2,8',
  ].join('\n'));
  assert.deepEqual(problems, []);
  assert.equal(shots[0].page, 'title.html');
  assert.equal(shots[0].vo, 'Say #1, louder.');
  assert.deepEqual(shots[0].media, ['assets/video/screen.mp4']);
});

test('no storyboard, no read', () => {
  assert.equal(readStoryboard(project()), null);
});

test('the check names what the storyboard calls for that is not in the project, under the stage that fills it', () => {
  const dir = project();
  writeBoard(dir, TEXT);
  const gap = checkStoryboard(dir, readStoryboard(dir), { seconds: 10 });
  assert.equal(gap.ok, false);
  const text = gap.lines.join('\n');
  assert.match(text, /storyboard\.md — 2 shots, 10\.5 s/);
  assert.match(text, /page title\.html is not written yet \(assembly\)/);
  assert.match(text, /media assets\/image\/logo\.png is missing \(assets: `openfilm get image --out assets\/image\/logo\.png --prompt "…"`\)/);
  assert.match(text, /voice not recorded: assets\/audio\/vo\/shot-1\.wav/);
  assert.match(text, /--text "One prompt, one film\."/);
  assert.match(text, /the shots add up to 10\.5 s; the film is 10 s \(storyboard\)/);
  assert.match(text, /things the film still needs/);
});

test('media a get does not make, and media outside assets/, are said their own ways', () => {
  const dir = project();
  writeBoard(dir, ['## Shot 1 — 4s', 'page: a.html', 'media: media/own.jpg'].join('\n'));
  const text = checkStoryboard(dir, readStoryboard(dir)).lines.join('\n');
  assert.match(text, /media media\/own\.jpg is missing \(the manual keeps media under assets\/\) \(assets: your service, or media the person has\)/);
});

test('the check is quiet when the pages are written and cut in, the media is there and the voices are recorded', () => {
  const dir = project();
  writeBoard(dir, TEXT);
  writeFileSync(join(dir, 'title.html'), '<script>window.film={frame(){}}</script>');
  writeFileSync(join(dir, 'demo.html'), '<script>window.film={frame(){}}</script>');
  writeFileSync(join(dir, 'film.html'), [
    '<!doctype html><meta name="viewport" content="width=1920, height=1080"><body>',
    '<section><iframe src="title.html#t=0,4"></iframe></section>',
    '<section><iframe src="demo.html#t=0,6.5"></iframe></section>',
    '</body>',
  ].join('\n'));
  for (const file of ['assets/image/logo.png', 'assets/image/poster.jpg']) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), 'x');
  }
  mkdirSync(join(dir, 'assets', 'video'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'video', 'screen.mp4'), 'x');
  mkdirSync(join(dir, 'assets', 'audio', 'vo'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'audio', 'vo', 'shot-1.wav'), 'x');
  const hold = checkStoryboard(dir, readStoryboard(dir), { seconds: 10.5 });
  assert.equal(hold.ok, true);
  assert.match(hold.lines.join('\n'), /the storyboard holds/);
});

test('the check holds film.html to the storyboard: a page not cut, a length changed, the order changed', () => {
  const dir = project();
  writeBoard(dir, TEXT);
  const pages = () => {
    writeFileSync(join(dir, 'title.html'), '<script>window.film={frame(){}}</script>');
    writeFileSync(join(dir, 'demo.html'), '<script>window.film={frame(){}}</script>');
  };
  pages();
  /* the pages written, the film still empty: every shot is not cut in */
  const bare = checkStoryboard(dir, readStoryboard(dir));
  assert.match(bare.lines.join('\n'), /page title\.html is not cut into film\.html \(assembly\)/);
  assert.match(bare.lines.join('\n'), /page demo\.html is not cut into film\.html \(assembly\)/);
  /* a length the film gives that the storyboard does not say */
  pages();
  writeFileSync(join(dir, 'film.html'), '<section><iframe src="title.html#t=0,4"></iframe><iframe src="demo.html#t=0,5"></iframe></section>');
  const length = checkStoryboard(dir, readStoryboard(dir));
  const lengthText = length.lines.join('\n');
  assert.match(lengthText, /shot 2\s+film\.html gives it 5 s; the storyboard says 6\.5 s \(assembly\)/);
  assert.doesNotMatch(lengthText, /shot 1\s+film\.html gives it/);
  /* the shots cut in another order than the storyboard's */
  writeFileSync(join(dir, 'film.html'), '<section><iframe src="demo.html#t=0,6.5"></iframe><iframe src="title.html#t=0,4"></iframe></section>');
  const order = checkStoryboard(dir, readStoryboard(dir));
  assert.match(order.lines.join('\n'), /film\.html cuts the shots out of the storyboard's order/);
  /* a page cut twice is one shot's place, not an order broken */
  writeFileSync(join(dir, 'film.html'), '<section><iframe src="title.html#t=0,4"></iframe><iframe src="logo.html#t=0,1"></iframe><iframe src="title.html#t=0,4"></iframe></section>');
  const twice = checkStoryboard(dir, readStoryboard(dir)).lines.join('\n');
  assert.doesNotMatch(twice, /out of the storyboard's order/);
});

test('a storyboard with no shots is said so, with the form named', () => {
  const dir = project();
  writeBoard(dir, '# Storyboard\n\nnothing yet\n');
  const said = checkStoryboard(dir, readStoryboard(dir));
  assert.equal(said.ok, false);
  assert.match(said.lines.join('\n'), /no shots in it/);
});
