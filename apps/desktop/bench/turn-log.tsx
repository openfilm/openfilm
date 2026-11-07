/**
 * The real turn log over a page of its own, its log made here: `n` events (thoughts, now and then a tool call), two
 * model requests, one with a picture as the log keeps it (its type, size and file). `live`: the turn runs, and each
 * read adds `grow` events, given as the app gives them: only what was written since the read before.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../shell/shell.css';
import '../chat/src/chat.css';

const query = new URLSearchParams(location.search);
const events: Array<Record<string, unknown> & { t: number; kind: string }> = [];
let t = 1_700_000_000_000;
function grow(n: number) {
  for (let i = 0; i < n; i += 1) {
    t += 5;
    const k = events.length;
    events.push(k === 0 ? { t, kind: 'prompt', agent: 'byok', text: 'make it' }
      : k % 50 === 0 ? { t, kind: 'update', update: { sessionUpdate: 'tool_call', toolCallId: `c${k}`, title: `read ${k}`, kind: 'read', status: 'pending' } }
        : { t, kind: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `thought ${k} ` } } });
  }
}
const calls = [
  { startedAt: t, ms: 900, prefix: 0, systemPrompt: 'be brief', messages: [{ role: 'user', content: 'make it' }], answer: { role: 'assistant', content: [{ type: 'toolCall', name: 'read', id: 'r1', arguments: { path: 'shot.png' } }] } },
  { startedAt: t + 1000, ms: 800, prefix: 1, messages: [{ role: 'toolResult', toolName: 'read', toolCallId: 'r1', content: [{ type: 'text', text: 'Read shot.png' }, { type: 'image', mimeType: 'image/png', bytes: 3_400_000, file: '.film/logs/images/0a1b.png' }] }], answer: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
];
grow(Number(query.get('n') ?? 50_000));

const reads: Array<{ since: unknown; events: number }> = [];
const each = Number(query.get('grow') ?? 0);
(window as any).openfilmDesktop = {
  chat: {
    reveal: async () => ({}),
    log: async (_project: string, _turnId: string, since?: { events: number; calls: number; callsFile: number }) => {
      if (since && each) grow(each);
      const from = since ? since.events : 0;
      reads.push({ since: since ?? null, events: events.length - from });
      if (since && from === events.length) return { same: true };
      return {
        file: '/project/.film/logs/local-x.jsonl', cut: false, whole: !since, events: events.slice(from),
        calls: since ? [] : calls, callsWhole: !since, callsCut: false, at: { events: events.length, calls: 2, callsFile: 1 },
      };
    },
  },
};
(window as any).turnLogFixture = { reads, count: () => events.length };

const { TurnLogButton } = await import('../chat/src/components/TurnLog');
createRoot(document.getElementById('root')!).render(
  <div className="of-chat">
    <TurnLogButton project="/project" turnId="local:x" live={query.has('live')} />
    <div id="of-chat-layer" className="of-chat" />
  </div>,
);
