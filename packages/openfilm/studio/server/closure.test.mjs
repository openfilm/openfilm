import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { filmClosure, folderView, projectFiles, projectPath } from './closure.mjs';

/** A folder with these files (path → text). */
function folder(files) {
  const root = mkdtempSync(join(tmpdir(), 'of-closure-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const FILM = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<link rel="stylesheet" href="look/film.css">
</head>
<body>
<section>
  <video src="assets/v.mp4#t=1,2" at="0"></video>
  <img src="img/p%20one.png" at="2">
  <iframe src="scenes/s1.html" at="4"></iframe>
  <iframe src="https://example.com/page.html" at="9"></iframe>
</section>
<section>
  <audio src="vo/a.mp3" at="0"></audio>
</section>
</body>
</html>
`;

const PAGE = `<!doctype html>
<html><head>
<script type="importmap">{ "imports": { "three": "../vendor/three.js", "three/addons/": "../vendor/jsm/" } }</script>
<script type="module" src="s1.js"></script>
<style>@font-face { font-family: X; src: url("../fonts/x.woff2") } .bg { background: url(data:image/png;base64,AAAA) }</style>
</head><body>
<img srcset="a.png 1x, b.png 2x" alt="a.png">
<div style="background-image: url('bg.png')"></div>
<a href="#top">top</a>
<!-- <img src="commented.png"> -->
<script type="module">
  import { ease } from './lib/ease.js';
  // fetch('nope.json') is a comment, but don't stop reading at its quote
  const plan = await fetch('data/plan.json').then((r) => r.json());
  const thumb = (n) => \`thumbs/\${n}.png\`;
  const any = (src) => \`\${src}\`;
  el.innerHTML = \`<video src="clips/\${name}.mp4"></video>\`;
</script>
</body></html>
`;

test('a film\'s closure: its clips, what its pages load, subtitles beside its media, Studio\'s state of it', async () => {
  const root = folder({
    'film.html': FILM,
    'look/film.css': '@import "base.css"; @font-face { src: url(../fonts/f.woff2) }',
    'look/base.css': 'body {}',
    'fonts/f.woff2': 'font',
    'fonts/x.woff2': 'font',
    'fonts/unused.woff2': 'font',
    'assets/v.mp4': 'video',
    'assets/v.vtt': 'WEBVTT',
    'assets/v.zh.vtt': 'WEBVTT',
    'assets/v.srt': '1',
    'assets/v-other.vtt': 'WEBVTT',
    'assets/w.mp4': 'another take',
    'img/p one.png': 'png',
    'vo/a.mp3': 'mp3',
    'vo/a.vtt': 'WEBVTT',
    'scenes/s1.html': PAGE,
    'scenes/s1.js': "import * as THREE from 'three';\nimport { Orbit } from 'three/addons/controls/Orbit.js';\nconst w = new URL('./worker.js', import.meta.url);\n",
    'scenes/worker.js': '',
    'scenes/lib/ease.js': "export * from './util.js';",
    'scenes/lib/util.js': '',
    'scenes/lib/unused.js': '',
    'scenes/data/plan.json': '{ "clips": ["clips/c1.png"] }',
    'scenes/clips/c1.png': 'png',
    'scenes/clips/hero.mp4': 'video',
    'scenes/thumbs/1.png': 'png',
    'scenes/thumbs/2.png': 'png',
    'scenes/thumbs/notes.txt': 'not a png',
    'scenes/a.png': 'png',
    'scenes/b.png': 'png',
    'scenes/bg.png': 'png',
    'scenes/notes.json': '{}',
    'scenes/make.py': 'print()',
    'scenes/old/x.html': 'an older page',
    'vendor/three.js': '',
    'vendor/jsm/controls/Orbit.js': '',
    'vendor/jsm/loaders/GLTF.js': '',
    'renders/f0001.exr': 'frame',
    'render.log': 'log',
    '.film/settings.json': '{}',
    '.film/markers.json': '[]',
    '.film/id': 'x',
    '.film/cache/frame.jpg': 'jpg',
  });
  const closure = await filmClosure(folderView(root));
  assert.deepEqual([...closure.keys()].sort(), [
    '.film/markers.json', '.film/settings.json',
    'assets/v.mp4', 'assets/v.srt', 'assets/v.vtt', 'assets/v.zh.vtt',
    'film.html', 'fonts/f.woff2', 'fonts/x.woff2', 'img/p one.png', 'look/base.css', 'look/film.css',
    'scenes/a.png', 'scenes/b.png', 'scenes/bg.png', 'scenes/clips/c1.png', 'scenes/clips/hero.mp4',
    'scenes/data/plan.json', 'scenes/lib/ease.js', 'scenes/lib/util.js', 'scenes/notes.json', 'scenes/s1.html', 'scenes/s1.js',
    'scenes/thumbs/1.png', 'scenes/thumbs/2.png', 'scenes/worker.js',
    'vendor/jsm/controls/Orbit.js', 'vendor/three.js',
    'vo/a.mp3', 'vo/a.vtt',
  ]);
  assert.equal(closure.get('assets/v.mp4'), 5, 'with its size');
  const all = await projectFiles(root);
  assert.ok(!all.has('.film/id') && all.has('render.log'), 'the folder\'s files, without Studio\'s own');
});

test('a folder without film.html holds no film', async () => {
  const root = folder({ 'a.html': 'a' });
  assert.equal((await filmClosure(folderView(root))).size, 0);
});

test('a reference made a project path, or nothing', () => {
  assert.equal(projectPath('../a%20b.png?x=1#t=2', 'scenes/one'), 'scenes/a b.png');
  assert.equal(projectPath('/lib/x.js', 'scenes'), 'lib/x.js');
  assert.equal(projectPath('../../out.png', 'scenes'), null, 'outside the folder');
  for (const ref of ['https://x.test/a.png', '//x.test/a.png', 'data:image/png;base64,AA', '#id', '', 'mailto:a@b']) assert.equal(projectPath(ref, ''), null, ref);
});
