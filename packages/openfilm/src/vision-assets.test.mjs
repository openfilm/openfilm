import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { serve } from './host.mjs';
import { visionModel, stopVisionDownloads } from './vision-assets.mjs';

test('closing local vision aborts optional downloads and removes partial files without removing verified models', async (t) => {
  const root = mkdtempSync(join(tmpdir(),'of-model-stop-')), before = process.env.OPENFILM_HOME;
  process.env.OPENFILM_HOME = root;
  let started; const waiting = new Promise((resolve)=>{started=resolve});
  t.mock.method(globalThis,'fetch',async (_url,{signal})=>{started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('download stopped')),{once:true}))});
  try {
    const download = visionModel('subject.onnx'); await waiting; stopVisionDownloads();
    await assert.rejects(download,/download stopped/);
    assert.deepEqual(readdirSync(join(root,'cache/vision/1')),[]);
  } finally { if(before===undefined)delete process.env.OPENFILM_HOME;else process.env.OPENFILM_HOME=before;rmSync(root,{recursive:true,force:true}); }
});

test('vision assets are allowlisted, versioned and never keep a failed model download', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-vision-assets-'));
  const before = process.env.OPENFILM_HOME;
  process.env.OPENFILM_HOME = join(root, 'home'); mkdirSync(process.env.OPENFILM_HOME);
  const remote = t.mock.method(globalThis, 'fetch', async () => new Response('<html>not a model</html>'));
  let site;
  const call = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = request(`${site.url}${path}`, { method }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
  try {
    site = await serve(root);
    const script = await call('/__film/vision-analyzer.mjs');
    assert.equal(script.status, 200); assert.match(script.body.toString(), /vision\/1\.2\.2\/vision_bundle/);
    assert.equal(script.headers['cache-control'], 'no-store');
    for (const name of ['vision-preview','vision-cache','vision-input-cache']) assert.equal((await call(`/__film/${name}.mjs`)).status,200);
    const wasm = await call('/__film/vision/1.2.2/wasm/vision_wasm_module_internal.wasm', 'HEAD');
    assert.equal(wasm.status, 200); assert.equal(wasm.headers['content-type'], 'application/wasm'); assert.equal(wasm.body.length, 0);
    assert.equal((await call('/__film/vision/package.json')).status, 404);
    assert.equal((await call('/__film/vision/__proto__')).status, 404);
    assert.equal((await call('/__film/vision/1.2.2/vision_bundle.mjs', 'POST')).status, 405);
    for (let n = 0; n < 2; n++) {
      const bad = await call('/__film/vision/subject.onnx');
      assert.equal(bad.status, 503); assert.match(bad.body.toString(), /invalid/);
    }
    assert.equal(remote.mock.callCount(), 2, 'a failed download can be retried');
    assert.deepEqual(readdirSync(join(process.env.OPENFILM_HOME, 'cache/vision/1')), [], 'unverified bytes are never cached');
    const bundled = await call('/__film/vision/portrait.onnx', 'HEAD');
    assert.equal(bundled.status, 200, 'the portrait model works with the network unavailable');
    assert.equal(remote.mock.callCount(), 2, 'bundled inference never downloads a model');
    assert.equal((await call('/__film/vision/ort-1.31.1/ort.webgpu.bundle.min.mjs', 'HEAD')).status, 200);
    assert.equal((await call('/__film/vision/ort-1.31.1/ort-wasm-simd-threaded.asyncify.wasm', 'HEAD')).status, 200);
  } finally {
    await site?.close();
    if (before === undefined) delete process.env.OPENFILM_HOME; else process.env.OPENFILM_HOME = before;
    rmSync(root, { recursive: true, force: true });
  }
});
