// The app's own agent's connector tools (pi-connectors.mjs): a server's tools as Pi's, labelled by the service, one that
// changes things asked for first; a server that cannot be reached left out.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { connectorTools, serverTitle, toolName } from './pi-connectors.mjs';

async function mcpServer() {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const m = JSON.parse(Buffer.concat(chunks).toString());
    if (!('id' in m)) { res.writeHead(202).end(); return; }
    if (m.method === 'tools/call') calls.push([m.params.name, m.params.arguments]);
    const result = m.method === 'initialize' ? { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'notion-mcp', title: 'Notion MCP', version: '1' } }
      : m.method === 'tools/list' ? { tools: [
        { name: 'search', title: 'Search', description: 'Searches pages.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, annotations: { readOnlyHint: true } },
        { name: 'create-page', description: 'Makes a page.', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: `did ${m.params.name}` }] };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, calls, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

test('a connector\'s tools are Pi\'s, labelled by the service, run as called (the door asks the person about changes)', async (t) => {
  const svc = await mcpServer();
  t.after(() => svc.close());
  const lines = [];
  const { tools, labels, close } = await connectorTools([
    { type: 'http', name: 'notion', url: svc.url, headers: [] },
    { type: 'http', name: 'gone', url: 'http://127.0.0.1:9/mcp', headers: [] },
    { name: 'program', command: 'x', args: [], env: [] },
  ], { log: (line) => lines.push(line) });
  t.after(close);
  assert.deepEqual(tools.map((x) => [x.name, x.label]), [['notion_search', 'Notion · Search'], ['notion_create-page', 'Notion · create-page']]);
  assert.deepEqual([...labels].map(([name, l]) => [name, l.readOnly]), [['notion_search', true], ['notion_create-page', false]]);
  assert.equal(tools[0].parameters.type, 'object');
  assert.deepEqual(tools[1].parameters.properties, {}, 'an object schema with properties, as model services want');
  assert.ok(lines.some((l) => /gone left out/.test(l)), 'one that cannot be reached is left out, said');
  assert.equal((await tools[0].execute('c1', { query: 'script' })).content[0].text, 'did search');
  assert.equal((await tools[1].execute('c2', { title: 'Shot list' })).content[0].text, 'did create-page');
  assert.deepEqual(svc.calls.map((c) => c[0]), ['search', 'create-page']);
});

test('a tool\'s name fits what model services take, and a server is called by its own title', () => {
  assert.equal(toolName('notion', 'notion-search.pages'), 'notion_notion-search_pages');
  assert.equal(toolName('x', 'y'.repeat(80)).length, 64);
  assert.equal(serverTitle({ name: 'Dropbox MCP Server' }, 'dropbox'), 'Dropbox');
  assert.equal(serverTitle({ name: 'a-very-long-internal-server-name-for-tools' }, 'frameio'), 'Frameio');
  assert.equal(serverTitle(undefined, 'vimeo'), 'Vimeo');
});
