/**
 * The app's browser, in an isolated app: what a web page is kept from, checked against the real thing. A site of the
 * web is played by `web.test`, a name Chromium is told to find on this computer (so the rules see a host of the web,
 * and nothing leaves the machine); a server on this computer by `localhost`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { filmHtml } from 'openfilm/film-doc';
import { DESKTOP, buildShell, prepare } from './app.mjs';
import { launcherEnvironment, loginShellEnvironment } from '../src/environment.mjs';

if (!process.argv.includes('--no-build')) buildShell();
const dir = join(DESKTOP, '.dev', `browser-${Date.now()}`);
prepare(dir);
/* the Browser workbench is off until the person turns it on */
writeFileSync(join(dir, 'home/prefs.json'), JSON.stringify({ plugins: { browser: true } }));
const film = join(dir, 'projects', 'empty');
mkdirSync(film);
writeFileSync(join(film, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks: [] }));

/* ── the sites ── */
const hits = { secret: 0, secure: 0 };
const page = (body) => `<!doctype html><meta charset="utf-8"><title>Test site</title><body>${body}`;
const site = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/secret') { hits.secret += 1; res.writeHead(200, { 'access-control-allow-origin': '*' }).end('secret'); return; }
  if (path === '/clip.txt') { res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="clip.txt"' }).end('a clip'); return; }
  if (path === '/tool.dmg') { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="tool.dmg"' }).end('not really'); return; }
  res.writeHead(200, { 'content-type': 'text/html' }).end(page('<h1>Hello</h1><a id="mail" href="mailto:someone@example.com">mail</a>'));
});
await new Promise((done) => site.listen(0, '127.0.0.1', done));
const port = site.address().port;
const certs = join(dir, 'certs');
mkdirSync(certs);
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=web.test', '-keyout', join(certs, 'key.pem'), '-out', join(certs, 'cert.pem')], { stdio: 'ignore' });
const secure = createSecureServer({ key: readFileSync(join(certs, 'key.pem')), cert: readFileSync(join(certs, 'cert.pem')) }, (_req, res) => { hits.secure += 1; res.end('never shown'); });
await new Promise((done) => secure.listen(0, '127.0.0.1', done));
const securePort = secure.address().port;

const { PATH } = await loginShellEnvironment();
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'), args: [DESKTOP, '--host-resolver-rules=MAP web.test 127.0.0.1'], cwd: DESKTOP,
  env: { ...launcherEnvironment(process.env, PATH), OPENFILM_DESKTOP_FLAVOR: 'bench', OPENFILM_BENCH_DIR: dir },
});
const until = async (what, find, ms = 15_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const found = await find();
    if (found) return found;
    if (Date.now() > end) throw new Error(`waited too long for ${what}`);
    await new Promise((done) => setTimeout(done, 100));
  }
};
const passed = [];
const check = (name) => { passed.push(name); console.log(`✔ ${name}`); };
try {
  await until('the window', () => app.context().pages().find((p) => p.url().startsWith('http://127.0.0.1:')));
  const run = JSON.parse(readFileSync(join(dir, 'home/run.json'), 'utf8'));
  assert.equal((await fetch(`${run.origin}/api/open`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-key': run.key }, body: JSON.stringify({ path: film, fallback: 0 }) })).status, 200);
  const studio = await until('the project', () => app.context().pages().find((p) => p.url().includes('/projects/')));
  await studio.waitForSelector('[data-prompt-editor]');
  const errors = [];
  studio.on('pageerror', (error) => errors.push(error.message));

  /* the system's dialogs answered by the test: what was asked is kept, the answer is `globalThis.browserAnswer` */
  await app.evaluate(({ dialog, session }, downloads) => {
    globalThis.browserAsked = [];
    globalThis.browserAnswer = { response: 1, checkboxChecked: false };
    dialog.showMessageBox = async (_window, options) => { globalThis.browserAsked.push(options); return globalThis.browserAnswer; };
    dialog.showMessageBoxSync = (_window, options) => { globalThis.browserAsked.push(options); return globalThis.browserAnswer.response; };
    /* a download is saved where the test says, in place of the system's panel */
    globalThis.browserDownloads = [];
    globalThis.saveDownloads = () => session.fromPartition('persist:openfilm-browser').on('will-download', (_event, item) => {
      const path = `${downloads}/${item.getFilename()}`;
      item.setSavePath(path);
      item.once('done', (_e, state) => globalThis.browserDownloads.push({ path, state }));
    });
  }, dir);

  /* the desktop's top bar: a tab for each workbench open, and `+` for the page that lists the others */
  await studio.locator('[data-workbench-tabs] [data-add-workbench]').click();
  await studio.locator('[data-mode-option="browser"]').click();
  const bench = studio.locator('[plugin="browser"]');
  await bench.waitFor();
  const field = bench.locator('input');
  const state = () => studio.evaluate(() => globalThis.openfilmNative.browser.state());
  const tab = async () => { const s = await state(); return s.tabs.find((t) => t.id === s.active) ?? null; };
  const go = async (text) => { await field.fill(text); await field.press('Enter'); };
  const webPage = (part) => until(`a page at ${part}`, () => app.context().pages().find((p) => p.url().includes(part)));

  /* ── a page of the web ── */
  await go(`http://web.test:${port}/`);
  const web = await webPage(`web.test:${port}`);
  await until('the page to settle', async () => (await tab())?.loading === false);
  assert.deepEqual((await tab()).address, { text: `http://web.test:${port}/`, host: 'web.test', state: 'insecure' });
  assert.equal(await field.inputValue(), `http://web.test:${port}/`);
  check('the address shown is the tab\'s own, and an unencrypted page of the web is said to be not secure');

  assert.deepEqual(await web.evaluate(() => [typeof globalThis.openfilmNative, typeof globalThis.require, typeof globalThis.process, typeof globalThis.openfilmHost]), ['undefined', 'undefined', 'undefined', 'undefined']);
  assert.doesNotMatch(await web.evaluate(() => navigator.userAgent), /Electron|OpenFilm/i);
  check('a web page has nothing of the app: no bridge, no Node, and is not told which app this is');

  const asked = (address) => web.evaluate((url) => fetch(url, { mode: 'no-cors' }).then(() => 'reached', () => 'refused'), address);
  assert.equal(await asked(`http://127.0.0.1:${port}/secret`), 'refused');
  assert.equal(await asked(`http://localhost:${port}/secret`), 'refused');
  assert.equal(await asked(`http://[::1]:${port}/secret`), 'refused');
  assert.equal(await web.evaluate((url) => new Promise((done) => { const img = new Image(); img.onload = () => done('reached'); img.onerror = () => done('refused'); img.src = url; }), `http://127.0.0.1:${port}/secret`), 'refused');
  assert.equal(hits.secret, 0);
  assert.equal(await asked(`${run.origin}/api/projects`), 'refused');
  assert.equal(await asked(`http://web.test:${port}/secret`), 'reached');
  assert.equal(hits.secret, 1);
  check('a page of the web reaches neither this computer nor Studio; its own site it does');

  /* ── kept apart from Studio's own storage ── */
  await web.evaluate(() => { document.cookie = 'seen=1; max-age=600'; });
  const cookies = await app.evaluate(async ({ session }) => ({
    browser: (await session.fromPartition('persist:openfilm-browser').cookies.get({ name: 'seen' })).length,
    studio: (await session.defaultSession.cookies.get({ name: 'seen' })).length,
  }));
  assert.deepEqual(cookies, { browser: 1, studio: 0 });
  check('what a site keeps is in the browser\'s own session, not Studio\'s');

  /* ── where it is drawn: the room the workbench leaves, and out of the way of anything over it ── */
  const viewOf = () => app.evaluate(({ BaseWindow }, part) => {
    const view = BaseWindow.getAllWindows()[0].contentView.children.find((child) => child.webContents?.getURL().includes(part));
    return view ? { ...view.getBounds(), visible: view.getVisible() } : null;
  }, `web.test:${port}`);
  const room = await bench.locator('.room').boundingBox();
  await until('the page to be placed', async () => (await viewOf())?.visible);
  const placed = await viewOf();
  assert.deepEqual([placed.x, placed.y, placed.width, placed.height], [room.x, room.y, room.width, room.height].map(Math.round));
  await studio.evaluate(() => { const over = document.createElement('div'); over.id = 'over-room'; over.style.cssText = 'position:fixed;right:40px;bottom:40px;width:200px;height:120px;z-index:99999;background:#333'; document.body.append(over); });
  await until('the page to step aside', async () => !(await viewOf())?.visible);
  await studio.evaluate(() => document.getElementById('over-room').remove());
  await until('the page to come back', async () => (await viewOf())?.visible);
  check('the page is drawn in the workbench\'s room, and steps aside while anything of Studio\'s lies over it');

  /* ── addresses that are not the web's ── */
  for (const refused of ['file:///etc/passwd', 'openfilm://community/x', `${run.origin}/`, `http://localhost:${new URL(run.origin).port}/api/projects`]) {
    await studio.evaluate((text) => globalThis.openfilmNative.browser.go(null, text), refused);
    await until(`${refused} to be refused`, async () => (await tab())?.failed?.code === 'refused');
  }
  assert.equal(await bench.locator('.note h2').count(), 1);
  check('files, the app\'s own links and Studio\'s address are refused, and the workbench says so');

  /* ── a certificate that does not check ── */
  await go(`https://web.test:${securePort}/`);
  const failed = await until('the certificate to be refused', async () => { const t = await tab(); return typeof t?.failed?.code === 'number' ? t.failed : null; });
  assert.ok(failed.code <= -200 && failed.code >= -219, `a certificate error, not ${failed.code} ${failed.text}`);
  assert.equal(hits.secure, 0);
  check(`a certificate that does not check stops the page (${failed.text}), with no way round`);

  /* ── windows a page opens ── */
  await go(`http://web.test:${port}/`);
  const opener = await until('the page again', async () => { const t = await tab(); return t?.loading === false && !t.failed ? app.context().pages().find((p) => p.url().includes(`web.test:${port}`)) : null; });
  await opener.evaluate((url) => { for (let i = 0; i < 9; i++) window.open(`${url}?popup=${i}`); window.open('file:///etc/passwd'); }, `http://web.test:${port}/`);
  await new Promise((done) => setTimeout(done, 800));
  const tabsNow = (await state()).tabs;
  assert.equal(tabsNow.length, 4, 'three windows became tabs, the rest were refused');
  assert.equal(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length), 1);
  assert.ok(tabsNow.every((t) => !t.address.text.startsWith('file:')));
  check('windows a page opens become tabs, three at most at a time, and never a window of their own');
  for (const t of tabsNow.slice(1)) await studio.evaluate((id) => globalThis.openfilmNative.browser.close(id), t.id);

  /* ── permissions ── */
  const main = await until('the first tab', () => app.context().pages().find((p) => p.url() === `http://web.test:${port}/`));
  const dialogs = () => app.evaluate(() => globalThis.browserAsked.length);
  const before = await dialogs();
  assert.equal(await main.evaluate(() => Notification.requestPermission()), 'denied');
  /* Chromium gives an unencrypted page of the web no way to the camera or the microphone at all */
  assert.equal(await main.evaluate(() => typeof navigator.mediaDevices), 'undefined');
  assert.equal(await dialogs(), before, 'a page that came unencrypted is refused without the person being asked');
  await go(`http://localhost:${port}/`);
  const local = await webPage(`localhost:${port}`);
  await until('the local page', async () => (await tab())?.address.state === 'local');
  assert.equal(await local.evaluate(() => Notification.requestPermission()), 'denied');
  const question = (await app.evaluate(() => globalThis.browserAsked.at(-1)));
  assert.equal(await dialogs(), before + 1);
  assert.match(question.message, /localhost/);
  assert.equal(question.detail, `http://localhost:${port}`);
  assert.equal(question.defaultId, 1, 'the answer under the Return key is no');
  /* said no without "remember": not asked again by this page */
  assert.equal(await local.evaluate(() => Notification.requestPermission()), 'denied');
  assert.equal(await dialogs(), before + 1);
  /* yes, remembered */
  await local.reload();
  await app.evaluate(() => { globalThis.browserAnswer = { response: 0, checkboxChecked: true }; });
  assert.equal(await local.evaluate(() => Notification.requestPermission()), 'granted');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'data/browser/permissions.json'), 'utf8')), { [`http://localhost:${port}`]: { notifications: 'allow' } });
  for (const never of ['geolocation', 'midi']) {
    assert.equal(await local.evaluate((name) => navigator.permissions.query({ name }).then((s) => s.state, () => 'denied'), never), 'denied', never);
  }
  assert.equal(await local.evaluate(() => navigator.usb ? navigator.usb.getDevices().then((d) => d.length) : 0), 0);
  check('a permission is the person\'s to give, site by site, in the system\'s own dialog; no is the default, and what is not on the list is refused unasked');

  /* ── a page that asks to stay ── */
  /* the app answers the page's question itself: told to the test, so Playwright does not try to answer it too */
  const stays = [];
  local.on('dialog', (asked) => { stays.push(asked.type()); });
  await local.click('h1');
  await local.evaluate(() => { window.onbeforeunload = (event) => { event.preventDefault(); return 'stay'; }; });
  await go(`http://localhost:${port}/?left`);
  await until('the tab to leave', async () => (await tab())?.address.text.endsWith('?left'));
  assert.deepEqual(stays, ['beforeunload'], 'the page did ask to stay');
  check('a page that asks to stay does not hold its tab');

  /* ── a link for another app ── */
  await app.evaluate(({ shell }) => { globalThis.browserAnswer = { response: 1, checkboxChecked: false }; globalThis.openedOutside = []; shell.openExternal = async (url) => { globalThis.openedOutside.push(url); }; });
  const asksBefore = await dialogs();
  await local.evaluate(() => { document.getElementById('mail').click(); });
  await until('the question', async () => (await dialogs()) === asksBefore + 1);
  assert.equal((await app.evaluate(() => globalThis.browserAsked.at(-1))).detail, 'mailto:someone@example.com');
  assert.deepEqual(await app.evaluate(() => globalThis.openedOutside), []);
  check('a link for another app is opened only once the person says so');

  /* ── downloads ── */
  await app.evaluate(() => { globalThis.saveDownloads(); globalThis.browserAnswer = { response: 1, checkboxChecked: false }; });
  await studio.evaluate((url) => globalThis.openfilmNative.browser.go(null, url), `http://localhost:${port}/tool.dmg`);
  await until('the warning', async () => /tool\.dmg/.test((await app.evaluate(() => globalThis.browserAsked.at(-1)))?.message ?? ''));
  await new Promise((done) => setTimeout(done, 500));
  assert.equal(existsSync(join(dir, 'tool.dmg')), false);
  await studio.evaluate((url) => globalThis.openfilmNative.browser.go(null, url), `http://localhost:${port}/clip.txt`);
  await until('the download', async () => (await app.evaluate(() => globalThis.browserDownloads)).some((d) => d.state === 'completed'));
  assert.equal(readFileSync(join(dir, 'clip.txt'), 'utf8'), 'a clip');
  await until('the workbench to say so', async () => (await state()).downloads.some((d) => d.name === 'clip.txt' && d.state === 'completed'));
  let quarantined = 'not macOS';
  if (process.platform === 'darwin') {
    try { quarantined = execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', join(dir, 'clip.txt')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() ? 'marked as downloaded' : 'not marked'; } catch { quarantined = 'not marked'; }
  }
  if (process.platform === 'darwin') assert.equal(quarantined, 'marked as downloaded');
  check(`a file that can run is kept only on the person's word; a download lands where they pick, marked as come from the web (${quarantined})`);

  await studio.screenshot({ path: join(dir, 'workbench.png') });
  assert.deepEqual(errors, []);
  console.log(`\n${passed.length} checks passed. Pictures and data: ${dir}`);
} finally {
  await app.close().catch(() => {});
  site.close();
  secure.close();
}
