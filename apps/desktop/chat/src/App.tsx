/**
 * The chat beside Studio: a conversation with an agent (the app's own, or the person's own Claude Code or Codex) about
 * the project Studio shows; switching projects there switches the conversations here.
 *
 * Kept on this Mac: the sessions per project folder (lib/local-sessions), each turn and what the agent did in it
 * (lib/local-agent-run's saved turns).
 */
import React from 'react';
import { ArrowDown, Coins, CornerDownLeft, LibraryBig, Loader2, Play, Plus, ShieldQuestion, Square, X } from 'lucide-react';
import { buildPromptDisplay, type Turn } from '@openfilm/shared';
import { useT } from '@/i18n';
import { ConversationSessionBar } from '@/components/ConversationSessionBar';
import { ProjectConversation, primeStoredTranscript } from '@/components/ProjectConversation';
import { ProjectStarters } from '@/components/ProjectStarters';
import { ModelPopover } from '@/components/ModelPopover';
import { CardActions, CardButton, ComposerCard } from '@/components/ComposerCard';
import { LocalAgentQuestionCard } from '@/components/TurnQuestionCard';
import { Tooltip } from '@/components/Tooltip';
import { StickToBottomContext, useStickToBottom, useTailSpacer } from '@/components/useStickToBottom';
import { PromptEditor, PromptPill, PromptPillHoverContext, PromptPillRevealContext, fileReferenceId, fileReferencePath, promptReferenceToken, resolvePromptReferences, splitPromptReferenceText, type MentionProvider, type PromptEditorHandle, type PromptEditorState, type PromptPillHover, type PromptReference } from '@/components/prompt-editor';
import { filesFromTransfer, transferHasFiles } from '@/lib/composer-attachments';
import { attachmentIcon } from '@/lib/project-resources';
import { attachedText, attachmentBlocker, formatFileSize, turnAttachments, useDesktopAttachments } from '@/lib/desktop-attachments';
import { deriveProjectTurns } from '@/lib/project-versions';
import { makePlaceholder, mergeAssetLists } from '@/lib/asset-lists';
import {
  answerLocalAgentPermission,
  answerLocalAgentQuestion,
  cancelLocalAgentTurn,
  createLocalAgentTurn,
  finishRunningLocalTurn,
  loadLocalAgentTurns,
  makeLocalAgentTurnId,
  recoverLocalAgentTurns,
  registerRunningLocalTurn,
  runLocalAgentTurn,
  runningLocalTurns,
  saveLocalAgentTurn,
  useLocalAgentTurn,
  type LocalAgentTurn,
  type LocalTranscriptStore,
} from '@/lib/local-agent-run';
import type { LocalAgentTurnMeta, PromptImage } from '@/lib/desktop-bridge';
import { referencePictures } from '@/lib/ref-pictures';
import { diffFilms, type TurnFilmChanges } from '@/lib/film-changes';
import { readBalance, type TurnBalance } from '@/lib/balance';
import { BalanceNotice } from '@/components/BalanceNotice';
import { readStudioFilm } from '@/lib/studio-film';
import { studioRefsFromTransfer, transferHasStudioRefs } from '@/lib/studio-transfer';
import { agentModelSummary, currentAgent, effectivePrefs, fixedModel, offeredOption, useLocalAgents } from '@/state/local-agent-store';
import { useLiveActivityFromStore } from '@/lib/live-activity';
import { loadLastSession, loadSessions, newSession, saveLastSession, saveSessions } from '@/lib/local-sessions';
import type { ProjectSessionItem } from '@/lib/project-sessions';
import type { TranscriptItem } from '@/lib/agent-transcript';
import { app, type FfmpegState, type Project, type StudioRef, type StudioSelection, type UpdateState } from './app-bridge';
import { Divider } from './components/Divider';
import { draftRefs, pillCard, refFromPill, refPill, sameStudioThing, selectionMoment, selectionRange, selectionRefs, studioReferencesText } from './studio-refs';
import { inChat } from './lib/chat-layer';
import { useProjectChat } from './lib/chat-store';
import { ChatProjectContext, WaitingContext } from './lib/developer';

const NO_ITEMS: TranscriptItem[] = [];
const EMPTY_STORE: LocalTranscriptStore = { get: () => NO_ITEMS, subscribe: () => () => {} };

/** why Restart had to wait (the update stays ready) */
const UPDATE_WAIT: Record<string, string> = { 'agent-busy': 'banner.updateAgentBusy', exporting: 'banner.updateExporting', 'install-failed': 'banner.updateInstallFailed' };

const isActive = (turn: Turn | undefined) => turn?.status === 'generating' || turn?.status === 'failing' || turn?.status === 'canceling';

/** On a video's thumbnail: it plays, it is not a picture. */
function PlayMark() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 m-auto flex h-4 w-4 items-center justify-center rounded-full bg-black/55">
      <Play size={8} className="translate-x-[0.5px] fill-white text-white" />
    </span>
  );
}

export function App({ initialProject, initialSelection, initialUpdate, initialFfmpeg }: {
  initialProject: Project | null;
  initialSelection: StudioSelection | null;
  initialUpdate: UpdateState | null;
  initialFfmpeg: FfmpegState;
}) {
  const t = useT();
  const [project, setProject] = React.useState<Project | null>(initialProject);
  const [update, setUpdate] = React.useState<UpdateState | null>(initialUpdate);
  const [ffmpeg, setFfmpeg] = React.useState<FfmpegState>(initialFfmpeg);
  const [browser, setBrowser] = React.useState<{ state: string; message?: string } | null>(null);
  const [studioFailed, setStudioFailed] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<StudioSelection | null>(initialSelection);
  /* the project's assets open over this column (Studio draws them; the chat keeps only its composer, below them) */
  const [assetsOpen, setAssetsOpen] = React.useState<boolean>(() => app.assetsOpen?.() ?? false);
  React.useEffect(() => {
    const stops = [
      app.onAssets(setAssetsOpen),
      app.onProject(setProject),
      app.onSelection(setSelection),
      app.onUpdate(setUpdate),
      app.onFfmpeg(setFfmpeg),
      app.onStudioBrowser(setBrowser),
      app.onStudioFailed(setStudioFailed),
    ];
    return () => { for (const stop of stops) stop(); };
  }, []);

  /* the project's chat record, read from its folder before its conversation shows */
  const chatReady = useProjectChat(project);
  const ffState = typeof ffmpeg === 'object' && ffmpeg ? ffmpeg : null;
  const banners = (
    <>
      {update?.status === 'ready' ? (
        <Banner action={{ label: t('banner.restart'), onClick: () => void app.restartToUpdate() }}>{t(UPDATE_WAIT[update.error ?? ''] ?? 'banner.updateReady').replace('{version}', update.availableVersion ?? '')}</Banner>
      ) : update?.status === 'installing' ? <Banner>{t('banner.updateInstalling')}</Banner> : null}
      {studioFailed ? <Banner tone="error">{t('banner.studioFailed').replace('{error}', studioFailed)}</Banner> : null}
      {ffmpeg === false ? <Banner>{t('banner.ffmpegMissing')} <code className="font-mono">{navigator.platform.startsWith('Win') ? 'winget install ffmpeg' : 'brew install ffmpeg'}</code></Banner> : null}
      {ffState?.state === 'downloading' ? <Banner>{t('banner.ffmpegDownloading').replace('{n}', String(Math.round((ffState.progress ?? 0) * 100)))}</Banner> : null}
      {ffState?.state === 'failed' ? <Banner tone="error">{t('banner.ffmpegFailed').replace('{error}', ffState.message ?? '')}</Banner> : null}
      {browser?.state === 'downloading' ? <Banner>{t('banner.browserDownloading')}</Banner> : null}
      {browser?.state === 'failed' ? <Banner tone="error">{t('banner.browserFailed').replace('{error}', browser.message ?? '')}</Banner> : null}
    </>
  );

  return (
    <div className={`relative flex h-full flex-col ${assetsOpen ? '' : 'bg-[var(--dock-shell)]'}`}>
      {/* under Studio's top bar (it runs over this, across the window): the seam on the left is the handle */}
      <Divider />
      <div className="mb-[6px] ml-[6px] mr-[6px] flex min-h-0 flex-1 flex-col">
        {project && chatReady
          ? <ChatPane key={`${project.id}:${project.path}`} project={project} banners={banners} selection={selection && selection.projectId === project.id ? selection : null} assetsOpen={assetsOpen} />
          : <aside className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-[7px] bg-[var(--dock-pane)]">{banners}<Loader2 size={16} className="animate-spin text-[var(--text-faint)]" /></aside>}
      </div>
    </div>
  );
}

/**
 * One project's conversation column: the session bar, the conversation and the composer, and the turns run with
 * the person's agent (start a turn, put back a turn a reload interrupted, settle and keep it).
 */
function ChatPane({ project, banners, selection, assetsOpen }: { project: Project; banners: React.ReactNode; selection: StudioSelection | null; assetsOpen: boolean }) {
  const t = useT();
  const projectKey = project.path;

  /* ── sessions ── */
  const [sessions, setSessions] = React.useState<ProjectSessionItem[]>(() => loadSessions(projectKey));
  const [sessionId, setSessionId] = React.useState<string>(() => {
    const last = loadLastSession(projectKey);
    const list = loadSessions(projectKey);
    return last && list.some((s) => s.id === last) ? last : list[0]?.id ?? newSession().id;
  });
  React.useEffect(() => { saveLastSession(projectKey, sessionId); }, [projectKey, sessionId]);
  const touchSession = React.useCallback((id: string, patch: (s: ProjectSessionItem) => Partial<ProjectSessionItem>) => {
    setSessions((list) => {
      const now = new Date().toISOString();
      const found = list.find((s) => s.id === id);
      const base = found ?? { ...newSession(), id };
      const next = { ...base, ...patch(base), updatedAt: now };
      const out = [next, ...list.filter((s) => s.id !== id)];
      saveSessions(projectKey, out);
      return out;
    });
  }, [projectKey]);

  /* ── turns: the ones kept on this Mac, and the one running now ── */
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [rev, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const saved = loadLocalAgentTurns(projectKey, sessionId);
    for (const entry of saved) primeStoredTranscript(entry.turn.id, entry.items);
    const live = runningLocalTurns(projectKey).filter((r) => r.sessionId === sessionId).map((r) => r.turn);
    setTurns(mergeAssetLists([...saved.map((entry) => entry.turn), ...live], []));
  }, [projectKey, sessionId, rev]);

  /** This turn is over: the Mac keeps it, the conversation shows it as it ended. */
  function settleLocalTurn(meta: LocalAgentTurnMeta, turn: LocalAgentTurn, patch: Partial<Turn & TurnBalance>): Turn {
    const id = meta.turnId;
    finishRunningLocalTurn(id);
    const done: Turn = { ...(meta.turn as Turn), ...patch, updatedAt: new Date().toISOString() };
    primeStoredTranscript(id, turn.items);
    saveLocalAgentTurn(meta.projectId, done, turn.items);
    setTurns((list) => list.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: done.updatedAt } : item)));
    return done;
  }

  /* the clips' files, so a clip an agent names in its reply gets its icon (lib/studio-film) */
  React.useEffect(() => { void readStudioFilm(project.id); }, [project.id]);

  /* the page was reloaded while a turn ran (the window, its session and the agent stayed): put it back */
  React.useEffect(() => {
    void recoverLocalAgentTurns(projectKey).then((list) => {
      for (const r of list) {
        registerRunningLocalTurn({
          id: r.meta.turnId, projectId: projectKey, projectTitle: r.meta.projectTitle, sessionId: r.meta.sessionId,
          agent: r.meta.agent, prompt: r.meta.prompt, startedAt: r.meta.startedAt, turn: r.meta.turn as Turn,
        });
        bump();
        void r.finished.then((result) => {
          if (result.ok) settleLocalTurn(r.meta, r.turn, result.stopReason === 'cancelled' ? { status: 'cancelled', cancelReason: 'user' } : { status: 'ready' });
          else {
            const reason = result.error.replace(/^Internal error:\s*/i, '').trim() || result.error;
            const balance = readBalance(result.balance);
            r.turn.patch(balance ? { balance } : { error: reason });
            settleLocalTurn(r.meta, r.turn, { status: 'error', error: reason, ...(balance ? { balance } : {}) });
          }
        }).finally(() => { r.ack(); bump(); });
      }
    });
    // settleLocalTurn only reads stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  const ordered = React.useMemo(() => [...turns].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), [turns]);
  const asset = ordered.at(-1);
  const active = isActive(asset);
  const blank = ordered.length === 0;
  const opLog = React.useMemo(() => (blank ? [] : deriveProjectTurns(ordered, [], asset?.id ?? null)), [blank, ordered, asset?.id]);

  const localTurn = useLocalAgentTurn(asset?.id ?? null);
  const liveStore = localTurn?.turn.store ?? EMPTY_STORE;
  const activity = useLiveActivityFromStore(liveStore, localTurn?.state.thinking ?? false, false);

  /* ── the agent ── */
  const la = useLocalAgents();
  React.useEffect(() => { la.hydrate(); void la.refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const agent = currentAgent(la);

  /* what an agent's command asks before it spends: above the composer, as the agent's own questions are */
  const spendAsks = React.useSyncExternalStore((change) => app.asks.onChange(change), app.asks.get);
  const spendAsk = spendAsks[0] ?? null;

  /* ── the composer ── */
  const thread = useStickToBottom();
  const tail = useTailSpacer(thread.viewport, thread.pinIfFollowing, active);
  const composerRef = React.useRef<PromptEditorHandle>(null);
  /* the composer and what stands on it (a question, a permission): its height, with the 6 px under the pane, is all
     this view keeps while the assets are open */
  const composerBlockRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const block = composerBlockRef.current;
    if (!block) return undefined;
    const tell = () => app.setComposerHeight(Math.ceil(block.getBoundingClientRect().height) + 6);
    tell();
    const seen = new ResizeObserver(tell);
    seen.observe(block);
    return () => seen.disconnect();
  }, []);
  const [followUp, setFollowUp] = React.useState('');
  const [followUpRefs, setFollowUpRefs] = React.useState<PromptReference[]>([]);
  /** what the person pointed at in Studio for this message, by pill id */
  const [studioRefs, setStudioRefs] = React.useState<Map<string, StudioRef>>(() => new Map());
  const [queued, setQueued] = React.useState(false);
  const [followUpError, setFollowUpError] = React.useState<string | null>(null);
  const composerFiles = useDesktopAttachments();
  const attachInputRef = React.useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = React.useState(false);
  /** files of the project pointed at with @ (their pills turn back into their paths when sent) */
  const [fileRefs, setFileRefs] = React.useState<PromptReference[]>([]);
  const followUpFilled = followUp.trim().length > 0;
  const composerPills = React.useMemo(
    () => [...[...studioRefs.entries()].map(([id, ref]) => refPill(id, ref)), ...fileRefs],
    [studioRefs, fileRefs],
  );

  /* ── the @ menu: this moment in Studio, and the project's files (asked for when the menu opens) ── */
  const [mentionFiles, setMentionFiles] = React.useState<Array<{ path: string; kind: string; size: number }>>([]);
  const loadMentionFiles = React.useCallback(() => {
    void app.projectFiles().then((listing) => setMentionFiles([
      ...(listing.files ?? []).filter((f) => ['image', 'video', 'audio'].includes(f.kind)),
      ...(listing.pages ?? []).map((p) => ({ ...p, kind: 'mg' })),
    ])).catch(() => {});
  }, []);
  /** Studio's things become this message's pills (what each points at is kept by its pill's id) */
  const takeStudioRefs = React.useCallback((refs: StudioRef[]): PromptReference[] => {
    const pills = refs.map((ref) => refPill(undefined, ref));
    setStudioRefs((map) => {
      const next = new Map(map);
      refs.forEach((ref, i) => next.set(pills[i]!.id, ref));
      return next;
    });
    /* one pointed at here (⌘L, @) that shows the viewer: the pill is there at once, its picture follows once taken */
    refs.forEach((ref, i) => {
      if (!ref.image?.viewer) return;
      const id = pills[i]!.id;
      void app.withPicture(ref).then((done) => setStudioRefs((map) => (map.has(id) ? new Map(map).set(id, done) : map)));
    });
    return pills;
  }, []);
  const mentionProviders = React.useMemo<MentionProvider[]>(() => {
    const picked = selection?.refs ?? [];
    const range = selection ? selectionRange(selection) : null;
    const pickedDetail = picked.length ? `${refPill(undefined, picked[0]!).label}${picked.length > 1 ? ` +${picked.length - 1}` : ''}` : '';
    return [
      {
        id: 'moment',
        groupLabel: t('mention.groupMoment'),
        items: [{
          id: 'moment:current',
          kind: 'time',
          label: t('mention.currentTime'),
          keywords: ['current time', 'now', 'timestamp'],
          ...(selection ? { detail: refPill(undefined, { kind: 'time', time: selection.time }).label } : { disabled: true, disabledHint: t('mention.currentTimeUnavailable') }),
          select: () => (selection ? takeStudioRefs([selectionMoment(selection)]) : null),
        },
        /* the range marked on the timeline's ruler, while there is one */
        ...(range ? [{
          id: 'moment:range',
          kind: 'range' as const,
          label: t('mention.currentRange'),
          keywords: ['range', 'in out', 'marked'],
          detail: refPill(undefined, range).label,
          select: () => takeStudioRefs([range]),
        }] : []), {
          id: 'moment:selection',
          kind: 'element',
          label: t('mention.currentSelection'),
          keywords: ['selection', 'selected', 'this'],
          ...(picked.length ? { detail: pickedDetail } : { disabled: true, disabledHint: t('mention.currentSelectionNone') }),
          /* everything selected, each its own pill: the clips picked on the timeline, then the layer picked in one */
          select: () => takeStudioRefs(picked),
        }],
      },
      {
        id: 'asset',
        groupLabel: t('mention.groupAssets'),
        items: mentionFiles.map((file) => {
          const name = file.path.split('/').pop() ?? file.path;
          const pill: PromptReference = { id: fileReferenceId(file.path), kind: 'file', label: file.kind === 'mg' ? name.replace(/\.html?$/i, '') : name, detail: formatFileSize(file.size) };
          return {
            id: pill.id, kind: pill.kind, label: pill.label, detail: pill.detail, keywords: [file.path],
            select: () => { setFileRefs((list) => (list.some((p) => p.id === pill.id) ? list : [...list, pill])); return pill; },
          };
        }),
      },
    ];
  }, [selection, mentionFiles, t, takeStudioRefs]);
  const onComposerChange = React.useCallback((state: PromptEditorState) => {
    setFollowUp(state.text);
    setFollowUpRefs(state.references);
  }, []);

  /* Studio's "Reference in chat": the thing becomes a pill where the cursor is */
  React.useEffect(() => app.onRefer((ref) => {
    const [pill] = takeStudioRefs([ref]);
    requestAnimationFrame(() => { composerRef.current?.insertReference(pill!); composerRef.current?.focus(); });
  }), [takeStudioRefs]);

  /* Studio's things pasted into the composer, or dropped on its words: pills there */
  const onTransferReferences = React.useCallback((data: DataTransfer) => {
    const refs = studioRefsFromTransfer(data);
    return refs.length ? takeStudioRefs(refs) : null;
  }, [takeStudioRefs]);

  /* ⌘L in the composer points at what Studio's ⌘L would (Studio leaves the keys pressed in the chat alone) */
  const onComposerKey = (event: React.KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'l') return;
    if (!selection || !(event.target as Element).closest?.('[data-prompt-editor]')) return;
    event.preventDefault();
    event.stopPropagation();
    composerRef.current?.insertReferences(takeStudioRefs(selectionRefs(selection)));
  };

  /* a pill's hover card, in the composer and in what was sent; clicking one there takes the person to it in Studio */
  const describePill = React.useCallback((pill: { id: string; label: string; target?: Record<string, unknown> }) => pillCard(pill, t), [t]);
  const revealPill = React.useCallback((pill: { id: string; label: string; target?: Record<string, unknown> }) => {
    const ref = refFromPill(pill);
    if (ref) app.showInStudio(ref);
  }, []);
  const sentPills = React.useMemo(
    () => ({ onReveal: revealPill, revealLabel: t('library.revealReference'), describe: describePill }),
    [revealPill, describePill, t],
  );

  /*
   * Pills and Studio point at each other: a pill hovered here (in the composer, the selection coming along, what was
   * sent, the agent's replies) lights what it stands for in Studio, without going there; what the pointer is over in
   * Studio lights the pills here that point at the same thing.
   */
  const pillHover = React.useMemo(() => {
    let over: StudioRef | null = null;
    const listeners = new Set<() => void>();
    const hover: PromptPillHover = {
      hover: (pill) => {
        const path = pill && !pill.target ? fileReferencePath(pill.id) : null;
        app.highlightInStudio(pill ? refFromPill(pill) ?? (path ? { kind: 'file', path, fileKind: pill.kind } : null) : null);
      },
      lit: (pill) => {
        if (!over) return false;
        const ref = refFromPill(pill);
        return Boolean(ref && sameStudioThing(over, ref));
      },
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const set = (ref: StudioRef | null) => { over = ref; for (const listener of listeners) listener(); };
    return { hover, set };
  }, []);
  React.useEffect(() => app.onStudioHover(pillHover.set), [pillHover]);

  /* the references of the message being written, numbered in Studio as the agent will read them ([] once sent) */
  const draft = React.useMemo(
    () => draftRefs(splitPromptReferenceText(followUp).flatMap((segment) => (segment.kind === 'reference' ? [segment.id] : [])), studioRefs),
    [followUp, studioRefs],
  );
  const draftKey = draft.map((ref) => refPill(undefined, ref).id).join('|');
  React.useEffect(() => { app.draftRefsInStudio(draft); }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => { app.draftRefsInStudio([]); app.highlightInStudio(null); }, []);

  /**
   * Start one turn with the person's own agent. The turn shows at
   * once; what the agent is sent (`prepared`: the text, and the references' pictures) may take a moment to make.
   */
  function startTurn(id: string, instruction: string, prepared: Promise<{ text: string; images: PromptImage[] }>, promptDisplay: Turn['promptDisplay'] | null, attachments: Turn['attachments'] = []): void {
    const turn = createLocalAgentTurn(id, agent, ordered.length);
    const agentStore = useLocalAgents.getState();
    const prefs = effectivePrefs(agentStore.prefs, agent, agentStore.roster, agentStore.options[agent]);
    const summary = agentModelSummary(agentStore.options[agent], prefs);
    const fixed = fixedModel(agent, agentStore.roster);
    /* how hard it thinks, as the menu offers it */
    const effortOption = agentStore.options[agent]?.find((o) => o.category === 'thought_level');
    const effort = effortOption && offeredOption(agent, agentStore.roster, effortOption) ? summary.effort : null;
    const modelLabel = [fixed ?? summary.model, effort].filter(Boolean).join(' · ');
    const started: Turn = {
      ...makePlaceholder(id, 'video', instruction, { projectId: projectKey, sessionId }),
      ...(promptDisplay ? { promptDisplay } : {}),
      ...(attachments?.length ? { attachments } : {}),
      localAgent: { id: agent, model: modelLabel || null },
    };
    setTurns((list) => mergeAssetLists([started], list));
    /* the conversation is named by the words: a reference reads as its name there, not as "[1: name]" */
    const title = instruction.replace(/\[\d+: ([^\]]*)\]/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 80);
    touchSession(sessionId, (s) => ({ title: s.title || title, turns: s.turns + 1 }));
    const meta: LocalAgentTurnMeta = {
      turnId: id, projectId: projectKey, projectTitle: project.name, sessionId, agent, prompt: instruction,
      turnNo: ordered.length, startedAt: Date.now(), turn: started,
    };
    registerRunningLocalTurn({ id, projectId: projectKey, projectTitle: project.name, sessionId, agent, prompt: instruction, startedAt: meta.startedAt, turn: started });
    /* the film as the turn found it; once the turn settles, what it changed is kept with it and told under its reply.
       The turn settles first: reading the film again is not worth keeping the person waiting for */
    const filmBefore = readStudioFilm(project.id);
    const settle = (patch: Partial<Turn & TurnBalance>) => {
      const done = settleLocalTurn(meta, turn, patch);
      void filmBefore.then(async (before) => {
        const after = before ? await readStudioFilm(project.id) : null;
        const filmChanges = before && after ? diffFilms(before, after) : [];
        if (!filmChanges.length) return;
        const kept: Turn & TurnFilmChanges = { ...done, filmChanges };
        saveLocalAgentTurn(meta.projectId, kept, turn.items);
        setTurns((list) => list.map((item) => (item.id === id ? { ...item, filmChanges } : item)));
      });
    };
    void prepared.then(({ text, images }) => runLocalAgentTurn({
      projectId: projectKey,
      agent,
      cwd: project.path,
      text,
      images,
      turn,
      options: prefs,
      meta,
      onSessionInfo: (info) => useLocalAgents.getState().noteOptions(agent, info.configOptions),
    })).then(
      ({ stopReason }) => settle(stopReason === 'cancelled' ? { status: 'cancelled', cancelReason: 'user' } : { status: 'ready' }),
      (error: unknown) => {
        /* the ACP adapter wraps the agent's own message as JSON-RPC "Internal error: …": the message is the reason */
        const reason = (error instanceof Error ? error.message : String(error)).replace(/^Internal error:\s*/i, '').trim() || String(error);
        /* the service the app's own agent runs on has no balance left: said as such, with its page, not as an error */
        const balance = readBalance((error as { balance?: unknown } | null)?.balance);
        turn.patch(balance ? { balance } : { error: reason });
        settle({ status: 'error', error: reason, ...(balance ? { balance } : {}) });
      },
    );
  }

  function submitFollowUp(): void {
    if (!followUpFilled) return;
    if (active) { setQueued(true); return; }
    setQueued(false);
    /* the sentence as the agent reads it: a pill becomes "[n: name]", and what each number is follows, in a block */
    const used: StudioRef[] = [];
    const instruction = resolvePromptReferences(followUp, (pillId, index) => {
      const ref = studioRefs.get(pillId);
      if (!ref) return null;
      used[index - 1] = ref;
      return `[${index}: ${refPill(pillId, ref).label}]`;
    }).trim();
    if (!instruction) return;
    const blocker = attachmentBlocker(composerFiles.files);
    if (blocker) { setFollowUpError(blocker); return; }
    setFollowUpError(null);
    const promptDisplay = buildPromptDisplay(followUp, followUpRefs);
    thread.scrollToBottom({ smooth: true });
    composerRef.current?.clear();
    setFollowUp('');
    setFollowUpRefs([]);
    setStudioRefs(new Map());
    setFileRefs([]);
    const files = composerFiles.take();
    const id = makeLocalAgentTurnId();
    const said = instruction + attachedText(files);
    const refs = used.filter(Boolean);
    const stage = selection?.stage ?? null;
    /* each reference's picture is kept in the project for the agent (the block names it), and sent to one that takes pictures */
    const prepared = referencePictures(refs, { project: project.path, turnId: id })
      .then(({ pictures, images }) => ({ text: said + studioReferencesText(refs, { stage, pictures }), images }));
    startTurn(id, instruction, prepared, promptDisplay ?? null, turnAttachments(files));
  }

  /* queued while the turn ran: sent as soon as it ends */
  React.useEffect(() => { if (queued && !active) submitFollowUp(); }, [queued, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNewSession = () => {
    if (active) return;
    setSessionId(newSession().id);
    composerRef.current?.focus();
  };
  const onSelectSession = (id: string) => { if (!active) setSessionId(id); };
  const onRenameSession = async (title: string) => { touchSession(sessionId, () => ({ title })); };
  const shownSessions = React.useMemo(
    () => (sessions.some((s) => s.id === sessionId) ? sessions : [{ ...newSession(), id: sessionId }, ...sessions]),
    [sessions, sessionId],
  );

  const agentName = agent === 'byok' ? t('composer.agentOwnKey') : la.roster?.find((a) => a.id === agent)?.name ?? agent;

  const editComposerCard = (
    <div className="flex flex-col gap-1">
      <div
        /* a file from the disk dropped on the card is brought along (it goes into the project); Studio's things
           dropped on it become pills */
        onKeyDownCapture={onComposerKey}
        onDragOver={(event) => {
          if (!transferHasStudioRefs(event.dataTransfer) && ![...event.dataTransfer.types].includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDropping(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropping(false);
        }}
        onDrop={(event) => {
          setDropping(false);
          /* Studio's first (a file of its media pane may carry the file too): dropped on the words, the editor has
             put the pills where it was let go; on the rest of the card, they go where the cursor was */
          if (transferHasStudioRefs(event.dataTransfer)) {
            if (!event.nativeEvent.defaultPrevented) {
              composerRef.current?.insertReferences(takeStudioRefs(studioRefsFromTransfer(event.dataTransfer)), { x: event.clientX, y: event.clientY });
            }
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (!transferHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          composerFiles.add(filesFromTransfer(event.dataTransfer));
        }}
        data-prompt-shell=""
        className={`rounded-[12px] border bg-[var(--composer-bg)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-colors duration-200 ${
          dropping ? 'border-[var(--accent)]' : 'border-[var(--composer-border)] focus-within:border-[var(--composer-border-active)]'
        }`}
      >
        {composerFiles.files.length > 0 && (
          <div className="flex max-h-[76px] flex-wrap gap-1.5 overflow-y-auto px-3.5 pt-3">
            {composerFiles.files.map((file) => {
              const Icon = attachmentIcon({ name: file.name, mediaType: file.mediaType });
              const remove = (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(event) => { event.stopPropagation(); composerFiles.drop(file.id); }}
                  aria-label={t(file.kind === 'image' ? 'composer.removeImage' : 'composer.removeFile')}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                >
                  <X size={10} />
                </span>
              );
              const busy = file.state === 'importing' ? <Loader2 size={12} className="absolute inset-0 m-auto animate-spin text-white drop-shadow" /> : null;
              /* a picture shows itself; a video, a frame of itself with a play mark (once one is had) */
              const picture = file.kind === 'image' ? file.previewUrl : file.thumb;
              return picture ? (
                <div key={file.id} title={file.error ?? file.name}
                  className={`group relative h-10 w-10 overflow-hidden rounded-[8px] border bg-[var(--surface-2)] transition ${file.state === 'failed' ? 'border-[var(--danger)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
                  <img src={picture} alt={file.name} className={`h-full w-full object-cover transition ${file.state === 'ready' ? '' : 'opacity-45'}`} />
                  {file.kind !== 'image' && !busy ? <PlayMark /> : null}
                  {busy}
                  {remove}
                </div>
              ) : (
                <div key={file.id} title={file.error ?? file.name}
                  className={`group relative flex h-10 min-w-0 max-w-[150px] items-center gap-1.5 overflow-hidden rounded-[8px] border bg-[var(--surface-2)] py-1 pl-2 pr-5 transition ${file.state === 'failed' ? 'border-[var(--danger)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
                  {file.state === 'importing' ? <Loader2 size={13} className="shrink-0 animate-spin text-[var(--text-muted)]" /> : <Icon size={13} className="shrink-0 text-[var(--text-muted)]" />}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[11.5px] leading-tight text-[var(--text-muted)]">{file.name}</span>
                    <span className="truncate text-[10.5px] leading-tight text-[var(--text-faint)]">{file.state === 'failed' ? 'Not added' : formatFileSize(file.size)}</span>
                  </span>
                  {remove}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-end gap-1 py-2.5 pl-3.5 pr-2">
          <div className="min-w-0 flex-1">
            <PromptEditor
              ref={composerRef}
              defaultValue=""
              references={composerPills}
              onChange={onComposerChange}
              onSubmit={submitFollowUp}
              onReveal={revealPill}
              describe={describePill}
              onTransferReferences={onTransferReferences}
              revealLabel={t('library.revealReference')}
              removeLabel={t('library.removeReference')}
              placeholder={t(blank ? 'project.composerPlaceholderBlank' : 'project.composerPlaceholder')}
              minHeight={22}
              maxHeight={158}
              contentClassName="text-[14px] leading-[22px] text-[var(--chat-text)]"
              onPasteFiles={(files) => composerFiles.add(files)}
              mentions={{ providers: mentionProviders, label: t('mention.menu'), onOpen: loadMentionFiles }}
            />
          </div>
          <Tooltip label={active ? t('project.stop') : t('project.sendFollowUp')} shortcut={active ? 'Esc' : 'Enter'}>
            <button
              type="button"
              onClick={active ? () => { if (asset) void cancelLocalAgentTurn(asset.id); } : submitFollowUp}
              disabled={active ? false : !followUpFilled}
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-[var(--text-dim)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:text-[var(--text-faint)] disabled:hover:bg-transparent"
              aria-label={active ? t('project.stop') : t('project.sendFollowUp')}
            >
              {active ? <Square size={14} /> : <CornerDownLeft size={14} />}
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="flex items-center gap-0.5 px-0.5">
        <ModelPopover placement="top" align="start" />
        <div className="min-w-0 flex-1" />
        <input
          ref={attachInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => { composerFiles.add(Array.from(event.target.files ?? [])); event.target.value = ''; }}
        />
        <Tooltip label={t('project.addAttachment')}>
          <button type="button" onClick={() => attachInputRef.current?.click()} className="openfilm-composer-tool" aria-label={t('project.addAttachment')}>
            <Plus size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <Tooltip label={t('project.assets')}>
          <button type="button" onClick={() => app.setAssetsOpen(!assetsOpen)} aria-pressed={assetsOpen} className="openfilm-composer-tool" aria-label={t('project.assets')}>
            <LibraryBig size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>
    </div>
  );

  /* Esc stops the turn while it runs (the send button's other half) */
  React.useEffect(() => {
    if (!active || !asset) return undefined;
    /* only an Esc pressed in the chat: one in Studio closes Studio's menu or dialog, it does not stop the agent */
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && inChat(event.target)) void cancelLocalAgentTurn(asset.id); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, asset]);

  return (
    <ChatProjectContext.Provider value={projectKey}>
      <PromptPillHoverContext.Provider value={pillHover.hover}>
        <WaitingContext.Provider value={Boolean(localTurn?.state.question || localTurn?.state.permission || spendAsk)}>
          <StickToBottomContext.Provider value={thread}>
            {/* with the assets open only the composer shows, at the bottom: the drawer above it is Studio's, and the two
                read as one pane */}
            <aside className={`relative flex min-h-0 flex-col overflow-hidden bg-[var(--dock-pane)] ${assetsOpen ? 'mt-auto shrink-0 rounded-b-[7px]' : 'flex-1 rounded-[7px]'}`}>
              {assetsOpen ? null : banners}
              <div className={`relative min-h-0 min-w-0 flex-1 flex-col ${assetsOpen ? 'hidden' : 'flex'}`}>
                <ConversationSessionBar
                  sessions={shownSessions}
                  currentSessionId={sessionId}
                  onNewSession={onNewSession}
                  onSelectSession={onSelectSession}
                  onRenameSession={onRenameSession}
                  busy={active}
                />
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                  <div
                    ref={thread.viewportRef}
                    className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [overflow-anchor:none] [scrollbar-gutter:stable] px-4 pt-3.5${blank ? ' justify-center pb-3.5' : ' pb-10'}`}
                  >
                    {blank ? (
                      <div ref={thread.contentRef}>
                        <ProjectStarters
                          onPick={(text) => { composerRef.current?.setText(text); composerRef.current?.focus(); }}
                          onAttach={() => attachInputRef.current?.click()}
                        />
                      </div>
                    ) : (
                      <div ref={thread.contentRef} className="min-w-0 shrink-0">
                        <PromptPillRevealContext.Provider value={sentPills}>
                          <LiveConversation
                            store={liveStore}
                            turns={opLog}
                            liveAssetId={active ? asset!.id : null}
                            liveActive={active}
                            liveActivity={activity}
                            lastTurnRef={tail.lastTurnRef}
                          />
                        </PromptPillRevealContext.Provider>
                      </div>
                    )}
                  </div>
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--dock-pane)] to-transparent" />
                  {!blank && !thread.atBottom && (
                    <button
                      type="button"
                      onClick={() => thread.scrollToBottom({ smooth: true })}
                      className="absolute bottom-1.5 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[11.5px] font-medium text-[var(--text-dim)] shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition hover:text-[var(--text)]"
                    >
                      <ArrowDown size={12} />
                      {t('project.jumpToLatest')}
                    </button>
                  )}
                </div>
              </div>

              <div ref={composerBlockRef} className={`relative flex shrink-0 flex-col px-4 pb-1.5 ${assetsOpen ? 'pt-2' : ''}`}>
                <div className="flex flex-col gap-2">
                  {spendAsk ? (
                    <ComposerCard role="alertdialog" icon={<Coins size={14} />} title={spendAsk.title}
                      body={spendAsk.body ? <span className="break-words">{spendAsk.body}</span> : undefined}>
                      <CardActions>
                        <CardButton weight="quiet" onClick={() => app.asks.answer(spendAsk.id, false)}>{spendAsk.denyLabel}</CardButton>
                        <CardButton weight="primary" onClick={() => app.asks.answer(spendAsk.id, true)}>{spendAsk.allowLabel}</CardButton>
                      </CardActions>
                    </ComposerCard>
                  ) : null}
                  {localTurn?.state.question ? (
                    <LocalAgentQuestionCard
                      key={localTurn.state.question.requestId}
                      questions={localTurn.state.question.questions}
                      onDone={(answers) => { if (asset) void answerLocalAgentQuestion(asset.id, answers); }}
                    />
                  ) : null}
                  {localTurn?.state.permission ? (
                    <ComposerCard
                      role="alertdialog"
                      icon={<ShieldQuestion size={14} />}
                      title={t('composer.agentPermissionTitle').replace('{name}', agentName)}
                      body={localTurn.state.permission.title ? (
                        <span className="break-words font-mono text-[11.5px]">{localTurn.state.permission.title}</span>
                      ) : undefined}
                    >
                      <CardActions className="flex-wrap">
                        <CardButton weight="quiet" onClick={() => { if (asset) void answerLocalAgentPermission(asset.id, null); }}>
                          {t('composer.agentPermissionDeny')}
                        </CardButton>
                        {localTurn.state.permission.options.map((option, index) => (
                          <CardButton
                            key={option.optionId}
                            weight={index === 0 && option.kind.startsWith('allow') ? 'primary' : 'secondary'}
                            onClick={() => { if (asset) void answerLocalAgentPermission(asset.id, option.optionId); }}
                          >
                            {option.name}
                          </CardButton>
                        ))}
                      </CardActions>
                    </ComposerCard>
                  ) : null}
                  {localTurn?.state.error ? <p role="alert" className="text-xs text-[var(--err)]">{localTurn.state.error}</p> : null}
                  {localTurn?.state.balance ? <BalanceNotice balance={localTurn.state.balance} /> : null}
                  {followUpError && <p className="text-xs text-[var(--err)]">{followUpError}</p>}
                  {composerFiles.notice && <p className="text-xs text-[var(--warn)]">{composerFiles.notice}</p>}
                  {queued && active ? (
                    <p role="status" className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      <span className="min-w-0 flex-1">{t('composer.queued')}</span>
                      <button type="button" onClick={() => setQueued(false)} className="shrink-0 underline underline-offset-2 hover:text-[var(--text)]">{t('composer.queuedCancel')}</button>
                    </p>
                  ) : null}
                  {editComposerCard}
                </div>
              </div>
            </aside>
          </StickToBottomContext.Provider>
        </WaitingContext.Provider>
      </PromptPillHoverContext.Provider>
    </ChatProjectContext.Provider>
  );
}

/** The conversation subscribes to the transcript on its own, so streamed tokens re-render only it, not the whole page. */
function LiveConversation({ store, ...rest }: { store: LocalTranscriptStore } & Omit<React.ComponentProps<typeof ProjectConversation>, 'liveTranscript'>) {
  const transcript = React.useSyncExternalStore(store.subscribe, store.get, store.get);
  return <ProjectConversation {...rest} liveTranscript={transcript} />;
}

function Banner({ tone = 'plain', action, children }: { tone?: 'plain' | 'error'; action?: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <div className={`flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[12px] leading-snug ${tone === 'error' ? 'border-[color-mix(in_srgb,var(--err)_25%,transparent)] text-[var(--err)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
      <span className="min-w-0 flex-1">{children}</span>
      {action ? <CardButton weight="secondary" className="h-6 px-2" onClick={action.onClick}>{action.label}</CardButton> : null}
    </div>
  );
}
