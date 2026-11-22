import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadName, isLocalHost, navigation, permission, permissionKeys, plainUserAgent, popupGate, readAnswers, request, riskyDownload, shownAddress, siteOf, typedAddress } from './browser-policy.mjs';

const hostOf = (address) => new URL(address).hostname;

test('this computer and its network are told from the web, however the address is written', () => {
  for (const local of ['http://localhost/', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://0.0.0.0/',
    'http://10.1.2.3/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://100.64.0.1/',
    'http://[::1]/', 'http://[::]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:c0a8:101]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    'http://app.localhost/', 'http://printer.local/', 'http://nas.lan/', 'http://router/', 'http://LOCALHOST./']) {
    assert.equal(isLocalHost(hostOf(local)), true, local);
  }
  for (const web of ['https://example.com/', 'http://8.8.8.8/', 'http://172.32.0.1/', 'http://100.128.0.1/', 'http://[2606:4700::1111]/', 'https://localhost.example.com/', 'https://local/x'.replace('local/', 'local.example/')]) {
    assert.equal(isLocalHost(hostOf(web)), false, web);
  }
});

test('a tab loads the web, hands other apps\' links to the person, and refuses the rest', () => {
  assert.equal(navigation('https://example.com/a?b#c'), 'load');
  assert.equal(navigation('http://localhost:5173/'), 'load');
  assert.equal(navigation('about:blank'), 'load');
  assert.equal(navigation('mailto:someone@example.com'), 'outside');
  assert.equal(navigation('tel:+15550100'), 'outside');
  for (const refused of ['file:///etc/passwd', 'openfilm://community/x', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'chrome://settings', 'devtools://devtools/x',
    'view-source:https://example.com', 'blob:https://example.com/1', 'about:config', 'ftp://example.com/', 'smb://server/share', 'x-apple.systempreferences:', 'not an address']) {
    assert.equal(navigation(refused), 'refuse', refused);
  }
});

test('typed text is an address, a host, or a search', () => {
  assert.equal(typedAddress('https://example.com/a b'), 'https://example.com/a%20b');
  assert.equal(typedAddress('example.com'), 'https://example.com/');
  assert.equal(typedAddress('  example.com/path?q=1  '), 'https://example.com/path?q=1');
  assert.equal(typedAddress('localhost:3000'), 'http://localhost:3000/');
  assert.equal(typedAddress('127.0.0.1:8080/x'), 'http://127.0.0.1:8080/x');
  assert.equal(typedAddress('192.168.1.10'), 'http://192.168.1.10/');
  assert.equal(typedAddress('how to color grade'), 'https://www.bing.com/search?q=how%20to%20color%20grade');
  assert.equal(typedAddress('what is 3.5mm'), 'https://www.bing.com/search?q=what%20is%203.5mm');
  assert.equal(typedAddress('file:///etc/passwd'), null);
  assert.equal(typedAddress('javascript://example.com/%0aalert(1)'), null);
  assert.equal(typedAddress(''), null);
  /* a name in look-alike letters goes to its encoded host, which the address field then shows */
  assert.equal(typedAddress('аpple.com'), 'https://xn--pple-43d.com/');
});

test('the address shown is the tab\'s own, its host encoded and any name and password left out', () => {
  assert.deepEqual(shownAddress('https://bank.example@evil.example/login'), { text: 'https://evil.example/login', host: 'evil.example', state: 'secure' });
  assert.equal(shownAddress('https://аpple.com/').host, 'xn--pple-43d.com');
  assert.equal(shownAddress('http://example.com/').state, 'insecure');
  assert.equal(shownAddress('http://localhost:3000/').state, 'local');
  assert.deepEqual(shownAddress('about:blank'), { text: '', host: '', state: 'none' });
});

test('the app\'s own servers are never reached; this computer and its network only by going there', () => {
  const own = ['http://127.0.0.1:4848', 'http://127.0.0.1:51234'];
  /* Studio and the agents\' doors: not as a page, not from a page, by no name for this computer */
  for (const address of ['http://127.0.0.1:4848/', 'http://localhost:4848/api/projects', 'http://[::1]:4848/', 'http://0.0.0.0:51234/secret/notion', 'ws://127.0.0.1:4848/live', 'http://anything.localhost:4848/']) {
    assert.equal(request({ url: address, type: 'mainFrame', top: null, own }), 'block', address);
    assert.equal(request({ url: address, type: 'xhr', top: 'http://localhost:3000/', own }), 'block', address);
  }
  /* a dev server the person goes to, and what its page asks of this computer */
  assert.equal(request({ url: 'http://localhost:3000/', type: 'mainFrame', own }), 'allow');
  assert.equal(request({ url: 'http://localhost:3000/api', type: 'xhr', top: 'http://localhost:3000/', own }), 'allow');
  assert.equal(request({ url: 'ws://localhost:3000/hmr', type: 'webSocket', top: 'http://localhost:3000/', own }), 'allow');
  /* a page of the web asking this computer or its network: a script, a picture, a frame, a socket */
  for (const type of ['xhr', 'image', 'script', 'subFrame', 'webSocket', 'ping', 'other']) {
    assert.equal(request({ url: 'http://192.168.1.1/admin', type, top: 'https://evil.example/', own }), 'block', type);
    assert.equal(request({ url: 'http://localhost:3000/', type, top: 'https://evil.example/', own }), 'block', type);
  }
  assert.equal(request({ url: 'http://localhost:3000/', type: 'xhr', top: null, own }), 'block');
  /* the web itself */
  assert.equal(request({ url: 'https://cdn.example/x.js', type: 'script', top: 'https://example.com/', own }), 'allow');
  assert.equal(request({ url: 'https://example.com:4848/', type: 'mainFrame', own }), 'allow');
  assert.equal(request({ url: 'data:image/png;base64,AA==', type: 'image', top: 'https://example.com/', own }), 'allow');
  assert.equal(request({ url: 'file:///etc/passwd', type: 'xhr', top: 'https://example.com/', own }), 'block');
});

test('a permission is refused unless listed; what reaches the person is asked, of a page that came safely', () => {
  const page = { site: 'https://example.com', mainFrame: true, secure: true };
  assert.equal(permission('clipboard-sanitized-write', page), 'allow');
  for (const asked of ['media', 'notifications', 'clipboard-read']) assert.equal(permission(asked, page), 'ask', asked);
  for (const refused of ['openExternal', 'geolocation', 'fullscreen', 'display-capture', 'midi', 'midiSysex', 'hid', 'serial', 'usb', 'fileSystem', 'idle-detection', 'window-management', 'keyboardLock', 'storage-access', 'top-level-storage-access', 'unknown', 'something-new']) {
    assert.equal(permission(refused, page), 'deny', refused);
  }
  assert.equal(permission('media', { ...page, mainFrame: false }), 'deny');
  assert.equal(permission('media', { ...page, secure: false }), 'deny');
  assert.equal(permission('clipboard-sanitized-write', { ...page, site: null }), 'deny');
  assert.deepEqual(permissionKeys('media', { mediaTypes: ['video', 'audio'] }), ['camera', 'microphone']);
  assert.deepEqual(permissionKeys('media', { mediaTypes: ['audio'] }), ['microphone']);
  assert.deepEqual(permissionKeys('media', { mediaType: 'video' }), ['camera']);
  assert.deepEqual(permissionKeys('media', {}), ['camera', 'microphone']);
  assert.deepEqual(permissionKeys('notifications'), ['notifications']);
});

test('answers kept on disk are read back only where they are answers', () => {
  assert.deepEqual(readAnswers({
    'https://example.com': { camera: 'allow', microphone: 'deny', usb: 'allow', geolocation: 'allow', notifications: 'maybe' },
    'https://example.com/path': { camera: 'allow' },
    'file:///x': { camera: 'allow' },
    'http://localhost:3000': { notifications: 'allow' },
  }), { 'https://example.com': { camera: 'allow', microphone: 'deny' }, 'http://localhost:3000': { notifications: 'allow' } });
  assert.deepEqual(readAnswers(null), {});
  assert.deepEqual(readAnswers([1, 2]), {});
  assert.equal(siteOf('https://example.com:8443/a?b'), 'https://example.com:8443');
  assert.equal(siteOf('about:blank'), null);
});

test('a download keeps a plain file name, and one that can run is known', () => {
  assert.equal(downloadName('../../.ssh/authorized_keys'), '_.._.ssh_authorized_keys');
  assert.equal(downloadName('.bashrc'), 'bashrc');
  assert.equal(downloadName('report.pdf. . .'), 'report.pdf');
  assert.equal(downloadName('a‮fdp.exe'), 'a_fdp.exe');
  assert.equal(downloadName(''), 'download');
  assert.equal(downloadName(`${'x'.repeat(300)}.mp4`).length, 200);
  assert.ok(downloadName(`${'x'.repeat(300)}.mp4`).endsWith('.mp4'));
  for (const runs of ['setup.exe', 'Tool.dmg', 'install.pkg', 'run.command', 'a.SH', 'x.jar', 'photo.jpg.scr']) assert.equal(riskyDownload(runs), true, runs);
  for (const plain of ['clip.mp4', 'photo.jpg', 'notes.pdf', 'archive.zip', 'font.woff2', 'noext']) assert.equal(riskyDownload(plain), false, plain);
});

test('a page opens a few tabs, not a flood', () => {
  let at = 0;
  const may = popupGate({ burst: 2, withinMs: 1000, most: 5, now: () => at });
  assert.equal(may(1), true);
  assert.equal(may(2), true);
  assert.equal(may(3), false);
  at = 1500;
  assert.equal(may(3), true);
  assert.equal(may(5), false);
});

test('sites are told Chrome, not the app or Electron', () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) OpenFilm/0.4.1 Chrome/152.0.0.0 Electron/44.9.3 Safari/537.36';
  assert.equal(plainUserAgent(ua), 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
  assert.equal(plainUserAgent(ua.replace('OpenFilm/0.4.1', 'OpenFilmDev/0.4.1-beta.2')), plainUserAgent(ua));
});
