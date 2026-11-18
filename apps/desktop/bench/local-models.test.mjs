/** Downloads and inference from the real Electron utility runtime, without a desktop window.
 * Run from apps/desktop with `node --test bench/local-models.test.mjs` (needs Electron and ffmpeg).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('local downloads and inference launch from an Electron utility process', { timeout: 45_000 }, async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'of-model-electron-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const pkg = join(folder, 'package');
  mkdirSync(pkg);
  const names = ['whisper-small', 'whisper-large-v3-turbo', 'birefnet-lite'];
  /* Keep the model math tiny; exercise the real download, provider, worker, image decoding and output paths. */
  const runtime = 'models/onnxruntime-web-1.31.1/ort.wasm.min.mjs';
  const files = { [runtime]: `export const env={wasm:{}};
export class Tensor {constructor(type,data,dims){Object.assign(this,{type,data,dims});}}
export const InferenceSession={create:async()=>({inputNames:['image'],outputNames:['mask'],run:async()=>({mask:{data:new Float32Array(512*512)}})})};` };
  for (const id of names) files[`models/${id}/model.onnx`] = `model bytes for ${id}`;
  const listed = (path) => ({ path, bytes: Buffer.byteLength(files[path]), sha256: createHash('sha256').update(files[path]).digest('hex') });
  writeFileSync(join(pkg, 'local-models.json'), JSON.stringify({ models: names.map((id) => ({ id, files: [listed(runtime), listed(`models/${id}/model.onnx`)] })) }));
  writeFileSync(join(folder, 'source.ppm'), Buffer.concat([Buffer.from('P6\n2 2\n255\n'), Buffer.from([255,0,0,0,255,0,0,0,255,255,255,255])]));
  const source = fileURLToPath(new URL('../../../packages/openfilm/src/local-models.mjs', import.meta.url));
  const provider = fileURLToPath(new URL('../../../packages/openfilm/studio/server/providers/local.mjs', import.meta.url));
  const worker = join(folder, 'worker.mjs');
  writeFileSync(worker, `import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {modelEntries,modelReady,modelFetching,modelFailed,setModelOn} from ${JSON.stringify(source)};
const models=[];
for(const m of modelEntries()) {
  setModelOn(true,m);
  for(let i=0;i<30&&!modelReady(m)&&!modelFailed(m);i++)await new Promise(resolve=>setTimeout(resolve,100));
  models.push({id:m.id,ready:modelReady(m),fetching:modelFetching(m),failed:modelFailed(m)});
  if(!modelReady(m))try{const state=JSON.parse(readFileSync(join(process.env.OPENFILM_LIBRARY_CACHE,'models',m.id+'.json'),'utf8'));if(state.pid)process.kill(state.pid);}catch{}
}
const {default:provider}=await import(${JSON.stringify(provider)});
let inference;
try {
  const result=await provider.run('cutout',{src:'source.ppm',out:'test'},{root:${JSON.stringify(folder)},model:'birefnet-lite',signal:new AbortController().signal,say:()=>{}});
  inference={bytes:result.files[0].bytes.length,provider:result.index[0].from.provider};
}catch(error){inference={error:error.message};}
process.parentPort.postMessage({models,inference,execPath:process.execPath});
process.exit(0);`);
  const entry = join(folder, 'main.cjs');
  writeFileSync(entry, `const {app,utilityProcess}=require('electron');
const {createServer}=require('node:http');
app.setName('Local Model Regression');app.setPath('userData',${JSON.stringify(join(folder, 'data'))});
app.whenReady().then(()=>{app.dock?.hide();let requests=0;let result;
const files=${JSON.stringify(files)};
const server=createServer((req,res)=>{requests++;const path=req.url.slice('/library/'.length);if(!files[path]){res.writeHead(404);res.end();}else res.end(files[path]);});
server.listen(0,'127.0.0.1',()=>{const child=utilityProcess.fork(${JSON.stringify(worker)},[],{env:{...process.env,OPENFILM_LIBRARY_URL:'http://127.0.0.1:'+server.address().port+'/library',OPENFILM_LIBRARY_CACHE:${JSON.stringify(join(folder, 'cache'))},OPENFILM_BUILT_IN_LIBRARY:${JSON.stringify(pkg)},OPENFILM_HOME:${JSON.stringify(join(folder, 'home'))}},stdio:'pipe'});
child.stderr.on('data',data=>process.stderr.write(data));child.on('message',message=>{result=message;});child.on('exit',code=>{console.log('RESULT '+JSON.stringify({...result,requests,code}));server.close();app.exit(code);});setTimeout(()=>{child.kill();app.exit(2);},30000).unref();});});`);
  const electron = createRequire(import.meta.url)('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = '', stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0, stderr);
  const line = stdout.split('\n').find((line) => line.startsWith('RESULT '));
  assert.ok(line, stdout + stderr);
  const result = JSON.parse(line.slice(7));
  assert.deepEqual(result.models, names.map((id) => ({ id, ready: true, fetching: false, failed: false })), stderr);
  assert.equal(result.requests, 4, 'the shared runtime is reused, and each model is fetched');
  assert.equal(result.inference.provider, 'local', JSON.stringify(result.inference));
  assert.ok(result.inference.bytes > 0, 'the inference worker returns a picture');
});
