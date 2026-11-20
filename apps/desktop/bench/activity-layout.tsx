/** Isolated rendering of the real conversation and scrolling hooks, without an agent or personal chat data. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectConversation, primeStoredTranscript } from '../chat/src/components/ProjectConversation';
import { StickToBottomContext, useStickToBottom, useTailSpacer } from '../chat/src/components/useStickToBottom';
import { ActAssetUrlContext } from '../chat/src/components/AgentActivityRow';
import type { TranscriptItem } from '../chat/src/lib/agent-transcript';
import type { ProjectVersion } from '../chat/src/components/project-version';
import { setLanguage } from '../chat/src/i18n';
import '../shell/shell.css';
import '../chat/src/chat.css';

const transcript = (startedAt: number): TranscriptItem[] => [
  { id: 'intro', kind: 'text', text: 'I will check the project first.', pending: false },
  { id: 'read', kind: 'act', act: 'files.read', detail: 'film.html', pending: false },
  { id: 'update', kind: 'text', text: 'The files are ready. Checking the result next.', pending: false },
  { id: 'check', kind: 'act', act: 'command.run', detail: 'openfilm check', pending: false },
  { id: 'search', kind: 'act', act: 'files.search', detail: '**/*.{html,md}', pending: true, startedAt },
  { id: 'answer', kind: 'text', text: 'Final answer anchor.', pending: true },
];

/** A 1×1 PNG, so a made picture draws without a server. */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const assetUrl = () => PIXEL;

function Fixture() {
  const [phase, setPhase] = React.useState('running');
  const active = phase === 'running' || phase === 'tools-finished' || phase === 'second-tool';
  const toolPending = phase === 'running';
  const params = new URLSearchParams(location.search);
  const scenario = params.get('scenario') ?? 'group';
  const initial = React.useMemo<TranscriptItem[]>(() => {
    const startedAt = Date.now() - 5000;
    if (scenario === 'idle') return [];
    if (scenario === 'working-command') return Array.from({ length: 9 }, (_, i) => ({
      id: `command-${i}`, kind: 'act', act: 'command.run', pending: false,
    }));
    if (scenario === 'asset') return [
      { id: 'intro', kind: 'text', text: 'I will make a picture first.', pending: false },
      { id: 'image', kind: 'act', act: 'asset.genImage', detail: 'A red pixel', pending: false, asset: { kind: 'image', src: 'assets/pixel.png' } },
    ];
    if (scenario === 'thinking') return [
      { id: 'intro', kind: 'text', text: 'I will check the project first.', pending: false },
      { id: 'thought', kind: 'thought', pending: true, startedAt },
      { id: 'answer', kind: 'text', text: 'Final answer anchor.', pending: true },
    ];
    if (scenario === 'counts') return [
      { id: 'intro', kind: 'text', text: 'I will check the project first.', pending: false },
      ...Array.from({ length: 9 }, (_, i): TranscriptItem => ({
        id: `edit-${i}`, kind: 'act', act: 'files.edit', pending: i === 8, startedAt,
      })),
      { id: 'check', kind: 'act', act: 'command.run', pending: false },
      { id: 'read', kind: 'act', act: 'files.read', pending: false },
      { id: 'answer', kind: 'text', text: 'Final answer anchor.', pending: true },
    ];
    return scenario === 'single' ? [
      { id: 'intro', kind: 'text', text: 'I will check the project first.', pending: false },
      { id: 'command', kind: 'act', act: 'command.run', detail: 'openfilm check --project example-with-a-long-folder-name', pending: true, startedAt },
      { id: 'answer', kind: 'text', text: 'Final answer anchor.', pending: true },
    ] : transcript(startedAt);
  }, [scenario]);
  // Real transcript updates preserve unchanged object identities; this also exercises the row cache.
  const items = React.useMemo(() => initial.map((item) => item.pending
    ? { ...item, pending: item.kind === 'act' || item.kind === 'thought' ? toolPending : active } : item)
    .concat(phase === 'second-tool' || (scenario === 'working-command' && phase === 'tools-finished')
      ? [{ id: 'after', kind: 'act', act: 'command.run', detail: 'openfilm check', pending: phase === 'second-tool', startedAt: Date.now() }]
      : []),
  [initial, active, toolPending, phase, scenario]);
  const thread = useStickToBottom();
  const tail = useTailSpacer(thread.viewport, thread.pinIfFollowing, active);
  const turns: ProjectVersion[] = [{
    assetId: 'layout-turn', label: '', title: '', prompt: 'Check the project.', attachments: [], current: true,
    status: active ? 'active' : 'ready', durationMs: active ? undefined : 6000, agent: 'copilot', model: 'Auto',
  }];
  if (!active) primeStoredTranscript('layout-turn', items);
  if (phase === 'next') turns.push({
    assetId: 'pending:next', label: '', title: '', prompt: 'Continue.', attachments: [], current: true, status: 'active',
  });
  React.useEffect(() => {
    (window as any).activityFixture = {
      finishTool: () => setPhase('tools-finished'), finish: () => setPhase('finished'), next: () => setPhase('next'),
      addTool: () => setPhase('second-tool'),
    };
  }, []);
  return (
    <ActAssetUrlContext.Provider value={assetUrl}>
    <StickToBottomContext.Provider value={thread}>
      <div className="of-chat" style={{ width: Number(params.get('width') ?? 440), margin: 20 }}>
        <div data-activity-viewport ref={thread.viewportRef} style={{ height: Number(params.get('height') ?? 620), overflowY: 'auto', overflowAnchor: 'none' }}>
          <div ref={thread.contentRef} style={{ padding: 12 }}>
            <div aria-hidden style={{ height: Number(params.get('above') ?? 0) }} />
            <ProjectConversation turns={turns} liveAssetId={active ? 'layout-turn' : null} liveTranscript={items}
              liveActive={active} liveActivity={null} lastTurnRef={tail.lastTurnRef} />
          </div>
        </div>
      </div>
    </StickToBottomContext.Provider>
    </ActAssetUrlContext.Provider>
  );
}

setLanguage(new URLSearchParams(location.search).get('locale') ?? 'en');
createRoot(document.getElementById('root')!).render(<Fixture />);
