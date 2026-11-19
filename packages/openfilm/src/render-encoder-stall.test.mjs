import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const available = process.platform !== 'win32' && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('a hardware encoder hanging on input/flush falls back to software; cancellation interrupts its final flush', { skip: !available, timeout: 90_000 }, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-encoder-stall-'));
  const hardware = process.platform === 'darwin' ? 'h264_videotoolbox' : 'h264_nvenc';
  try {
    const real = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
    const bin = join(scratch, 'bin');
    mkdirSync(bin);
    const wrapper = join(bin, 'ffmpeg');
    writeFileSync(join(scratch, 'stalls'), '');
    /* Encoder probes succeed, then the driver stops taking input or exiting. Every software invocation is real. */
    writeFileSync(wrapper, `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('-encoders')) {
  const result = spawnSync(${JSON.stringify(real)}, args, { encoding: 'utf8' });
  process.stdout.write(result.stdout + ${JSON.stringify(`\n V..... ${hardware} fake hardware for regression\n`)});
  process.exit(result.status);
}
if (args.includes(${JSON.stringify(hardware)})) {
  if (args.includes('image2pipe')) {
    appendFileSync(${JSON.stringify(join(scratch, 'stalls'))}, ${JSON.stringify('blocked\n')});
    process.stdin.pause();
    setInterval(() => {}, 1000);
  } else process.exit(0);
} else {
  const result = spawnSync(${JSON.stringify(real)}, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
`);
    chmodSync(wrapper, 0o755);
    /* Run the fixture once before starting the encoder's short inactivity deadline. */
    execFileSync(wrapper, ['-version'], { timeout: 15_000, stdio: 'ignore' });
    writeFileSync(join(scratch, 'index.html'), '<!doctype html><body style="margin:0;background:#357"><script>window.film={duration:1,width:160,height:90,frame(){}}</script>');
    writeFileSync(join(scratch, 'noise.html'), '<!doctype html><body style="margin:0"><canvas width="512" height="288"></canvas><script>const c=document.querySelector("canvas").getContext("2d"),d=c.createImageData(512,288);let n=17;for(let i=0;i<d.data.length;i+=4){n=(Math.imul(n,1664525)+1013904223)>>>0;d.data[i]=n&255;d.data[i+1]=(n>>>8)&255;d.data[i+2]=(n>>>16)&255;d.data[i+3]=255;}c.putImageData(d,0,0);window.film={duration:1,width:512,height:288,frame(){}}</script>');
    const script = join(scratch, 'exercise.mjs');
    const out = join(scratch, 'done.mp4');
    writeFileSync(script, `import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { render } from ${JSON.stringify(new URL('./render.mjs', import.meta.url).href)};
const encoders=[];
const marks=()=> (readFileSync(${JSON.stringify(join(scratch, 'stalls'))},'utf8').match(/blocked/g) ?? []).length;
let written=0;
await assert.rejects(render([${JSON.stringify(join(scratch, 'noise.html'))}], { out:${JSON.stringify(join(scratch, 'blocked.mp4'))}, workers:1, fps:10, silent:true, encoderTimeoutMs:2000,
  format:{video:['-c:v',${JSON.stringify(hardware)}]}, onProgress(done){written=done;} }),error=>error.code==='ENCODER_STALLED');
assert.ok(written<10,'large frames block the input pipe before the final flush');
const before=marks();
assert.equal(before,1,'the fake driver has started before the input times out');
const result=await render([${JSON.stringify(scratch)}], { out:${JSON.stringify(out)}, workers:1, fps:10, silent:true, encoderTimeoutMs:2000,
  onProgress(){}, onEncoder(value){ encoders.push(value); } });
assert.equal(result.encoder,'libx264');
assert.equal(encoders[0],${JSON.stringify(hardware)});
assert.equal(encoders.at(-1),'libx264');
assert.equal(marks(),before+1,'a hung driver gets no second bitrate attempt');
const stop=new AbortController();
const guard=setTimeout(()=>stop.abort(),10_000);
let flushed=false, waiting;
await assert.rejects(render([${JSON.stringify(scratch)}], { out:${JSON.stringify(join(scratch, 'cancelled.mp4'))}, workers:1, fps:10, silent:true,
  format:{video:['-c:v',${JSON.stringify(hardware)}]}, signal:stop.signal,
  onProgress(done,total){ if(done===total){ flushed=true; waiting=setInterval(()=>{
    if(marks()===before+2){clearInterval(waiting);stop.abort();}
  },10); } } }),/cancelled/).finally(()=>{clearInterval(waiting);clearTimeout(guard);});
assert.equal(flushed,true);
assert.equal(marks(),before+2,'cancellation happens after the encoder has started its final flush');
writeFileSync(${JSON.stringify(join(scratch, 'result.json'))},JSON.stringify({encoders,cancelled:true,written}));
`);
    execFileSync(process.execPath, [script], { env: { ...process.env, PATH: bin + delimiter + process.env.PATH }, timeout: 75_000, stdio: 'pipe' });
    const result = JSON.parse(readFileSync(join(scratch, 'result.json'), 'utf8'));
    assert.equal(result.cancelled, true);
    assert.ok((readFileSync(join(scratch, 'stalls'), 'utf8').match(/blocked/g) ?? []).length >= 3);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,nb_read_frames', '-of', 'json', out], { encoding: 'utf8' }));
    assert.equal(probe.streams[0].codec_name, 'h264');
    assert.equal(Number(probe.streams[0].nb_read_frames), 10);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
