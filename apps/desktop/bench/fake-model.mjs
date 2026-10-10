/**
 * A model service for the benchmark: the OpenAI Responses API on 127.0.0.1, answering every turn with the same script
 * at the same pace, so a run streams what the last one did. The app's own-key agent (Codex) talks to it as it would
 * to OpenAI, so the chat is fed through the real path: Codex, its ACP adapter, the main process, the chat page.
 *
 * A turn is DEFAULT_STEPS steps (or one a command given), each a thought, a paragraph streamed a few characters at a time and one shell command (a
 * harmless `ls`, which Codex runs and reports back), then a closing answer. Which step comes next is read from the
 * request: the number of command results already in it. The picture probe that setting up a key sends is answered at
 * once, as a model that reads pictures would.
 */
import { createServer } from 'node:http';

const DEFAULT_STEPS = 12;
const CHUNK = 4;      // characters per streamed delta
const CHUNK_MS = 25;  // between deltas: about 40 tokens a second, a fast model's pace

const PARAGRAPH = (i) => `Step ${i + 1}: I looked at **shot ${i + 1}** and the beat it sits on. The cut lands a frame late, so I'll ` +
  'pull it in and keep the title clear of the car:\n\n- the in point moves to `0.75 s`\n- the lower third waits for the second beat\n' +
  '- nothing else on the track moves\n\nChecking the folder before I write it.';
const ANSWER = 'Done. Here is what changed in the cut:\n\n' + Array.from({ length: DEFAULT_STEPS }, (_, i) =>
  `${i + 1}. **Shot ${i + 1}** now starts on the beat, ${(0.75 * (i + 1)).toFixed(2)} s in, and its title keeps clear of the car.`).join('\n') +
  '\n\n```text\nfilm.html  +12 −9\nscenes/title.html  +4 −2\n```\n\nPlay it from the start: every cut lands on the music now, and the end card holds for a full bar.';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let ids = 0;
const id = (p) => `${p}_${(ids += 1).toString(36)}`;

/** The shell tool this Codex offers, and arguments that run `cmd` with it. */
function shellCall(tools, cmd) {
  const names = new Set((tools ?? []).map((t) => t.name ?? t.type));
  if (names.has('exec_command')) return { name: 'exec_command', arguments: JSON.stringify({ cmd }) };
  if (names.has('shell_command')) return { name: 'shell_command', arguments: JSON.stringify({ command: cmd }) };
  return { name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', cmd] }) };
}

const doneCalls = (input) => (Array.isArray(input) ? input.filter((item) => item?.type === 'function_call_output').length : 0);

/**
 * `commands`: what each step runs, in place of `ls` (a turn that works the project as a real one does: brings media in,
 * edits the film, looks at it); the turn has as many steps as there are commands.
 * @param {{ log?: (line: string) => void, commands?: string[] }} [opts]
 */
export function startFakeModel(opts = {}) {
  const log = opts.log ?? (() => {});
  const STEPS = opts.commands?.length ?? DEFAULT_STEPS;
  const commandAt = (step) => opts.commands?.[step] ?? 'ls';
  const stats = { requests: 0, turns: 0, steps: 0 };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    let json = {};
    try { json = body ? JSON.parse(body) : {}; } catch { /* not JSON */ }
    stats.requests += 1;
    log(`${req.method} ${req.url} stream=${json.stream === true} input=${Array.isArray(json.input) ? json.input.length : 0}`);
    if (req.method === 'GET' && /\/models\/?$/.test(req.url ?? '')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'bench', object: 'model' }] }));
      return;
    }
    if (!/\/responses\/?$/.test(req.url ?? '')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":{"message":"not here"}}'); return; }
    if (json.stream !== true) {
      /* the picture probe, or any one-off question: a short answer */
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: id('resp'), object: 'response', status: 'completed', output: [{ type: 'message', id: id('msg'), role: 'assistant', content: [{ type: 'output_text', text: 'Red' }] }], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    let seq = 0;
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: (seq += 1), ...data })}\n\n`);
    const responseId = id('resp');
    send('response.created', { response: { id: responseId, object: 'response', status: 'in_progress', output: [] } });
    const step = doneCalls(json.input);
    if (step === 0) stats.turns += 1;
    let index = 0;
    const output = [];

    /* a thought */
    const reasoningId = id('rs');
    const thought = step < STEPS ? `Looking at shot ${step + 1} against the beat grid.` : 'Writing up what changed.';
    send('response.output_item.added', { output_index: index, item: { type: 'reasoning', id: reasoningId, summary: [] } });
    send('response.reasoning_summary_part.added', { item_id: reasoningId, output_index: index, summary_index: 0, part: { type: 'summary_text', text: '' } });
    for (let i = 0; i < thought.length; i += CHUNK) { send('response.reasoning_summary_text.delta', { item_id: reasoningId, output_index: index, summary_index: 0, delta: thought.slice(i, i + CHUNK) }); await sleep(CHUNK_MS); }
    send('response.reasoning_summary_text.done', { item_id: reasoningId, output_index: index, summary_index: 0, text: thought });
    const reasoning = { type: 'reasoning', id: reasoningId, summary: [{ type: 'summary_text', text: thought }] };
    send('response.output_item.done', { output_index: index, item: reasoning });
    output.push(reasoning);
    index += 1;

    /* what it says, streamed */
    const text = step < STEPS ? PARAGRAPH(step) : ANSWER;
    const msgId = id('msg');
    send('response.output_item.added', { output_index: index, item: { type: 'message', id: msgId, role: 'assistant', status: 'in_progress', content: [] } });
    send('response.content_part.added', { item_id: msgId, output_index: index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    for (let i = 0; i < text.length; i += CHUNK) {
      if (res.destroyed) return;
      send('response.output_text.delta', { item_id: msgId, output_index: index, content_index: 0, delta: text.slice(i, i + CHUNK) });
      await sleep(CHUNK_MS);
    }
    send('response.output_text.done', { item_id: msgId, output_index: index, content_index: 0, text });
    const message = { type: 'message', id: msgId, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
    send('response.output_item.done', { output_index: index, item: message });
    output.push(message);
    index += 1;

    /* and one command, until the steps are done */
    if (step < STEPS) {
      const call = { type: 'function_call', id: id('fc'), call_id: id('call'), status: 'completed', ...shellCall(json.tools, commandAt(step)) };
      send('response.output_item.added', { output_index: index, item: { ...call, arguments: '' } });
      send('response.function_call_arguments.done', { item_id: call.id, output_index: index, arguments: call.arguments });
      send('response.output_item.done', { output_index: index, item: call });
      output.push(call);
      stats.steps += 1;
    }
    send('response.completed', { response: { id: responseId, object: 'response', status: 'completed', output, usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 20 }, total_tokens: 1200 } } });
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ port, baseUrl: `http://127.0.0.1:${port}/v1`, stats, close: () => new Promise((done) => server.close(() => done(undefined))) });
    });
  });
}

/** How long one scripted turn streams, about. */
export const TURN_SECONDS = Math.round(((DEFAULT_STEPS * PARAGRAPH(0).length + ANSWER.length) / CHUNK) * CHUNK_MS / 1000);
