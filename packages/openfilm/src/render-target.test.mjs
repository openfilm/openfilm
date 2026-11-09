import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from './render.mjs';
import { encoders } from './encoders.mjs';

test('a stopped targeted render resumes only with the same target, and automatic exports never reuse it', { timeout: 120000 }, async (t) => {
  if (!(await encoders()).has('libx264')) return t.skip('no libx264');
  const dir = mkdtempSync(join(tmpdir(), 'of-target-resume-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><body style="margin:0"><script>window.film={width:160,height:90,duration:25,frame(t){document.body.style.background=`hsl(${t*30},80%,50%)`}}</script>');
    const basic = { out: join(dir, 'out.mp4'), workers: 1, fps: 2, silent: true, hardware: false };
    const format = (value) => ({ video: ['-c:v', 'libx264', '-preset', 'medium'], target: { kind: 'bitrate', value }, targetAudioBps: 192000 });
    const fail = () => assert.rejects(render([dir], { ...basic, format: format(.3), onProgress(n) { if (n === 22) throw new Error('interrupted render'); } }), /interrupted render/);
    await fail();
    const same = await render([dir], { ...basic, format: format(.3), onProgress() {} });
    assert.ok(same.lines.some((line) => /1 of 2 chunks were drawn/.test(line)), same.lines.join('\n'));
    for (const changed of [{ format: format(.6) }, {}]) {
      await fail();
      const result = await render([dir], { ...basic, ...changed, onProgress() {} });
      assert.equal(result.lines.some((line) => /chunks were drawn/.test(line)), false, 'changed target or automatic quality draws every chunk again');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
