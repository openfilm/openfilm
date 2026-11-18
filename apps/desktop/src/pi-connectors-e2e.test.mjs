// A connector from the person's switch to the app's own agent's turn: a connector on (prefs), signed in (the app's
// `connectorsFor`), is given to Pi's session (ACP mcpServers), its tools are Pi's, the model calls one, and what the
// service answered goes back to the model.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AgentSession } from './agents.mjs';

/** Notion as an MCP server: one tool, its answers noted. */
async function notion() {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const m = JSON.parse(Buffer.concat(chunks).toString());
    if (!('id' in m)) { res.writeHead(202).end(); return; }
    if (m.method === 'tools/call') calls.push(m.params);
    const result = m.method === 'initialize' ? { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Notion MCP', version: '1' } }
      : m.method === 'tools/list' ? { tools: [{ name: 'search', title: 'Search', description: 'Searches the workspace.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, annotations: { readOnlyHint: true } }] }
        : { content: [{ type: 'text', text: 'Launch script: open on the product, 3 beats, end on the logo.' }] };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, calls, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

/** A model on the Chat Completions API: first it calls Notion's search, then it answers; each request kept. */
async function model() {
  const bodies = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      bodies.push(JSON.parse(body || '{}'));
      const chunk = (choice) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [choice] })}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (bodies.length === 1) {
        res.end(chunk({ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'notion_search', arguments: '{"query":"launch script"}' } }] }, finish_reason: null })
          + chunk({ index: 0, delta: {}, finish_reason: 'tool_calls' }) + 'data: [DONE]\n\n');
        return;
      }
      res.end(chunk({ index: 0, delta: { role: 'assistant', content: 'Found it.' }, finish_reason: null }) + chunk({ index: 0, delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { bodies, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() };
}

test('a connector on and signed in is the app\'s own agent\'s: Pi calls its tool and the model reads what the service said', { timeout: 90_000 }, async () => {
  const svc = await notion();
  const llm = await model();
  const cwd = mkdtempSync(join(tmpdir(), 'of-pi-connector-'));
  const prefsHome = mkdtempSync(join(tmpdir(), 'of-pi-prefs-'));
  mkdirSync(prefsHome, { recursive: true });
  writeFileSync(join(prefsHome, 'prefs.json'), JSON.stringify({ plugins: { notion: true } }));
  const given = [];
  const updates = [];
  const session = new AgentSession({
    agent: 'byok', cwd,
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-home-')), models: [{ id: 'm', name: 'm', api: 'openai-completions', baseUrl: llm.url, keyEnv: 'OPENFILM_BYOK_KEY_m', model: 'm', levels: ['auto'], effort: 'auto' }], model: 'm', env: { OPENFILM_BYOK_KEY_m: 'k' } },
    skills: { dataDir: mkdtempSync(join(tmpdir(), 'of-pi-data-')), prefsHome,
      /* the app's door for each connector signed in (connectors.mjs forSession): here the service itself */
      connectorsFor: async (servers) => { given.push(...servers.map((s) => s.plugin)); return servers.filter((s) => s.plugin === 'notion').map((s) => ({ ...s, type: 'http', url: svc.url })); } },
    onUpdate: (update) => updates.push(update),
  });
  try {
    await session.start();
    assert.deepEqual(given, ['notion'], 'only the connector on is asked for');
    await session.prompt([{ type: 'text', text: 'use the launch script in Notion' }]);
    /* the model was offered the tool, called it, and read the answer */
    assert.ok(llm.bodies[0].tools.some((t) => t.function?.name === 'notion_search'), 'offered to the model');
    assert.deepEqual(svc.calls, [{ name: 'search', arguments: { query: 'launch script' } }]);
    const second = JSON.stringify(llm.bodies[1].messages);
    assert.match(second, /Launch script: open on the product/);
    /* the chat drew the call as Notion's */
    const call = updates.find((u) => u.sessionUpdate === 'tool_call');
    assert.equal(call.title, 'Notion · Search');
    assert.equal(call.kind, 'fetch');
  } finally {
    session.close();
    llm.close();
    await svc.close();
    /* Windows will not remove a folder a process still works in */
    await session.ended();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(prefsHome, { recursive: true, force: true });
  }
});
