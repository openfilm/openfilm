import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPluginPages } from './plugin-pages.mjs';
import { networkOf } from '../../src/skills.mjs';

const byLanguage = (/** @type {unknown} */ v) => (v && typeof v === 'object' ? /** @type {Record<string, string>} */ (v) : typeof v === 'string' ? { en: v } : {});

test('a plugin\'s page reaches nothing on the network but the hosts it declares, nor does a page of the project under it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-plugin-pages-'));
  const folder = join(root, 'plugin'), project = join(root, 'film');
  mkdirSync(folder); mkdirSync(project);
  writeFileSync(join(folder, 'index.html'), '<p>plugin</p>');
  writeFileSync(join(project, 'film.html'), '<p>film</p>');
  const pages = await startPluginPages({ port: 0, secret: 'k', mayWrite: () => false });
  try {
    const quiet = pages.surface({ uid: 'local/quiet', source: 'mine', folder, page: 'index.html' }, { id: 'p1', path: project });
    const page = await fetch(quiet.page);
    const policy = page.headers.get('content-security-policy') ?? '';
    assert.match(policy, /connect-src 'self';/);
    assert.match(policy, /default-src 'self';/);
    assert.doesNotMatch(policy, /https:/, 'declares none: reaches none');
    /* the project's pages, read through the plugin's grant, are held to the same */
    const film = await fetch(`${quiet.project}film.html`);
    assert.match(film.headers.get('content-security-policy') ?? '', /connect-src 'self';/);

    const said = pages.surface({ uid: 'local/loud', source: 'mine', folder, page: 'index.html', network: { domains: ['api.example.com', '*.cdn.example.org'] } });
    const loud = (await fetch(said.page)).headers.get('content-security-policy') ?? '';
    assert.match(loud, /connect-src 'self' https:\/\/api\.example\.com https:\/\/\*\.cdn\.example\.org;/);
    /* a second request is not held to the first one's hosts: each answer has its own */
    assert.doesNotMatch((await fetch(quiet.page)).headers.get('content-security-policy') ?? '', /example/);
  } finally {
    await pages.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('the hosts a plugin declares are host names over https, at most twenty; anything else is left out', () => {
  assert.equal(networkOf(undefined, byLanguage), undefined);
  assert.equal(networkOf({ network: { domains: [] } }, byLanguage), undefined);
  assert.deepEqual(networkOf({ network: { domains: ['API.example.com', 'api.example.com', 'https://x.com', 'x.com/path', '*', '*.ok.io', 'localhost', '1.2.3.4'], why: 'presets' } }, byLanguage),
    { domains: ['api.example.com', '*.ok.io'], why: { en: 'presets' } });
  assert.equal(networkOf({ network: { domains: Array.from({ length: 30 }, (_, i) => `h${i}.example.com`) } }, byLanguage)?.domains.length, 20);
});
