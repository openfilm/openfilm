import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,mkdir,readFile,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mediaInput } from './media-input.mjs';
import { wav } from './providers/common.mjs';

test('file-backed uploads reopen the source for retry, hash the complete input and reject edits during upload', async t => {
  const root=await mkdtemp(join(tmpdir(),'media-input-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'assets'));
  const bytes=Buffer.alloc(1024*1024,7),path='assets/参考 & #1.webm';
  await writeFile(join(root,path),bytes);
  const source=await mediaInput(root,path,{signal:new AbortController().signal});
  assert.equal(source.size,bytes.length);
  assert.equal(source.version,createHash('sha256').update(bytes).digest('hex')+':original');
  for(let attempt=0;attempt<2;attempt++) {
    let size=0;for await(const chunk of source.stream())size+=chunk.length;
    assert.equal(size,bytes.length);
  }
  await source.verify();
  await writeFile(join(root,path),Buffer.alloc(1024,9));
  await assert.rejects(source.verify(),/changed during upload/);
  await source.dispose();
  assert.equal((await readFile(join(root,path))).length,1024,'disposing a raw upload never deletes the source');
});

test('speech is prepared on disk as a small MP3 and temporary data is removed after use', async t => {
  const root=await mkdtemp(join(tmpdir(),'media-speech-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'assets'));await writeFile(join(root,'assets/voice.wav'),wav(new Uint8Array(32000),16000));
  const source=await mediaInput(root,'assets/voice.wav',{speech:true,signal:new AbortController().signal});
  assert.match(source.version,/:mp3-16k-mono-32k-v1$/);
  assert.ok(source.size>0&&source.size<32000);
  let size=0;for await(const chunk of source.stream())size+=chunk.length;assert.equal(size,source.size);
  await source.dispose();
  await assert.rejects(async()=>{for await(const _chunk of source.stream()){}},/ENOENT/);
});
