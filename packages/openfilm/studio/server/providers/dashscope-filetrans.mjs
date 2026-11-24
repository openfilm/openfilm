// @ts-check
/** DashScope Filetrans uses private, temporary OSS objects for local recordings. */
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { mediaSeconds } from './common.mjs';

/** @typedef {{ key: string, url: URL }} Auth */
/** @typedef {import('./contract.mjs').RunContext} RunContext */

const TASK_ID = /^[a-f0-9-]{16,80}$/i;
const OSS_HOST = /^dashscope-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/;

/** Only accept DashScope's Alibaba Cloud OSS endpoints. Never forward the API key to OSS. */
function ossAddress(/** @type {unknown} */ address, /** @type {boolean} */ result = false) {
  if (typeof address !== 'string') throw new Error('DashScope did not return an OSS address.');
  const url = new URL(address);
  if (!OSS_HOST.test(url.hostname) || url.username || url.password || url.port || url.hash
      || (url.protocol !== 'https:' && !(result && url.protocol === 'http:'))) {
    throw new Error('DashScope returned an unrecognized OSS address.');
  }
  // Some Filetrans responses use an HTTP result URL. Read its signed object over TLS.
  url.protocol = 'https:';
  return url;
}

/** @param {URL} url @param {RequestInit} init @param {AbortSignal} signal @param {string} action */
async function request(url, init, signal, action) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
  if (!response.ok) throw new Error(`DashScope could not ${action} (HTTP ${response.status}).`);
  return response;
}

/** @param {Auth} auth @param {string} path @param {AbortSignal} signal @param {unknown} [body] */
async function dashscope(auth, path, signal, body) {
  const response = await request(new URL('/api/v1' + path, auth.url), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${auth.key}`,
      ...(body === undefined ? {} : {
        'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable',
      }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, signal, body === undefined ? 'read the Filetrans service' : 'submit Filetrans transcription');
  return response.json();
}

/** @param {Auth} auth @param {string} model @param {Uint8Array} audio @param {AbortSignal} signal */
async function stageAudio(auth, model, audio, signal) {
  const { data } = await dashscope(auth, '/uploads?action=getPolicy&model=' + encodeURIComponent(model), signal);
  if (!data || data.x_oss_object_acl !== 'private' || typeof data.upload_dir !== 'string'
      || !/^dashscope-instant\/[a-z0-9_/-]+$/i.test(data.upload_dir)) {
    throw new Error('DashScope did not grant a private temporary upload.');
  }
  const limit = Number(data.max_file_size_mb);
  if (Number.isFinite(limit) && limit > 0 && audio.byteLength > limit * 1024 * 1024) {
    throw new Error('The recording exceeds DashScope’s temporary upload limit.');
  }
  const filename = `openfilm-${randomUUID()}.mp3`;
  const object = `${data.upload_dir}/${filename}`;
  const fields = {
    OSSAccessKeyId: data.oss_access_key_id, Signature: data.signature, policy: data.policy,
    'x-oss-object-acl': 'private', 'x-oss-forbid-overwrite': 'true', key: object, success_action_status: '200',
  };
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !value) throw new Error('DashScope returned an incomplete upload policy.');
    form.set(name, value);
  }
  form.set('file', new Blob([Buffer.from(audio)], { type: 'audio/mpeg' }), filename);
  const uploaded = await request(ossAddress(data.upload_host), { method: 'POST', body: form }, signal, 'upload audio to private OSS');
  await uploaded.body?.cancel();
  return 'oss://' + object;
}

/** @param {Auth} auth @param {string} model @param {string} src @param {RunContext} ctx */
export async function fileTranscription(auth, model, src, ctx) {
  let id = ctx.resume?.kind === 'dashscope-filetrans' && ctx.resume.model === model ? ctx.resume.id : null;
  if (!TASK_ID.test(id ?? '')) {
    ctx.say('Uploading audio to Alibaba Cloud private temporary storage for Filetrans.');
    const url = await stageAudio(auth, model, await ctx.read(src), ctx.signal);
    const qwen3 = model.startsWith('qwen3-');
    const { output } = await dashscope(auth, '/services/audio/asr/transcription', ctx.signal, {
      model, input: qwen3 ? { file_url: url } : { file_urls: [url] },
      parameters: qwen3 ? { enable_words: true } : {},
    });
    id = output?.task_id;
    if (!TASK_ID.test(id ?? '')) throw new Error('DashScope did not start a Filetrans task.');
    await ctx.checkpoint?.({ kind: 'dashscope-filetrans', id, model });
  }

  ctx.say('Waiting for Alibaba Cloud Filetrans word timestamps.');
  let row;
  for (;;) {
    const { output } = await dashscope(auth, '/tasks/' + id, ctx.signal);
    if (output?.task_status === 'SUCCEEDED') {
      row = output.results?.[0] ?? output.result ?? output;
      break;
    }
    if (output?.task_status !== 'PENDING' && output?.task_status !== 'RUNNING') {
      throw new Error('DashScope Filetrans did not complete successfully.');
    }
    await wait(2000, undefined, { signal: ctx.signal });
  }
  if (row.subtask_status && row.subtask_status !== 'SUCCEEDED') {
    throw new Error('DashScope could not transcribe the uploaded audio.');
  }
  const response = await request(ossAddress(row.transcription_url, true), {}, ctx.signal, 'read the Filetrans result');
  const doc = await response.json();
  if (!Array.isArray(doc.transcripts)) throw new Error('DashScope returned an invalid Filetrans result.');
  const reported = Number(doc.properties?.original_duration_in_milliseconds) / 1000;
  const source = ctx.root ? await mediaSeconds(ctx.root, src) : null;
  const dur = source ?? (Number.isFinite(reported) && reported > 0 ? reported : null);
  const text = doc.transcripts.map((/** @type {{text?: string}} */ one) => one.text ?? '').join(' ');
  const words = doc.transcripts.flatMap((/** @type {any} */ one) => (one.sentences ?? []).flatMap((/** @type {any} */ sentence) => sentence.words ?? []))
    .filter((/** @type {any} */ word) => typeof word.text === 'string' && word.text.trim() && Number.isFinite(word.begin_time) && Number.isFinite(word.end_time))
    .map((/** @type {any} */ word) => ({ token: word.text.trim() + (word.punctuation ?? ''),
      start: Math.max(0, word.begin_time / 1000), end: Math.min(dur ?? Infinity, word.end_time / 1000) }))
    .filter((/** @type {{start:number,end:number}} */ word) => word.end > word.start)
    .sort((/** @type {{start:number}} */ a, /** @type {{start:number}} */ b) => a.start - b.start);
  if (text.trim() && !words.length) throw new Error('DashScope returned Filetrans speech without word timestamps.');
  return { text, words, dur };
}
