import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IDLE_MS, mediaTransfer } from './media-transfer.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'media-transfer-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  return {root, transfer:await mediaTransfer(root, new AbortController().signal)};
}
async function server(t, reply) {
  const service = createServer(reply);
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => { service.closeAllConnections(); service.close(); });
  return `http://127.0.0.1:${service.address().port}/output`;
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('a paid request survives a new client instance; concurrent commands cannot replace it, account/input scope stays separate', async t => {
  const {root,transfer} = await fixture(t);
  const identity = {args:{out:'music'},input:'version-1'};
  const first = await transfer.request('account-a',identity);
  await assert.rejects(transfer.request('account-a',identity), /already being recovered/);
  await first.remember({files:[{path:'assets/音乐 一.mp3',url:'https://private.example/result'}]});
  await first.release();
  const second = await (await mediaTransfer(root,new AbortController().signal)).request('account-a',identity);
  assert.equal(second.key,first.key); assert.equal(second.resumed,true); assert.equal(second.reply.files.length,1);
  const other = await transfer.request('account-b',identity);
  assert.notEqual(other.key,first.key); await other.release();
  const changed = await transfer.request('account-a',{...identity,input:'version-2'});
  assert.notEqual(changed.key,first.key); await changed.release();
  await second.finish(); await second.release();
  const fresh = await transfer.request('account-a',identity);
  assert.notEqual(fresh.key,first.key); await fresh.release();
});

test('a damaged journal refuses to create another paid request', async t => {
  const {root,transfer} = await fixture(t);
  const request = await transfer.request('account',{out:'a'}); await request.release();
  const dir = join(root,'.film/media-runs');
  const name = (await readdir(dir)).find(name => name.endsWith('.request.json'));
  await writeFile(join(dir,name),'{damaged');
  await assert.rejects(transfer.request('account',{out:'a'}),/damaged/);
  const fresh = await transfer.request('account',{out:'a'},true);
  assert.notEqual(fresh.key,request.key); await fresh.release();
});

test('an interrupted download resumes after client restart using Range/If-Range and commits atomically', async t => {
  const {root,transfer} = await fixture(t);
  const bytes = Buffer.from('abcdefghij'), ranges = [];
  let cuts = 4;
  const url = await server(t,(req,res) => {
    assert.equal(req.headers.authorization,undefined);
    const offset = Number(/^bytes=(\d+)-$/.exec(req.headers.range ?? '')?.[1] ?? 0);
    ranges.push(offset);
    if (offset) assert.equal(req.headers['if-range'],'"same"');
    res.writeHead(offset ? 206 : 200,{'etag':'"same"','content-length':bytes.length-offset,...(offset ? {'content-range':`bytes ${offset}-${bytes.length-1}/${bytes.length}`} : {})});
    if (cuts-- > 0) { res.write(bytes.subarray(offset,offset+2)); setTimeout(() => res.destroy(),20); }
    else res.end(bytes.subarray(offset));
  });
  const file = {path:'assets/音乐 空格 #1.mp3',url,bytes:bytes.length,sha256:sha(bytes)};
  const target = join(root,file.path); await mkdir(join(root,'assets')); await writeFile(target,'old take');
  await assert.rejects(transfer.download(file,'original-key',async()=>file));
  assert.equal(await readFile(target,'utf8'),'old take','incomplete data never overwrites an existing take');
  const next = await mediaTransfer(root,new AbortController().signal);
  const staged = await next.download(file,'original-key',async()=>file);
  assert.equal(await readFile(target,'utf8'),'old take');
  await staged.commit(target);
  assert.equal(await readFile(target,'utf8'),bytes.toString());
  assert.equal(ranges.length,5);
  assert.equal(ranges[0],0);
  assert.ok(ranges.some(offset=>offset>0),'previously saved bytes are reused');
  assert.ok(ranges.every((offset,index)=>offset>=0&&offset<bytes.length&&(index===0||offset>=ranges[index-1])));
  const afterCrash = await next.download(file,'original-key',async()=>{throw Error('must not fetch');});
  await afterCrash.commit(target);
  assert.equal(ranges.length,5,'a crash after rename recovers the already committed file');
});

test('an expired URL is refreshed through the original task; streamed downloads do not buffer Response.arrayBuffer', async t => {
  const {root,transfer} = await fixture(t);
  const originalFetch = globalThis.fetch;
  let gets = 0, renewals = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async url => {
    gets++;
    if (url === 'https://vendor.example/expired') return new Response('',{status:403});
    const response = new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from('audio'));controller.close();}}),{headers:{'content-length':'5'}});
    response.arrayBuffer = async () => { throw Error('must stream'); }; return response;
  };
  const file = {path:'assets/song.mp3',url:'https://vendor.example/expired',bytes:5,sha256:sha('audio')};
  const staged = await transfer.download(file,'same-key',async path => {renewals++; assert.equal(path,file.path); return {...file,url:'https://vendor.example/renewed'};});
  await mkdir(join(root,'assets')); await staged.commit(join(root,file.path));
  assert.equal(gets,2); assert.equal(renewals,1); assert.equal(await readFile(join(root,file.path),'utf8'),'audio');
});

test('a download that fails at its address is tried again at the other addresses the service gave for it', async t => {
  const {root,transfer} = await fixture(t);
  const originalFetch = globalThis.fetch;
  const asked = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async url => {
    asked.push(url);
    if (url === 'https://storage.example/out') return new Response('', {status:502});
    return new Response('video', {headers:{'content-length':'5','content-type':'video/mp4'}});
  };
  const file = {path:'assets/clip.mp4',url:'https://storage.example/out',alternate_urls:['https://origin.example/out'],bytes:5,sha256:sha('video')};
  const staged = await transfer.download(file,'alt-key',async()=>{throw Error('a failing address is not an expired one');});
  await mkdir(join(root,'assets')); await staged.commit(join(root,file.path));
  assert.deepEqual(asked, ['https://storage.example/out','https://origin.example/out']);
  assert.equal(await readFile(join(root,file.path),'utf8'),'video');
});

test('wrong checksums and unsafe or linked paths never become local media', async t => {
  const {root,transfer} = await fixture(t);
  const url = await server(t,(_req,res)=>res.end('wrong'));
  await assert.rejects(transfer.download({path:'assets/a.mp3',url,sha256:sha('right')},'key',async()=>{}),/checksum/);
  for (const path of ['../outside','assets/../outside','assets/a\\b','assets/C:/a']) await assert.rejects(transfer.download({path,url},'key',async()=>{}),/invalid/);
  await symlink(tmpdir(),join(root,'assets'));
  await assert.rejects(transfer.download({path:'assets/out.mp3',url},'key',async()=>{}),/link/);
});

test('a download that stops moving is cut and resumed where it stopped, not awaited until the deadline', async t => {
  const {root,transfer} = await fixture(t);
  const bytes = Buffer.from('0123456789abcdefghij');
  const was = IDLE_MS.value; IDLE_MS.value = 150; t.after(() => { IDLE_MS.value = was; });
  let asks = 0;
  const url = await server(t, (req, res) => {
    asks++;
    if (!req.headers.range) {
      /* half of it, then nothing more: a connection that stalls */
      res.writeHead(200, {'content-length': String(bytes.length), etag: '"e1"', 'content-type': 'audio/mpeg'});
      res.write(bytes.subarray(0, 10));
      return;
    }
    assert.equal(req.headers.range, 'bytes=10-');
    res.writeHead(206, {'content-range': `bytes 10-19/${bytes.length}`, 'content-length': '10', etag: '"e1"', 'content-type': 'audio/mpeg'});
    res.end(bytes.subarray(10));
  });
  const started = Date.now();
  const made = await transfer.download({path:'assets/audio/a.mp3',url,bytes:bytes.length,sha256:sha(bytes)}, 'key-idle', async () => ({path:'assets/audio/a.mp3',url}));
  assert.ok(Date.now() - started < 5000, 'cut after the quiet, not after a fixed long wait');
  assert.equal(asks, 2, 'resumed with a range');
  await mkdir(join(root,'assets/audio'), {recursive:true});
  await made.commit(join(root,'assets/audio/a.mp3'));
  assert.deepEqual(await readFile(join(root,'assets/audio/a.mp3')), bytes);
});
