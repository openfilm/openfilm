import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimantOf, filmCommandOf, linkOfCommand, matchesPattern, parseLink, routeLink, timeOf } from './links.ts';
import type { StudioCommand } from './host';

test('a link is a path in the project and what in it; an address, a path from the root or out of the project is none', () => {
  assert.deepEqual(parseLink('film.html#s3'), { path: 'film.html', fragment: 's3' });
  assert.deepEqual(parseLink(' ./film.html#t=12.5 '), { path: 'film.html', fragment: 't=12.5' });
  assert.deepEqual(parseLink('assets/a.mp4'), { path: 'assets/a.mp4', fragment: null });
  assert.deepEqual(parseLink('assets/a%20b.mp4#'), { path: 'assets/a b.mp4', fragment: null });
  assert.deepEqual(parseLink('.film/canvas.json#n%201'), { path: '.film/canvas.json', fragment: 'n 1' });
  /* a % that is not an escape is the path's own */
  assert.deepEqual(parseLink('assets/100%.mp4'), { path: 'assets/100%.mp4', fragment: null });
  for (const none of ['', '  ', '#s3', 'https://openfilm.dev/film.html#s3', 'mailto:a@b.c', '/etc/passwd', '\\\\share\\a.mp4', '../other/film.html', 'assets/../../x', 'C:/film.html', 'a\nb']) {
    assert.equal(parseLink(none), null, JSON.stringify(none));
  }
});

test('#t= is a moment or a stretch that ends after it starts', () => {
  assert.deepEqual(timeOf('t=12.5'), { at: 12.5 });
  assert.deepEqual(timeOf('t=3,6'), { start: 3, end: 6 });
  assert.equal(timeOf('t=6,3'), null);
  assert.equal(timeOf('t=-1'), null);
  assert.equal(timeOf('t=abc'), null);
  assert.equal(timeOf('s3'), null);
  assert.equal(timeOf(null), null);
});

test('a pattern names whole paths: * in a name, ** across folders, ? one character', () => {
  assert.equal(matchesPattern('film.html', 'film.html'), true);
  assert.equal(matchesPattern('film.html', 'scenes/film.html'), false);
  assert.equal(matchesPattern('.film/canvases/*.json', '.film/canvases/b.json'), true);
  assert.equal(matchesPattern('.film/canvases/*.json', '.film/canvases/x/b.json'), false);
  assert.equal(matchesPattern('**/*.cube', 'grade.cube'), true);
  assert.equal(matchesPattern('**/*.cube', 'assets/looks/grade.cube'), true);
  assert.equal(matchesPattern('assets/**', 'assets/a/b.mp4'), true);
  assert.equal(matchesPattern('take?.mp4', 'take1.mp4'), true);
  assert.equal(matchesPattern('take?.mp4', 'take12.mp4'), false);
  /* what a regular expression would read is read as it is written */
  assert.equal(matchesPattern('a+b(1).json', 'a+b(1).json'), true);
  assert.equal(matchesPattern('a.json', 'abjson'), false);
});

const CLAIMS: Array<[string, string[]]> = [['edit', ['film.html']], ['canvas', ['.film/canvas.json', '.film/canvases/*.json']], ['color', ['**/*.cube']], ['looks', ['assets/looks/*.cube']]];
const ON = ['edit', 'canvas', 'color', 'looks'];

test('the workbench that shows a file is the one on whose pattern names it most closely', () => {
  assert.equal(claimantOf('film.html', CLAIMS, ON), 'edit');
  assert.equal(claimantOf('.film/canvases/b.json', CLAIMS, ON), 'canvas');
  assert.equal(claimantOf('assets/grade.cube', CLAIMS, ON), 'color');
  assert.equal(claimantOf('assets/looks/warm.cube', CLAIMS, ON), 'looks');
  assert.equal(claimantOf('assets/looks/warm.cube', CLAIMS, ['edit', 'color']), 'color');
  assert.equal(claimantOf('film.html', CLAIMS, ['canvas']), null);
  assert.equal(claimantOf('assets/a.mp4', CLAIMS, ON), null);
  /* a tie: the first that said it */
  assert.equal(claimantOf('film.html', [['edit', ['film.html']], ['other', ['film.html']]], ['edit', 'other']), 'edit');
});

test('a link goes to the workbench that shows its file, told the link; a file no workbench shows goes to the library', () => {
  assert.deepEqual(routeLink('./film.html#t=3,6', CLAIMS, ON), { workbench: 'edit', link: 'film.html#t=3,6' });
  assert.deepEqual(routeLink('.film/canvas.json#n1', CLAIMS, ON), { workbench: 'canvas', link: '.film/canvas.json#n1' });
  assert.deepEqual(routeLink('assets/a.mp4', CLAIMS, ON), { file: 'assets/a.mp4' });
  assert.deepEqual(routeLink('film.html#s3', CLAIMS, ['canvas']), { file: 'film.html' });
  assert.equal(routeLink('https://openfilm.dev', CLAIMS, ON), null);
});

test('the edit shows a link to the film as the command it stands for', () => {
  assert.deepEqual(filmCommandOf('s3'), { type: 'select-clip', id: 's3', loc: 'film.html#s3', seek: true });
  assert.deepEqual(filmCommandOf('0.2'), { type: 'select-clip', id: '0.2', loc: 'film.html#0.2', seek: true });
  assert.deepEqual(filmCommandOf('t=12.5'), { type: 'seek', time: 12.5 });
  assert.deepEqual(filmCommandOf('t=3,6'), { type: 'show-range', start: 3, end: 6 });
  /* a part of the picture at a moment, as a media fragment writes it, either part first */
  assert.deepEqual(filmCommandOf('t=12.5&xywh=640,200,320,180'), { type: 'show-box', time: 12.5, box: { x: 640, y: 200, w: 320, h: 180 } });
  assert.deepEqual(filmCommandOf('xywh=pixel:0,0,10.5,20&t=3,6'), { type: 'show-box', time: 3, box: { x: 0, y: 0, w: 10.5, h: 20 } });
  assert.deepEqual(filmCommandOf('t=4&xywh=1,2,0,5'), { type: 'seek', time: 4 }, 'a box of no size is the moment');
  assert.equal(filmCommandOf('xywh=1,2,3,4'), null, 'a box with no moment is no place on the film');
  assert.equal(filmCommandOf('t=6,3'), null);
  assert.equal(filmCommandOf(null), null);
});

test('the app\'s commands that name a thing are the links they stand for, and come back as the same command', () => {
  const pairs: Array<[StudioCommand, string]> = [
    [{ type: 'select-clip', id: 's3', loc: 'film.html#1.0', seek: true }, 'film.html#s3'],
    [{ type: 'select-clip', id: null, loc: 'film.html#1.0', seek: true }, 'film.html#1.0'],
    [{ type: 'seek', time: 12.5 }, 'film.html#t=12.5'],
    [{ type: 'show-range', start: 3, end: 6 }, 'film.html#t=3,6'],
    [{ type: 'show-box', time: 12.5, box: { x: 640, y: 200, w: 320, h: 180 } }, 'film.html#t=12.5&xywh=640,200,320,180'],
    [{ type: 'show-node', id: 'n1' }, '.film/canvas.json#n1'],
    [{ type: 'show-file', path: 'assets/a #1.mp4' }, 'assets/a %231.mp4'],
  ];
  for (const [command, link] of pairs) assert.equal(linkOfCommand(command), link, command.type);
  assert.deepEqual(filmCommandOf(parseLink('film.html#t=12.5&xywh=640,200,320,180')!.fragment), pairs[4]![0]);
  assert.deepEqual(parseLink('assets/a %231.mp4'), { path: 'assets/a #1.mp4', fragment: null });
  assert.deepEqual(filmCommandOf(parseLink(linkOfCommand({ type: 'seek', time: 1 / 3 })!)!.fragment), { type: 'seek', time: 0.333333 });
  /* a stretch given end first is the same stretch; one of no length is its moment, as the edit shows it */
  assert.equal(linkOfCommand({ type: 'show-range', start: 6, end: 3 }), 'film.html#t=3,6');
  assert.equal(linkOfCommand({ type: 'show-range', start: 4, end: 4 }), 'film.html#t=4');
  /* the others are the edit's as they were */
  for (const command of [
    { type: 'select-clip', id: 's3', seek: false },
    { type: 'select-clip', id: null, loc: null, seek: true },
    { type: 'show-track', track: 1 },
    { type: 'highlight', ref: null },
    { type: 'seek', time: Number.NaN },
  ] as StudioCommand[]) assert.equal(linkOfCommand(command), null, JSON.stringify(command));
});
