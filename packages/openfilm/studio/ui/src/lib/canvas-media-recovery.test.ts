import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingCanvasMedia } from './canvas-media-recovery.ts';

function memory() {const data=new Map<string,string>();return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};}
const request=(out:string,prompt='a portrait')=>({verb:'image',args:{out,prompt,quality:'high'}});
const pick={via:'openfilm',model:'openai/gpt-image-2.6-flare'};

test('canvas retries keep their original output across reloads; completed results allow a deliberate new take',async()=>{
  const storage=memory(),scope=['project','board','portrait','account-a'];
  const first=await pendingCanvasMedia(scope,request('portrait-first'),pick,storage);
  const retried=await pendingCanvasMedia(scope,request('portrait-another-timestamp'),pick,storage);
  assert.equal(retried.request.args.out,first.request.args.out);assert.equal(retried.resumed,true);
  assert.ok(![...storage.data.values()].join('').includes('a portrait'),'the journal holds no prompt or credentials');
  retried.finish();
  const next=await pendingCanvasMedia(scope,request('portrait-next'),pick,storage);
  assert.equal(next.request.args.out,'portrait-next');assert.equal(next.resumed,false);
  const other=await pendingCanvasMedia([...scope.slice(0,-1),'account-b'],request('other-account'),pick,storage);
  assert.equal(other.request.args.out,'other-account');assert.equal(other.resumed,false);
  const changed=await pendingCanvasMedia(scope,request('different-prompt','a landscape'),pick,storage);
  assert.equal(changed.resumed,false);
});

test('unreadable or unwritable recovery state stops before a paid request can start',async()=>{
  const storage=memory();await pendingCanvasMedia('node',request('first'),pick,storage);
  for(const key of storage.data.keys())storage.data.set(key,'damaged');
  await assert.rejects(pendingCanvasMedia('node',request('second'),pick,storage),/damaged/);
  await assert.rejects(pendingCanvasMedia('another-node',request('second'),pick,{...storage,setItem:()=>{throw Error('quota');}}),/No new generation/);
});

test('a canvas retry with a new timestamp recovers the same OpenFilm task instead of paying for another generation',async t=>{
  const root=await mkdtemp(join(tmpdir(),'canvas-media-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let generations=0;
  const server=createServer(async(req,res)=>{
    for await(const _chunk of req){}
    if(req.url==='/v1/media/ack'){res.writeHead(200,{'content-type':'application/json'}).end('{}');return;}
    if(req.method==='POST')generations++;
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({files:[{path:'assets/image/portrait.png',base64:Buffer.from('picture').toString('base64')}],receipt:{src:'assets/image/portrait.png'}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const saved=process.env.OPENFILM_API_URL;process.env.OPENFILM_API_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  t.after(()=>{if(saved===undefined)delete process.env.OPENFILM_API_URL;else process.env.OPENFILM_API_URL=saved;});
  const {default:openfilm}=await import('../../../server/providers/openfilm.mjs');
  const ctx={key:'ofk_test0123456789',root,model:pick.model,signal:new AbortController().signal,say:()=>{},read:async()=>new Uint8Array()};
  const storage=memory(),first=await pendingCanvasMedia('portrait-node',request('portrait-old-timestamp'),pick,storage);
  const interrupted=await openfilm.run('image',first.request.args,ctx);await interrupted.cleanup?.();
  const retry=await pendingCanvasMedia('portrait-node',request('portrait-new-timestamp'),pick,storage);
  const recovered=await openfilm.run('image',retry.request.args,ctx);
  assert.equal(generations,1);assert.equal(retry.resumed,true);
  assert.equal(Buffer.from((recovered.files[0] as {bytes:Uint8Array}).bytes).toString(),'picture');
  await recovered.complete?.();await recovered.cleanup?.();retry.finish();
  assert.equal(storage.data.size,0);
});
