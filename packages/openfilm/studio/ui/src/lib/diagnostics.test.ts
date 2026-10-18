import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserLines, fullReport, type PageFacts } from './diagnostics.ts';

const chrome: PageFacts = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chromium: true,
  webgl: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
  framed: false,
  cookies: true,
  storage: true,
  screen: '1512×982, window 1512×900 @2x',
};

test('a Chromium browser with WebGL and storage has nothing to fix', () => {
  const lines = browserLines(chrome);
  assert.ok(lines.some((l) => l.startsWith('✓ Engine') && l.includes('Chromium')));
  assert.ok(!lines.some((l) => l.startsWith('✗')));
  assert.ok(!lines.includes('To fix:'));
});

test('an agent\'s preview pane: another engine, no WebGL, blocked storage, each with what to do', () => {
  const lines = browserLines({ ...chrome, chromium: false, webgl: null, framed: true, storage: false });
  assert.ok(lines.some((l) => l.startsWith('✗ Engine')));
  assert.ok(lines.some((l) => l.startsWith('✗ WebGL') && l.includes('unavailable')));
  assert.ok(lines.some((l) => l.startsWith('✗ Storage') && l.includes('site data blocked, inside another page')));
  const fixes = lines.slice(lines.indexOf('To fix:') + 1);
  assert.equal(fixes.length, 3);
  assert.match(fixes[0], /Chrome, Edge or the desktop app/);
});

test('the whole report: the computer\'s, the browser\'s, then the app\'s when there is one', () => {
  const text = fullReport('OpenFilm doctor\n\n✓ Node      v22', chrome, 'OpenFilm desktop 0.1.8');
  const parts = text.split('\n\n────────\n\n');
  assert.equal(parts.length, 3);
  assert.match(parts[0], /^OpenFilm doctor/);
  assert.match(parts[1], /^Browser Studio is open in/);
  assert.equal(parts[2], 'OpenFilm desktop 0.1.8');
  assert.equal(fullReport('x', chrome, null).split('────────').length, 2);
});
