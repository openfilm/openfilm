/**
 * The app's own agent (pi-agent.mjs) and the connectors: the MCP servers a session is given (ACP `session/new`'s
 * `mcpServers`: the connectors' doors here, connectors.mjs) become tools of Pi's, each named by its server and its own
 * name, labelled as the chat shows it ("Notion · Search"). A tool that may change something in the service is asked of
 * the person at the door (connectors.mjs `confirm`), as for every agent; a refusal comes back as the tool's error.
 */
import { McpClient, StreamableHttpTransport, toLlmContent } from '@earendil-works/pi-mcp';

/* how long a server is waited for as a session opens: one that does not answer is left out of it */
const CONNECT_MS = 15_000;

/** A tool's name as model services take it: at most 64 of [A-Za-z0-9_-]. */
export const toolName = (server, tool) => `${server}_${tool}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);

/** A server's name as people know it: its own title, without "MCP"/"server", else its name with a capital. */
export function serverTitle(info, name) {
  const own = String(info?.title ?? info?.name ?? '').replace(/\b(mcp|server)\b/gi, '').replace(/\s+/g, ' ').trim();
  return own && own.length <= 24 ? own : name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Pi's tools for the servers given, each server connected (those that cannot be are left out, said in `log`).
 * @param {Array<{ type?: string, name: string, url?: string, headers?: Array<{ name: string, value: string }> }>} servers
 * @param {{ log?: (line: string) => void, fetch?: typeof fetch }} [o]
 */
export async function connectorTools(servers, o = {}) {
  const log = o.log ?? (() => {});
  const clients = [];
  /** @type {Map<string, { title: string, readOnly: boolean }>} */
  const labels = new Map();
  const tools = [];
  await Promise.all((servers ?? []).filter((s) => (s.type ?? 'http') === 'http' && typeof s.url === 'string').map(async (s) => {
    const client = new McpClient({ name: 'OpenFilm', version: '1' });
    const headers = Object.fromEntries((s.headers ?? []).map((h) => [h.name, h.value]));
    try {
      await Promise.race([
        client.connect(new StreamableHttpTransport({ url: s.url, headers, openGetStream: false, ...(o.fetch ? { fetch: o.fetch } : {}) })),
        new Promise((_, fail) => setTimeout(() => fail(new Error('no answer')), CONNECT_MS).unref?.()),
      ]);
      const offered = await client.listTools({ timeoutMs: CONNECT_MS });
      const title = serverTitle(client.serverInfo, s.name);
      clients.push(client);
      for (const tool of offered) {
        const name = toolName(s.name, tool.name);
        const readOnly = tool.annotations?.readOnlyHint === true;
        const label = `${title} · ${tool.title ?? tool.annotations?.title ?? tool.name}`;
        labels.set(name, { title: label, readOnly });
        const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {};
        tools.push({
          name, label,
          description: `${title}: ${tool.description ?? tool.name}`,
          /* model services take an object schema, some only one with `properties` */
          parameters: { ...schema, type: 'object', properties: schema.properties ?? {} },
          async execute(_toolCallId, params, signal) {
            const result = await client.callTool(tool.name, params && typeof params === 'object' ? params : {}, { signal });
            return { content: toLlmContent(result), details: {}, isError: result.isError === true };
          },
        });
      }
      log(`connector ${s.name}: ${offered.length} tools`);
    } catch (e) {
      log(`connector ${s.name} left out: ${e instanceof Error ? e.message : e}`);
      await client.close().catch(() => {});
    }
  }));
  return { tools, labels, close: () => Promise.all(clients.map((c) => c.close().catch(() => {}))) };
}
