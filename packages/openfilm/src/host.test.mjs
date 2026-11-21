import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilmPage, launch, listenLocal, presentsVideo, serve, vulkanFirst } from './host.mjs';
import { locate } from './shared.mjs';

test('analysis fingerprints distinguish replaced media even when its name, size and modified date match', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-media-identity-')), file = join(root,'v.mp4');
  writeFileSync(file, 'first'); const site = await serve(root);
  try {
    const identity = async () => (await fetch(`${site.url}/v.mp4`,{method:'HEAD'})).headers.get('x-openfilm-media-id');
    const original = await identity(), { atime, mtime } = fs.statSync(file);
    assert.match(original,/^[0-9a-f]{64}$/); assert.equal(await identity(),original);
    const replacement = join(root,'next.mp4'); writeFileSync(replacement,'other'); fs.utimesSync(replacement,atime,mtime); fs.renameSync(replacement,file);
    assert.notEqual(await identity(),original);
  } finally { await site.close(); rmSync(root,{recursive:true,force:true}); }
});

test('cancelled media requests close their files so the project can be renamed', { timeout: 10000 }, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-host-cancel-'));
  const root = join(scratch, 'film');
  mkdirSync(root);
  const data = Buffer.alloc(16 * 1024 * 1024);
  data.write('0123456789');
  writeFileSync(join(root, 'video.mp4'), data);
  const streams = [];
  const create = fs.createReadStream;
  const mocked = t.mock.method(fs, 'createReadStream', (...args) => {
    const stream = create(...args);
    streams.push(stream);
    return stream;
  });
  syncBuiltinESMExports();
  const site = await serve(root);
  try {
    const head = await fetch(`${site.url}/video.mp4`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(streams.length, 0, 'HEAD opens no file stream');
    const part = await fetch(`${site.url}/video.mp4`, { headers: { range: 'bytes=0-7' } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), '01234567');
    for (const range of [undefined, 'bytes=0-']) {
      await new Promise((done, fail) => {
        const req = get(`${site.url}/video.mp4`, { headers: range ? { range } : {} }, (res) => {
          res.on('error', () => {});
          res.once('data', () => { res.destroy(); done(); });
        });
        req.on('error', fail);
      });
      const stream = streams.at(-1);
      if (!stream.closed) await new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error('cancelled request left its file open')), 1500);
        stream.once('close', () => { clearTimeout(timer); done(); });
      });
      assert.equal(stream.closed, true, `${range ?? 'full'} request releases its file`);
    }
    await fs.promises.rename(root, join(scratch, 'renamed'));
    assert.equal(fs.existsSync(join(scratch, 'renamed', 'video.mp4')), true);
  } finally {
    for (const stream of streams) {
      stream.destroy();
      if (!stream.closed) await once(stream, 'close');
    }
    await site.close();
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test('a port the OS hands out that browsers refuse (ERR_UNSAFE_PORT) is let go for another; a port asked for is kept', async () => {
  const fake = (/** @type {number[]} */ handed) => {
    const server = Object.assign(new EventEmitter(), {
      asked: /** @type {number[]} */ ([]), port: 0,
      listen(/** @type {number} */ port, /** @type {string} */ _host, /** @type {() => void} */ done) {
        server.asked.push(port);
        server.port = port || /** @type {number} */ (handed.shift());
        setImmediate(done);
      },
      address: () => ({ port: server.port }),
      close(/** @type {() => void} */ done) { setImmediate(done); },
    });
    return server;
  };
  const any = fake([3659, 6000, 51234]);
  assert.equal(await listenLocal(/** @type {any} */ (any)), 51234);
  assert.deepEqual(any.asked, [0, 0, 0]);
  const chosen = fake([]);
  assert.equal(await listenLocal(/** @type {any} */ (chosen), 3659), 3659);
  assert.deepEqual(chosen.asked, [3659]);
});

test('an open-ended media range returns at most 2 MiB', async () => {
  const cap = 2 * 1024 * 1024;
  const dir = mkdtempSync(join(tmpdir(), 'of-host-range-'));
  const data = Buffer.alloc(cap + 2, '0123456789');
  writeFileSync(join(dir, 'video.mp4'), data);
  const site = await serve(dir);
  try {
    const res = await fetch(`${site.url}/video.mp4`, { headers: { range: 'bytes=1-' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-length'), String(cap));
    assert.equal(res.headers.get('content-range'), `bytes 1-${cap}/${data.length}`);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), data.subarray(1, cap + 1));
  } finally {
    await site.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the served folder is all a page reads: no way out through .., a link or a malformed address', { skip: process.platform === 'win32' && 'links need Developer Mode on Windows' }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-host-'));
  const root = join(scratch, 'film');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'assets', 'a.txt'), 'mine');
  writeFileSync(join(scratch, 'secret.txt'), 'secret');
  /* a film from elsewhere can bring links to anywhere: to a file, and to a folder above it */
  symlinkSync(join(scratch, 'secret.txt'), join(root, 'assets', 'notes.txt'));
  symlinkSync(scratch, join(root, 'assets', 'up'));
  /* a link that stays inside is followed */
  symlinkSync(join(root, 'assets', 'a.txt'), join(root, 'same.txt'));
  /* what a page asked for and did not get, for a render to key its chunks on: a file not there, a link refused */
  const missed = [];
  const site = await serve(root, { missed: (file) => missed.push(file) });
  try {
    const get = async (path) => { const r = await fetch(site.url + path); return [r.status, await r.text()]; };
    assert.deepEqual(await get('/assets/a.txt'), [200, 'mine']);
    assert.deepEqual(await get('/same.txt'), [200, 'mine']);
    assert.equal((await get('/assets/notes.txt'))[0], 403);
    assert.equal((await get('/assets/up/secret.txt'))[0], 403);
    assert.notEqual((await get('/%2e%2e/secret.txt'))[1], 'secret');
    assert.notEqual((await get('/assets/..%2f..%2fsecret.txt'))[1], 'secret');
    assert.equal((await get('/%E0%A4%A'))[0], 400);
    assert.equal((await get('/assets/logo.png'))[0], 404);
    assert.deepEqual(await get('/assets/a.txt'), [200, 'mine'], 'and it still serves');
    /* (`/../secret.txt` is the folder's own secret.txt, asked for and not there) */
    assert.deepEqual(missed, [join(root, 'assets', 'notes.txt'), join(root, 'assets', 'up', 'secret.txt'), join(root, 'secret.txt'), join(root, 'assets', 'logo.png')],
      'the links refused and the files not there; never a file served, nor an address out of the folder');
  } finally {
    await site.close();
  }
});

test('look and render serve the film\'s project, never the folders around it', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'of-work-')));
  const film = join(work, 'forked');
  mkdirSync(join(film, 'scenes'), { recursive: true });
  writeFileSync(join(film, 'film.html'), '{"stage":{"w":16,"h":9},"tracks":[]}');
  writeFileSync(join(film, 'scenes', 'title.html'), '<!doctype html>');
  mkdirSync(join(work, 'page'));
  writeFileSync(join(work, 'page', 'index.html'), '<!doctype html>');
  writeFileSync(join(work, '.env'), 'SECRET=1');
  const was = process.cwd();
  process.chdir(work);
  try {
    /* run from a folder that holds other things (a workspace, a home folder) */
    assert.equal(locate('forked').root, film);
    assert.equal(locate('forked/scenes/title.html').root, film, 'a scene page still reaches ../ inside its project');
    assert.equal(locate('page').root, join(work, 'page'), 'a page on its own is served from its own folder');
    /* a host that names the project serves it */
    assert.equal(locate(join(film, 'scenes', 'title.html'), film).root, film);
  } finally {
    process.chdir(was);
  }
});

test('Windows: Vulkan when its renderer is a GPU, read once; otherwise Direct3D when that is one, else the default, for every later browser too', async () => {
  /** A launcher that records what each browser was opened with; `fails` makes a Vulkan launch throw. */
  const launcher = (fails = false) => {
    const opened = /** @type {string[][]} */ ([]), closed = /** @type {string[][]} */ ([]);
    const open = async (/** @type {string[]} */ angle) => {
      opened.push(angle);
      if (fails && angle.length) throw new Error('no Vulkan driver');
      return /** @type {any} */ ({ angle, close: async () => { closed.push(angle); } });
    };
    return { open, opened, closed };
  };
  const reads = (/** @type {() => Promise<string>} */ said) => {
    let count = 0;
    return { renderer: async () => { count++; return said(); }, get count() { return count; } };
  };
  const vulkan = ['--use-angle=vulkan'];
  const d3d11 = ['--use-angle=d3d11'];

  const gpu = reads(async () => 'ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA GeForce RTX 5070 Laptop GPU (0x00002D58)), NVIDIA)');
  const always = async () => true;
  let l = launcher(), pick = vulkanFirst(gpu.renderer, always);
  const browsers = await Promise.all([pick(l.open), pick(l.open), pick(l.open)]);
  assert.deepEqual(browsers.map((b) => b.angle), [vulkan, vulkan, vulkan]);
  assert.equal(gpu.count, 1);
  assert.deepEqual(l.closed, []);

  /* WARP is Microsoft's own software rasteriser: a machine with no GPU driver, or a remote session, reads it. */
  for (const said of [
    async () => 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    async () => 'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    async () => 'none',
    async () => { throw new Error('page crashed'); },
  ]) {
    const software = reads(said);
    l = launcher(); pick = vulkanFirst(software.renderer, always);
    const [first, second] = await Promise.all([pick(l.open), pick(l.open)]);
    assert.deepEqual([first.angle, second.angle], [[], []]);
    /* Direct3D is asked once, and is software here too */
    assert.deepEqual(l.opened, [vulkan, d3d11, [], []]);
    assert.deepEqual(l.closed, [vulkan, d3d11]);
    assert.equal(software.count, 2);
  }

  const never = reads(async () => 'unused');
  l = launcher(true); pick = vulkanFirst(never.renderer, always);
  assert.deepEqual((await pick(l.open)).angle, []);
  assert.deepEqual((await pick(l.open)).angle, []);
  assert.deepEqual(l.opened, [vulkan, d3d11, [], []]);
  assert.equal(never.count, 0);

  /* a GPU whose driver has no Vulkan (the launch fails, or reads software): Direct3D reaches it, and is kept */
  const intel = 'ANGLE (Intel, Intel(R) HD Graphics 4600 (0x00000412) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const swiftShader = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
  const byAngle = async (/** @type {any} */ b) => (b.angle.join() === d3d11.join() ? intel : swiftShader);
  for (const fails of [false, true]) {
    const opened = /** @type {string[][]} */ ([]), closed = /** @type {string[][]} */ ([]);
    const open = async (/** @type {string[]} */ angle) => {
      opened.push(angle);
      if (fails && angle.join() === vulkan.join()) throw new Error('no Vulkan driver');
      return /** @type {any} */ ({ angle, close: async () => { closed.push(angle); } });
    };
    pick = vulkanFirst(byAngle, always);
    assert.deepEqual((await pick(open)).angle, d3d11);
    assert.deepEqual((await pick(open)).angle, d3d11);
    assert.deepEqual(opened, [vulkan, d3d11, d3d11]);
    assert.deepEqual(closed, fails ? [] : [vulkan]);
  }
  /* Direct3D on a GPU that never shows a video's frames is not taken: the default */
  const opened = /** @type {string[][]} */ ([]);
  pick = vulkanFirst(byAngle, async () => false);
  assert.deepEqual((await pick(async (angle) => { opened.push(angle); return /** @type {any} */ ({ angle, close: async () => {} }); })).angle, []);
  assert.deepEqual(opened, [vulkan, d3d11, []]);
});

test('Windows: when Vulkan never shows a video frame, Direct3D on the same GPU, else Vulkan decoding on the CPU, else Direct3D on the other GPU, else the default', async () => {
  const vulkan = ['--use-angle=vulkan'];
  const d3d11 = ['--use-angle=d3d11'];
  const cpu = [...vulkan, '--disable-accelerated-video-decode'];
  const nvidia = 'ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA GeForce RTX 4050 Laptop GPU (0x000028A1)), NVIDIA)';
  const nvidiaD3d = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU (0x000028A1) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const intelD3d = 'ANGLE (Intel, Intel(R) UHD Graphics (0x0000A7A8) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const swiftShader = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
  /** Browsers by what they are opened with: Direct3D's renderer, and which ones show a video's frames. */
  const machine = (/** @type {string} */ direct, /** @type {string[][]} */ showing) => {
    const opened = /** @type {string[][]} */ ([]), closed = /** @type {string[][]} */ ([]);
    const open = async (/** @type {string[]} */ angle) => {
      opened.push(angle);
      return /** @type {any} */ ({ angle, close: async () => { closed.push(angle); } });
    };
    const renderer = async (/** @type {any} */ b) => (b.angle[0] === '--use-angle=vulkan' ? nvidia : b.angle.length ? direct : swiftShader);
    const presents = async (/** @type {any} */ b) => showing.some((a) => a.join() === b.angle.join());
    return { pick: vulkanFirst(renderer, presents), open, opened, closed };
  };

  /* one GPU: Direct3D reaches it and shows the frames */
  let m = machine(nvidiaD3d, [d3d11]);
  assert.deepEqual((await m.pick(m.open)).angle, d3d11);
  assert.deepEqual((await m.pick(m.open)).angle, d3d11);
  assert.deepEqual(m.opened, [vulkan, d3d11, d3d11]);
  assert.deepEqual(m.closed, [vulkan]);

  /* two GPUs (#64): Direct3D takes the integrated one, so Vulkan stays, its videos decoded on the CPU */
  m = machine(intelD3d, [d3d11, cpu]);
  assert.deepEqual((await m.pick(m.open)).angle, cpu);
  assert.deepEqual((await m.pick(m.open)).angle, cpu);
  assert.deepEqual(m.opened, [vulkan, d3d11, cpu, cpu]);
  assert.deepEqual(m.closed, [vulkan, d3d11]);

  /* only Direct3D on the integrated GPU shows them: that, rather than the CPU */
  m = machine(intelD3d, [d3d11]);
  assert.deepEqual((await m.pick(m.open)).angle, d3d11);
  assert.deepEqual(m.opened, [vulkan, d3d11, cpu]);
  assert.deepEqual(m.closed, [vulkan, cpu]);

  /* nothing shows them: the default */
  m = machine(intelD3d, []);
  assert.deepEqual((await m.pick(m.open)).angle, []);
  assert.deepEqual(m.opened, [vulkan, d3d11, cpu, []]);
  assert.deepEqual(m.closed, [vulkan, cpu, d3d11]);
});

test('Windows: a film whose video Vulkan never showed, though its check passed, moves every later browser to the next way, once', async () => {
  const vulkan = ['--use-angle=vulkan'];
  const opened = /** @type {string[][]} */ ([]);
  const open = async (/** @type {string[]} */ angle) => { opened.push(angle); return /** @type {any} */ ({ angle, close: async () => {} }); };
  const renderer = async (/** @type {any} */ b) => (b.angle.length
    ? 'ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA GeForce RTX 4050 Laptop GPU (0x000028A1)), NVIDIA)'
    : 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU (0x000028A1) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  const pick = vulkanFirst(renderer, async () => true);
  assert.deepEqual((await pick(open)).angle, vulkan);
  assert.equal(await pick.videoNotShown(), true);
  /* Direct3D on the same GPU, its check not asked of Vulkan again */
  assert.deepEqual((await pick(open)).angle, ['--use-angle=d3d11']);
  assert.deepEqual((await pick(open)).angle, ['--use-angle=d3d11']);
  assert.deepEqual(opened, [vulkan, vulkan, ['--use-angle=d3d11'], ['--use-angle=d3d11']]);
  assert.equal(await pick.videoNotShown(), false, 'no other way left to move to');
});

test('a browser shows a paused video\'s frame once sought; one that never presents it is told', { timeout: 60_000 }, async () => {
  const browser = await launch();
  try {
    assert.equal(await presentsVideo(browser), true);
    /* a compositor that never presents: the frame callback never comes */
    const never = { newPage: async () => {
      const page = await browser.newPage();
      await page.evaluate(() => { HTMLVideoElement.prototype.requestVideoFrameCallback = () => 0; });
      return page;
    } };
    assert.equal(await presentsVideo(/** @type {any} */ (never)), false);
    /* one that shows a frame, never the one sought: as slow as none at all */
    const wrong = { newPage: async () => {
      const page = await browser.newPage();
      await page.evaluate(() => {
        HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
          setTimeout(() => callback(performance.now(), /** @type {any} */ ({ mediaTime: this.currentTime + 1 })), 10);
          return 0;
        };
      });
      return page;
    } };
    assert.equal(await presentsVideo(/** @type {any} */ (wrong)), false);
  } finally {
    await browser.close();
  }
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a page\'s own video, moved and not waited for, is drawn once its frame is on screen: no second lost on one presented before `seeked` or there already, no other frame taken for it, and one coming on waited for as before', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-own-video-'));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=3', '-pix_fmt', 'yuv420p', '-g', '15', join(dir, 'rec.mp4')]);
  /* a page that sets its video's time and does not wait for the seek (the host does): a frame on each time for a
     second, then held on one (a seek to where the video already is presents nothing) */
  writeFileSync(join(dir, 'page.html'), `<!doctype html><body style="margin:0"><video id="v" src="rec.mp4" muted playsinline preload="auto" style="width:320px;height:180px"></video>
<script>
const v = document.getElementById('v');
window.film = {
  duration: 3, width: 320, height: 180,
  ready: new Promise((r) => (v.readyState >= 2 ? r() : v.addEventListener('loadeddata', r, { once: true }))),
  frame(t) { v.style.visibility = window.hidden ? 'hidden' : 'visible'; v.currentTime = Math.min(t, 1); },
};
</script></body>`);
  const site = await serve(dir);
  const browser = await launch();
  try {
    const film = await FilmPage.open(browser, site.url, 'page.html');
    /* the first seek after the file loaded may never be presented (Chromium): not counted */
    await film.seek(0.4);
    const took = [];
    const pictures = [];
    for (let f = 15; f < 45; f++) {
      const t0 = performance.now();
      await film.seek(f / 30);
      took.push(performance.now() - t0);
      pictures.push(await film.capture());
      /* now and then, the same moment once every wait would have run out: the picture taken was the settled one */
      if (f % 7 === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        assert.ok(pictures.at(-1).equals(await film.capture()), `frame ${f}: the picture taken is the one that stays`);
      }
    }
    /* the wait's limit is a second: before, most moving frames and every held one ran it out */
    const slow = took.filter((ms) => ms >= 900);
    assert.ok(slow.length <= 2, `${slow.length} of ${took.length} frames waited a second: ${took.map(Math.round)}`);
    /* each moving frame is its own picture, and the held ones the last of them */
    for (let i = 1; i <= 15; i++) assert.ok(!pictures[i].equals(pictures[i - 1]), `frame ${15 + i} is not frame ${14 + i}'s picture`);
    for (let i = 16; i < 30; i++) assert.ok(pictures[i].equals(pictures[15]), `frame ${15 + i}, held, is frame 30's picture`);
    await film.close();
    /* a browser whose frames presented are never the one the video holds (told by its time): none is taken for it,
       and the wait runs to its limit rather than draw another frame's picture */
    const other = await FilmPage.open(browser, site.url, 'page.html');
    await other.page.evaluate(() => {
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        setTimeout(() => callback(0, /** @type {any} */ ({ mediaTime: this.currentTime + 1 })), 5);
        return 0;
      };
    });
    const t0 = performance.now();
    await other.seek(0.5);
    const waited = performance.now() - t0;
    assert.ok(waited >= 900 && waited < 2900, `${Math.round(waited)} ms`);
    await other.close();
    /* a video coming on (hidden as the last frame was drawn) is waited for as before: what was said presented while
       it was out of the picture proves nothing, the picture can keep the frame it had (Chromium). Here every seek's
       frame is said presented as the seek starts, before `seeked`, and never again */
    const coming = await FilmPage.open(browser, site.url, 'page.html');
    await coming.page.evaluate(() => {
      const asked = new WeakMap();
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        if (!asked.has(this)) {
          asked.set(this, []);
          this.addEventListener('seeking', () => {
            const mediaTime = Math.round(Math.floor(this.currentTime * 30 + 1e-6) * 1e6 / 30) / 1e6;
            for (const said of asked.get(this).splice(0)) said(0, /** @type {any} */ ({ mediaTime }));
          });
        }
        asked.get(this).push(callback);
        return 1;
      };
      HTMLVideoElement.prototype.cancelVideoFrameCallback = function () { asked.get(this)?.splice(0); };
    });
    const timed = async (/** @type {number} */ t, hidden = false) => {
      await coming.page.evaluate((hidden) => { /** @type {any} */ (window).hidden = hidden; }, hidden);
      const t0 = performance.now();
      await coming.seek(t);
      return performance.now() - t0;
    };
    const first = await timed(15 / 30);
    const steady = await timed(16 / 30);
    const out = await timed(17 / 30, true);
    const on = await timed(18 / 30);
    const after = await timed(19 / 30);
    const all = `${[first, steady, out, on, after].map(Math.round)} ms`;
    assert.ok(first >= 900, `not followed yet, it is waited for as before: ${all}`);
    assert.ok(steady < 500, `in the picture since the last frame, its frame said presented before \`seeked\` counts: ${all}`);
    assert.ok(out < 500, `hidden, it is not waited for: ${all}`);
    assert.ok(on >= 900 && on < 2900, `coming on, it is waited for as before: ${all}`);
    assert.ok(after < 500, `in the picture again: ${all}`);
    await coming.close();
  } finally {
    await browser.close();
    await site.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A FilmPage whose CDP session fails `fails` times with `error`, then gives a picture. */
const flakyCapture = (fails, error) => {
  const page = Object.create(FilmPage.prototype);
  page.meta = { width: 4, height: 2 };
  page.scale = 1;
  page.asked = 0;
  page.waited = 0;
  page.cdp = { send: async () => { page.asked++; if (page.asked <= fails) throw new Error(error); return { data: Buffer.from('png').toString('base64') }; } };
  page.page = { evaluate: async () => { page.waited++; } };
  return page;
};

test('a frame whose picture Chromium could not give is asked for again after two frames', async () => {
  const empty = 'cdpSession.send: Protocol error (Page.captureScreenshot): Unable to capture screenshot';
  const page = flakyCapture(2, empty);
  assert.equal(String(await page.capture()), 'png');
  assert.equal(page.asked, 3);
  assert.equal(page.waited, 2, 'two frames waited before each new ask');
  /* none at all: it fails with Chromium's words, which draw the render again in new browsers (browserFailed) */
  const never = flakyCapture(Infinity, empty);
  await assert.rejects(never.capture(), /Unable to capture screenshot/);
  assert.equal(never.asked, 4);
  /* another error is not asked again */
  const other = flakyCapture(1, 'cdpSession.send: Target closed');
  await assert.rejects(other.capture(), /Target closed/);
  assert.equal(other.asked, 1);
});
