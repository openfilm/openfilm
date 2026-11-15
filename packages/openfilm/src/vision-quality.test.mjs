import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, copyFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve, launch } from './host.mjs';
import { studioHomeDir } from './locations.mjs';
const portrait = process.env.OPENFILM_VISION_TEST_PORTRAIT;
const modelHome = join(studioHomeDir(), 'cache/vision/1');
const subject = join(modelHome, 'subject.onnx');
const refine = join(modelHome, 'refine.onnx');
const parse = join(modelHome, 'face-parse.onnx');

test(
  'local matting, multi-face feature masks, geometry, pigments and chroma key use actual pixels without external requests',
  {
    timeout: 180000,
    skip: !portrait || !existsSync(portrait) ? 'set OPENFILM_VISION_TEST_PORTRAIT to a local portrait' : false,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'of-vision-quality-')),
      before = process.env.OPENFILM_HOME;
    process.env.OPENFILM_HOME = join(root, 'home');
    let site, browser;
    try {
      const optional = existsSync(subject);
      if (optional) {
        mkdirSync(join(process.env.OPENFILM_HOME, 'cache/vision/1'), { recursive: true });
        symlinkSync(subject, join(process.env.OPENFILM_HOME, 'cache/vision/1/subject.onnx'));
      }
      for (const file of [refine, parse]) if (existsSync(file)) {
        mkdirSync(join(process.env.OPENFILM_HOME, 'cache/vision/1'), { recursive: true });
        symlinkSync(file, join(process.env.OPENFILM_HOME, 'cache/vision/1', file.split('/').at(-1)));
      }
      copyFileSync(portrait, join(root, 'portrait.jpg'));
      writeFileSync(join(root, 'index.html'), '<!doctype html><body>Local quality verification</body>');
      site = await serve(root);
      browser = await launch(process.env.OPENFILM_VISION_TEST_CPU ? { args: ['--use-angle=swiftshader'] } : {});
      const page = await browser.newPage();
      const external = [];
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(site.url)) return route.continue();
        external.push(url);
        return route.abort();
      });
      await page.goto(site.url + '/index.html');
      const result = await page.evaluate(async ({ optional, refined, parsed }) => {
        const { videoEffects } = await import('/__film/vision-config.mjs');
        const { VisionComposite } = await import('/__film/vision-composite.mjs');
        const image = new Image();
        image.src = '/portrait.jpg';
        await image.decode();
        const canvas = new OffscreenCanvas(820, 512),
          ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, 410, 512);
        ctx.drawImage(image, 410, 0, 410, 512);
        const worker = new Worker('/__film/vision-analyzer.mjs', { type: 'module' });
        let sequence = 0;
        const analyze = async (settings) => {
          const id = ++sequence,
            frame = await createImageBitmap(canvas);
          return new Promise((resolve, reject) => {
            worker.onmessage = ({ data }) => {
              if (data.id !== id) return;
              if (data.phase === 'error') reject(new Error(data.error));
              if (data.phase === 'ready') resolve(data.analysis);
            };
            worker.onerror = (event) => reject(new Error(event.message));
            worker.postMessage({ id, frame, src: 'two-portraits', time: 0.2, settings }, [frame]);
          });
        };
        const compositor = new VisionComposite();
        const config = videoEffects(() => undefined);
        const settings = { ...config, cutout: true, mode: 1, smooth: 0.25 };
        const analysis = await analyze(settings);
        const a = analysis.person.data;
        let soft = 0;
        for (const value of a) if (value > 4 && value < 251) soft++;
        const frame = await createImageBitmap(canvas),
          base = compositor.render(frame, analysis, settings);
        let parity = null;
        if (navigator.gpu) {
          const { matte } = await import('/__film/vision-matting.mjs');
          const gpu = await matte(frame, 1);
          const cpuModule = await import('/__film/vision-matting.mjs?cpu-parity');
          Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
          let cpu;
          try {
            cpu = await cpuModule.matte(frame, 1);
          } finally {
            delete navigator.gpu;
          }
          let total = 0,
            max = 0;
          for (let i = 0; i < gpu.data.length; i++) {
            const difference = Math.abs(gpu.data[i] - cpu.data[i]);
            total += difference;
            max = Math.max(max, difference);
          }
          parity = { mean: total / gpu.data.length, max };
        }

        const read = (bitmap) => {
          const c = new OffscreenCanvas(bitmap.width, bitmap.height),
            x = c.getContext('2d');
          x.drawImage(bitmap, 0, 0);
          return x.getImageData(0, 0, c.width, c.height).data;
        };
        const original = read(base);
        const change = (bitmap) => {
          const b = read(bitmap);
          let changed = 0;
          for (let i = 0; i < b.length; i += 4)
            if (
              Math.abs(original[i] - b[i]) +
                Math.abs(original[i + 1] - b[i + 1]) +
                Math.abs(original[i + 2] - b[i + 2]) >
              8
            )
              changed++;
          bitmap.close();
          return changed;
        };
        const reshape = change(
          compositor.render(frame, analysis, { ...settings, eyes: 1, slim: 0.6, nose: 0.6, jaw: 0.5, chin: 0.4 }),
        );
        const makeupSettings = { ...settings, lip: 1, blush: 1, shadow: 1 };
        const makeup = change(compositor.render(frame, await analyze(makeupSettings), makeupSettings));
        const detailSettings = { ...settings, teeth: 1, eyeBright: 1, darkCircles: 1, even: 0.5, detail: 0.4 };
        const details = change(compositor.render(frame, await analyze(detailSettings), detailSettings));
        let general = null;
        if (optional) {
          const subject = await analyze({ ...settings, mode: 2 });
          general = {
            w: subject.person.w,
            h: subject.person.h,
            min: Math.min(...subject.person.data.slice(0, 4096)),
            max: subject.person.data.reduce((a, b) => Math.max(a, b), 0),
          };
        }
        let precise = null;
        if (refined) {
          const a = await analyze({ ...settings, mode: 4 });
          const { trimapOf, personComponents, protectFaceInterior } = await import('/__film/vision-refine.mjs');
          const tri = trimapOf(new Uint8Array([0,0,0,0,255,255,255,255]), 8, 1, 1);
          const clean = personComponents({ w: 8, h: 2, data: new Uint8Array([255,255,255,0,0,0,0,255, 255,255,255,0,0,0,0,0]) }, [Array.from({length: 468}, () => ({ x: .1, y: .1 }))]);
          const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
          const face = Array.from({length:478},()=>({x:.5,y:.5}));
          oval.forEach((id,i)=>{face[id]={x:.5+.3*Math.cos(i*2*Math.PI/oval.length),y:.5+.3*Math.sin(i*2*Math.PI/oval.length)}});
          const empty = {w:64,h:64,data:new Uint8Array(4096)}, protectedFace = protectFaceInterior(empty,[face]);
          precise = { w: a.person.w, h: a.person.h, soft: a.person.data.filter((v) => v > 4 && v < 251).length, tri: Array.from(tri), clean: Array.from(clean.data), faceConstraint:[protectedFace.data[32*64+32],protectedFace.data[0],empty.data[32*64+32]] };
        }
        let semantic = null;
        if (parsed) {
          const options = { ...settings, quality: 1, smooth: .45, blemish: .7, highlights: .6, texture: .8, lip: .6, shadow: .6 };
          const a = await analyze(options);
          const skinPixels = a.skin.data.reduce((s, v) => s + v / 255, 0);
          const features = [0,1,2].map((ch) => a.features.data.reduce((s,v,i) => s + (i % 4 === ch && v > 128 ? 1 : 0), 0));
          const retouch = change(compositor.render(frame, a, options));
          semantic = { faces: a.faceCount, skinPixels, features, retouch };
        }
        const green = new OffscreenCanvas(100, 80),
          g = green.getContext('2d');
        g.fillStyle = '#00ff00';
        g.fillRect(0, 0, 100, 80);
        g.fillStyle = 'red';
        g.fillRect(25, 20, 50, 40);
        const keyed = compositor.render(await createImageBitmap(green), {}, { ...config, cutout: true, mode: 3 });
        const keyPixels = read(keyed);
        const keyAlpha = [keyPixels[3], keyPixels[(40 * 100 + 50) * 4 + 3]];
        const display = new OffscreenCanvas(1230, 512),
          d = display.getContext('2d');
        d.drawImage(image, 0, 0, 410, 512);
        d.fillStyle = '#111';
        d.fillRect(410, 0, 410, 512);
        d.drawImage(base, 0, 0, 410, 512, 410, 0, 410, 512);
        d.fillStyle = '#fff';
        d.fillRect(820, 0, 410, 512);
        d.drawImage(base, 0, 0, 410, 512, 820, 0, 410, 512);
        const blob = await display.convertToBlob({ type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (const value of bytes) binary += String.fromCharCode(value);
        base.close();
        frame.close();
        keyed.close();
        worker.terminate();
        return {
          faces: analysis.faceCount,
          parity,
          soft,
          reshape,
          makeup,
          details,
          general,
          keyAlpha,
          precise,
          semantic,
          png: btoa(binary),
        };
      }, { optional, refined: existsSync(refine), parsed: existsSync(parse) });
      assert.ok(result.faces >= 2, `two faces detected independently: ${result.faces}`);
      assert.ok(result.soft > 300, 'true fractional alpha survives matting');
      if (result.parity)
        assert.ok(
          result.parity.mean < 1.5,
          `GPU alpha agrees with CPU; layout transformations must not corrupt the mask: ${JSON.stringify(result.parity)}`,
        );
      assert.ok(result.reshape > 100, 'landmark warping changes the actual face pixels');
      assert.ok(result.makeup > 100, 'feature-aligned pigments change the actual face pixels');
      assert.ok(result.details > 100, 'local retouching changes the actual feature pixels');
      assert.ok(
        result.keyAlpha[0] < 5 && result.keyAlpha[1] > 250,
        `chroma key preserves the red subject: ${result.keyAlpha}`,
      );
      if (result.general) {
        assert.equal(result.general.w, 512);
        assert.equal(result.general.h, 512);
        assert.ok(result.general.min < 20 && result.general.max > 230);
      }
      if (result.precise) {
        assert.ok(result.precise.w >= 800 && result.precise.soft > 300, 'refined alpha uses real high-resolution fractional boundaries');
        assert.equal(result.precise.clean[7], 0, 'face-seeded components remove isolated graphics without removing the person');
        assert.equal(result.precise.clean[0], 255);
        assert.deepEqual(result.precise.tri, [0,0,0,128,128,255,255,255], 'trimap expands uncertainty and preserves definite regions');
        assert.deepEqual(result.precise.faceConstraint,[255,0,0], 'a face interior is foreground even when the coarse matte misses saturated skin, without mutating the source or background');
      }
      if (result.semantic) {
        assert.ok(result.semantic.faces >= 2 && result.semantic.skinPixels > 1000);
        assert.ok(result.semantic.features[0] > 20 && result.semantic.features[1] > 20, 'semantic lip and eye regions are nonempty');
        assert.ok(result.semantic.retouch > 100, 'semantic retouching changes rendered pixels');
      }
      assert.deepEqual(external, [], 'no video frames, models or runtime files use a remote browser request');
      if (process.env.OPENFILM_VISION_QUALITY_SCREENSHOT)
        writeFileSync(process.env.OPENFILM_VISION_QUALITY_SCREENSHOT, Buffer.from(result.png, 'base64'));
      console.log(JSON.stringify({ ...result, png: undefined }));
    } finally {
      await browser?.close();
      await site?.close();
      if (before === undefined) delete process.env.OPENFILM_HOME;
      else process.env.OPENFILM_HOME = before;
      rmSync(root, { recursive: true, force: true });
    }
  },
);
