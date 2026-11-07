/**
 * The chat beside Studio: a conversation with an agent (the app's own, or the person's own Claude Code or Codex) about
 * the project Studio shows; switching projects there switches the conversations here.
 *
 * Kept on this Mac: the sessions per project folder (lib/local-sessions), each turn and what the agent did in it
 * (lib/local-agent-run's saved turns).
 */
import React from 'react';
import { ArrowDown, Coins, CornerDownLeft, LibraryBig, Loader2, Plus, Square } from 'lucide-react';
import { buildPromptDisplay, type Turn } from '@openfilm/shared';
import { useT, useUiLocale } from '@/i18n';
import { ConversationBar } from '@/components/ConversationSessionBar';
import { ProjectConversation, TurnUndoContext, primeStoredTranscript } from '@/components/ProjectConversation';
import type { ProjectVersion } from '@/components/project-version';
import { ProjectStarters } from '@/components/ProjectStarters';
import { AttachmentPreview, type AttachmentPreviewItem } from '@/components/AttachmentPreview';
import { ModelPopover } from '@/components/ModelPopover';
import { AddSkillDialog, type PickedSkill } from '@/components/AddSkill';
import { SKILLS_CHANGED } from 'openfilm/studio-ui/lib/project-sources.ts';
import { CardActions, CardButton, ComposerCard } from '@/components/ComposerCard';
import { AgentPermissionCard } from '@/components/AgentPermissionCard';
import { LocalAgentQuestionCard } from '@/components/TurnQuestionCard';
import { Tooltip } from '@/components/Tooltip';
import { StickToBottomContext, useStickToBottom, useTailSpacer } from '@/components/useStickToBottom';
import { PromptEditor, PromptPill, PromptPillHoverContext, PromptPillRevealContext, activatedSkillIds, fileReferenceId, fileReferencePath, promptReferenceToken, resolvePromptReferences, skillReferenceId, skillReferencePackage, splitPromptReferenceText, type MentionProvider, type PromptEditorHandle, type PromptEditorState, type PromptPillHover, type PromptReference } from '@/components/prompt-editor';
import { filesFromTransfer, transferHasFiles } from '@/lib/composer-attachments';
import { PROMPT_PICTURES_MAX, attachedPictures, attachmentBlocker, formatFileSize, turnAttachments, useDesktopAttachments } from '@/lib/desktop-attachments';
import { attachmentPill, attachmentsInText, attachmentWords, isAttachmentPill, projectFilePath, sentPill } from '@/lib/attachment-pills';
import { deriveProjectTurns } from '@/lib/project-versions';
import { makePlaceholder, mergeAssetLists } from '@/lib/asset-lists';
import { isEmptyBackgroundTurn } from '@/lib/unprompted';
import {
  answerLocalAgentPermission,
  answerLocalAgentQuestion,
  cancelLocalAgentTurn,
  canSteer,
  createLocalAgentTurn,
  finishRunningLocalTurn,
  loadLocalAgentTurns,
  localAgentTurn,
  makeLocalAgentTurnId,
  onUnpromptedTurn,
  recoverLocalAgentTurns,
  registerRunningLocalTurn,
  runLocalAgentTurn,
  runningLocalTurns,
  recoverLoggedTurns,
  restingItems,
  saveLocalAgentTurn,
  steerLocalAgentTurn,
  undoLocalAgentTurn,
  useAgentContext,
  useLocalAgentTurn,
  useRunningLocalTurns,
  type LocalAgentTurn,
  type LocalTranscriptStore,
} from '@/lib/local-agent-run';
import { desktopBridge, type LocalAgentId, type LocalAgentTurnMeta, type PromptImage } from '@/lib/desktop-bridge';
import { referencePictures } from '@/lib/ref-pictures';
import type { TurnFileChanges } from '@/lib/file-changes';
import { readBalance, type TurnBalance } from '@/lib/balance';
import { BalanceNotice } from '@/components/BalanceNotice';
import { CopyDiagnostics } from '@/components/CopyDiagnostics';
import { Notice, type NoticeTone } from '@/components/NoticeCard';
import { accountName, accountTrouble } from '@/lib/account-trouble';
import { accountModel, accountModelOf, routeWithoutKey } from '@/lib/route-without-key';
import { keptNote, ProjectFolderContext, readStudioProject } from '@/lib/studio-film';
import { studioRefsFromTransfer, transferHasStudioRefs } from '@/lib/studio-transfer';
import { agentModelSummary, agentOptions, currentAgent, effectivePrefs, offeredOption, useLocalAgents } from '@/state/local-agent-store';
import { useLiveActivityFromStore } from '@/lib/live-activity';
import { loadLastSession, loadSessions, newSession, saveLastSession, saveSessions } from '@/lib/local-sessions';
import type { ProjectSessionItem } from '@/lib/project-sessions';
import { conversationAgent, conversationPrefs, keptPrefs } from '@/lib/conversation-agent';
import { AGENT_DEFINITIONS, isAgentId } from '../../src/agent-definitions.mjs';
import type { TranscriptItem } from '@/lib/agent-transcript';
import { app, type FfmpegState, type Project, type SkillListing, type StudioRef, type StudioSelection } from './app-bridge';
import { Divider } from './components/Divider';
import { draftRefs, pillCard, refFromPill, refPill, sameStudioThing, selectionMoment, selectionRange, selectionRefs, studioReferencesText } from './studio-refs';
import { inChat } from './lib/chat-layer';
import { escStopper } from './lib/esc-stop';
import { useProjectChat } from './lib/chat-store';
import { givenAfter, pagesToSend } from './lib/skill-pages';
import { ChatProjectContext, WaitingContext } from './lib/developer';

const NO_ITEMS: TranscriptItem[] = [];
const EMPTY_STORE: LocalTranscriptStore = { get: () => NO_ITEMS, subscribe: () => () => {} };

const isActive = (turn: Turn | undefined) => turn?.status === 'generating' || turn?.status === 'failing' || turn?.status === 'canceling';

/** how often a running turn is kept, at most (it changes with every word) */
const KEEP_RUNNING_MS = 1500;

/** how full the agent's context gets before the chat says a new conversation would work better */
const CONTEXT_NOTICE_SHARE = 0.85;

/** On a video's thumbnail: it plays, it is not a picture. */
/* between the chat's root (the add-skill dialog) and the project's chat: a skill added, a skill to make */
const MAKE_SKILL = 'openfilm:make-skill';

export function App({ initialProject, initialSelection, initialFfmpeg }: {
  initialProject: Project | null;
  initialSelection: StudioSelection | null;
  initialFfmpeg: FfmpegState;
}) {
  const t = useT();
  const [project, setProject] = React.useState<Project | null>(initialProject);
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
      app.onFfmpeg(setFfmpeg),
      app.onStudioBrowser(setBrowser),
      app.onStudioFailed(setStudioFailed),
    ];
    return () => { for (const stop of stops) stop(); };
  }, []);

  /* "Add a skill" in the examples (on a project or a new tab's launcher): its dialog, here at the root so it opens on
     either; naming the one added and making one with the agent only where a project's chat is */
  const [addingSkill, setAddingSkill] = React.useState(false);
  React.useEffect(() => app.onAddSkill?.(() => setAddingSkill(true)), []);

  /* the project's chat record, read from its folder before its conversation shows */
  const chatReady = useProjectChat(project);
  const ffState = typeof ffmpeg === 'object' && ffmpeg ? ffmpeg : null;
  /* what Studio and its tools tell, as notices on the composer: each closed stays closed for what it said */
  const [closed, setClosed] = React.useState<ReadonlySet<string>>(() => new Set());
  const notice = (key: string, tone: NoticeTone, text: React.ReactNode, closable = true) => (closed.has(key) ? null : (
    <Notice key={key} tone={tone} {...(closable ? { onClose: () => setClosed((set) => new Set(set).add(key)) } : {})}>{text}</Notice>
  ));
  const banners = (
    <>
      {studioFailed ? notice(`studio:${studioFailed}`, 'error', t('banner.studioFailed').replace('{error}', studioFailed)) : null}
      {ffmpeg === false ? notice('ffmpeg:missing', 'warn', <>{t('banner.ffmpegMissing')} <code className="font-mono">{navigator.platform.startsWith('Win') ? 'winget install ffmpeg' : 'brew install ffmpeg'}</code></>) : null}
      {ffState?.state === 'downloading' ? notice('ffmpeg:downloading', 'info', t('banner.ffmpegDownloading').replace('{n}', String(Math.round((ffState.progress ?? 0) * 100)))) : null}
      {ffState?.state === 'failed' ? notice(`ffmpeg:${ffState.message ?? ''}`, 'error', t('banner.ffmpegFailed').replace('{error}', ffState.message ?? '')) : null}
      {browser?.state === 'downloading' ? notice('browser:downloading', 'info', t('banner.browserDownloading')) : null}
      {browser?.state === 'failed' ? notice(`browser:${browser.message ?? ''}`, 'error', t('banner.browserFailed').replace('{error}', browser.message ?? '')) : null}
    </>
  );

  const onProject = Boolean(project) && /^\/projects\//.test(location.pathname);
  return (
    <div className={`relative flex h-full flex-col ${assetsOpen ? '' : 'bg-[var(--bg-app)] pt-px'}`}>
      {addingSkill ? (
        <AddSkillDialog onClose={() => setAddingSkill(false)} onAdded={async () => { window.dispatchEvent(new Event(SKILLS_CHANGED)); }}
          onPick={onProject ? (skill) => app.useSkill?.(skill) : undefined}
          onMake={onProject ? () => window.dispatchEvent(new Event(MAKE_SKILL)) : undefined} />
      ) : null}
      {/* under Studio's top bar (it runs over this, across the window), a line below it: the seam on the right, the
          line between this and Studio's panes, is the handle */}
      <Divider />
      <div className="flex min-h-0 flex-1 flex-col">
        {project && chatReady
          ? <ChatPane key={`${project.id}:${project.path}`} project={project} banners={banners} selection={selection && selection.projectId === project.id ? selection : null} assetsOpen={assetsOpen} />
          : (
            <aside className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-panel)]">
              <div className="flex flex-1 items-center justify-center"><Loader2 size={16} className="animate-spin text-[var(--text-faint)]" /></div>
              <div className="flex shrink-0 flex-col gap-2 px-4 pb-3 empty:hidden">{banners}</div>
            </aside>
          )}
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
  /* renamed, pinned or archived: changed where it is, its day kept (touchSession's is for being talked in) */
  const editSession = React.useCallback((id: string, patch: Partial<ProjectSessionItem>) => {
    setSessions((list) => {
      const out = list.some((s) => s.id === id)
        ? list.map((s) => (s.id === id ? { ...s, ...patch } : s))
        : [{ ...newSession(), id, ...patch }, ...list];
      saveSessions(projectKey, out);
      return out;
    });
  }, [projectKey]);

  /* ── turns: the ones kept on this Mac, and the one running now ── */
  const readTurns = (id: string): Turn[] => {
    const saved = loadLocalAgentTurns(projectKey, id);
    for (const entry of saved) primeStoredTranscript(entry.turn.id, entry.items);
    const live = runningLocalTurns(projectKey).filter((r) => r.sessionId === id).map((r) => r.turn);
    return mergeAssetLists([...saved.map((entry) => entry.turn), ...live], []);
  };
  const [turns, setTurns] = React.useState<Turn[]>(() => readTurns(sessionId));
  const [rev, bump] = React.useReducer((n: number) => n + 1, 0);
  /* read again in the render that shows another conversation (or is asked to), not after it: the one shown is never
     drawn empty for a frame (the skills of a new one flashing in between) */
  const [readFor, setReadFor] = React.useState({ session: sessionId, rev });
  if (readFor.session !== sessionId || readFor.rev !== rev) {
    setReadFor({ session: sessionId, rev });
    setTurns(readTurns(sessionId));
  }

  /** This turn is over: the Mac keeps it, the conversation shows it as it ended. */
  function settleLocalTurn(meta: LocalAgentTurnMeta, turn: LocalAgentTurn, patch: Partial<Turn & TurnBalance>): Turn {
    const id = meta.turnId;
    finishRunningLocalTurn(id);
    /* the model that answered, for an agent whose session names none (GitHub Copilot's): its footer says it */
    if (turn.model) patch = { ...patch, localAgent: { id: meta.agent, model: turn.model } };
    const done: Turn = { ...(meta.turn as Turn), ...patch, updatedAt: new Date().toISOString() };
    primeStoredTranscript(id, turn.items);
    saveLocalAgentTurn(meta.projectId, done, turn.items);
    /* a turn the agent started by itself that ended with nothing in it leaves no line behind */
    setTurns((list) => (isEmptyBackgroundTurn(done, turn.items)
      ? list.filter((item) => item.id !== id)
      : list.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: done.updatedAt } : item))));
    return done;
  }

  /* The clips' files and the project's serving URL for audio links in replies (lib/studio-film). */
  const [projectFolder, setProjectFolder] = React.useState<string | null>(null);
  React.useEffect(() => {
    let current = true;
    setProjectFolder(null);
    void readStudioProject(project.id).then((folder) => { if (current) setProjectFolder(folder); });
    return () => { current = false; };
  }, [project.id]);

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
      /* then the turns only the logs have (the app closed on them before they were kept): made again, and shown */
      return recoverLoggedTurns(projectKey).then((made) => { if (made) bump(); });
    });
    // settleLocalTurn only reads stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  /* the shown conversation's only: for the moment after another tab is shown, `turns` are still the last one's */
  const ordered = React.useMemo(
    () => turns.filter((turn) => turn.sessionId === sessionId).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [turns, sessionId],
  );
  const asset = ordered.at(-1);
  const active = isActive(asset);
  const blank = ordered.length === 0;
  const opLog = React.useMemo(() => (blank ? [] : deriveProjectTurns(ordered, [], asset?.id ?? null)), [blank, ordered, asset?.id]);

  const localTurn = useLocalAgentTurn(asset?.id ?? null);
  /* why the last turn failed: as it happened, or, the chat opened again on it (the app restarted), as it was kept */
  const turnError = localTurn ? localTurn.state.error : asset?.status === 'error' && !(asset as Turn & TurnBalance).balance ? asset.error ?? null : null;
  const liveStore = localTurn?.turn.store ?? EMPTY_STORE;
  const activity = useLiveActivityFromStore(liveStore, localTurn?.state.thinking ?? false, false);

  /* ── the agent ── */
  const la = useLocalAgents();
  React.useEffect(() => { la.hydrate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* the agent this conversation used and its options, whatever was picked since in another one; a new conversation
     takes the one picked last (lib/conversation-agent). A conversation from before they kept it: its last turn's agent */
  const shownSessionItem = sessions.find((s) => s.id === sessionId);
  const lastTurnAgent = asset?.sessionId === sessionId ? asset.localAgent?.id : undefined;
  const usedAgent = [shownSessionItem?.agent, lastTurnAgent].find((id): id is LocalAgentId => Boolean(id) && isAgentId(id));
  const { agent, was: agentWas } = conversationAgent(usedAgent, la.roster, currentAgent(la));
  const agentPrefs = conversationPrefs(la.prefs, shownSessionItem?.agentPrefs);
  /** the agent or an option changed in the menu: kept on this conversation, once it has said something (a new one
      takes the pick); not a use of it, so it keeps its place in the list */
  const keepOnSession = React.useCallback((patch: (s: ProjectSessionItem) => Partial<ProjectSessionItem>) => {
    setSessions((list) => {
      if (!list.some((s) => s.id === sessionId && s.turns > 0)) return list;
      const out = list.map((s) => (s.id === sessionId ? { ...s, ...patch(s) } : s));
      saveSessions(projectKey, out);
      return out;
    });
  }, [projectKey, sessionId]);

  /* what an agent's command asks before it spends: above the composer, as the agent's own questions are */
  const spendAsks = React.useSyncExternalStore((change) => app.asks.onChange(change), app.asks.get);
  const spendAsk = spendAsks[0] ?? null;

  /* ── the composer ── */
  const thread = useStickToBottom();
  /* scrolled away from the conversation's start: what passes under the session bar fades into it */
  const [scrolled, setScrolled] = React.useState(false);
  const tail = useTailSpacer(thread.viewport, thread.pinIfFollowing, active);
  const composerRef = React.useRef<PromptEditorHandle>(null);
  /* the composer and what stands on it (a question, a permission): its height is all this view keeps while the assets
     are open, the drawer above meeting it */
  const composerBlockRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const block = composerBlockRef.current;
    if (!block) return undefined;
    const tell = () => app.setComposerHeight(Math.ceil(block.getBoundingClientRect().height));
    tell();
    const seen = new ResizeObserver(tell);
    seen.observe(block);
    return () => seen.disconnect();
  }, []);
  const [followUp, setFollowUp] = React.useState('');
  const [followUpRefs, setFollowUpRefs] = React.useState<PromptReference[]>([]);
  /** what the person pointed at in Studio for this message, by pill id */
  const [studioRefs, setStudioRefs] = React.useState<Map<string, StudioRef>>(() => new Map());
  /** the conversation whose message waits for its turn to end (an agent that cannot take one mid-turn) */
  const [queued, setQueued] = React.useState<string | null>(null);
  const [followUpError, setFollowUpError] = React.useState<string | null>(null);
  /* the notices on the composer closed here (NoticeCard): each stays closed for what it said */
  const [closed, setClosed] = React.useState<ReadonlySet<string>>(() => new Set());
  const close = (key: string) => setClosed((set) => new Set(set).add(key));
  const composerFiles = useDesktopAttachments(project.path);
  /* a file of the message being written, opened to look at */
  const [openedFile, setOpenedFile] = React.useState<AttachmentPreviewItem | null>(null);
  const attachInputRef = React.useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = React.useState(false);
  /** files of the project pointed at with @ (their pills turn back into their paths when sent) */
  const [fileRefs, setFileRefs] = React.useState<PromptReference[]>([]);
  const followUpFilled = followUp.trim().length > 0;
  /* the composer's button stops the turn while it runs, until something is written to send */
  const stopping = active && !followUpFilled;
  /** skills named with the Skills button or `/` (each pill turns into the skill's name, its SKILL.md after the message) */
  const [skillRefs, setSkillRefs] = React.useState<PromptReference[]>([]);
  const composerPills = React.useMemo(
    () => [...[...studioRefs.entries()].map(([id, ref]) => refPill(id, ref)), ...fileRefs, ...skillRefs, ...composerFiles.files.map(attachmentPill)],
    [studioRefs, fileRefs, skillRefs, composerFiles.files],
  );
  /** files brought in (dropped, pasted, picked with +): pills where they were let go, or at the caret */
  const attachFiles = (files: File[], point?: { x: number; y: number }) => {
    const added = composerFiles.add(files);
    if (added.length) composerRef.current?.insertReferences(added.map(attachmentPill), point);
  };
  const attachmentOf = React.useCallback(
    (pill: { id: string }) => (isAttachmentPill(pill.id) ? composerFiles.files.find((f) => f.id === pill.id) : undefined),
    [composerFiles.files],
  );
  const attachmentState = React.useCallback((pill: PromptReference) => {
    const state = attachmentOf(pill)?.state;
    return state === 'pending' || state === 'failed' ? state : null;
  }, [attachmentOf]);
  const opensPill = React.useCallback((pill: PromptReference) => isAttachmentPill(pill.id), []);
  /** what the card takes from a drag: files from the disk, Studio's things */
  const showsDropCaret = React.useCallback(
    (data: DataTransfer) => transferHasStudioRefs(data) || [...data.types].includes('Files'),
    [],
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
  /* how full the agent's context is in this conversation: said only once it is nearly full */
  const agentContext = useAgentContext(projectKey, sessionId, agent);
  const [contextNoticeOff, setContextNoticeOff] = React.useState<string | null>(null);
  const contextFull = Boolean(agentContext && agentContext.size > 0 && agentContext.used / agentContext.size >= CONTEXT_NOTICE_SHARE) && contextNoticeOff !== sessionId;

  /* the skills this message can name (the Skills button, and `@`) */
  const [skillListing, setSkillListing] = React.useState<SkillListing | null>(null);
  const reloadSkills = React.useCallback(async () => {
    const next = await app.skills?.list(project.path, agent).catch(() => null);
    if (next) setSkillListing(next);
  }, [project.path, agent]);
  React.useEffect(() => { void reloadSkills(); }, [reloadSkills]);
  /* a skill as people see it, in the language shown: its title, and what its page says (none: its name and the
     agent's description) */
  const locale = useUiLocale();
  /* the skills named from a card or Try now, not installed so not in the listing: their words as they came */
  const pickedSkills = React.useRef(new Map<string, PickedSkill>());
  const skillWords = React.useCallback((name: string, description = '') => {
    const shown = skillListing?.openfilm.find((s) => s.name === name)?.shown;
    const picked = pickedSkills.current.get(name);
    const about = description || picked?.description || '';
    const pick = (words?: Record<string, string>) => (words ? words[locale] ?? words[locale.split('-')[0]!] ?? words.en ?? Object.values(words)[0] : undefined);
    const summary = pick(shown?.summary);
    return {
      title: pick(shown?.title) ?? picked?.title ?? name,
      summary: summary ?? about,
      text: shown ? [summary, ...(pick(shown.details)?.split('\n') ?? [])].filter((w): w is string => Boolean(w)) : about ? [about] : [],
    };
  }, [skillListing, locale]);
  const skillPill = React.useCallback((skill: PickedSkill): PromptReference => {
    pickedSkills.current.set(skill.name, skill);
    /* its title alone: what it does is in its hover card */
    const pill: PromptReference = { id: skillReferenceId(skill.name), kind: 'skill', label: skill.title ?? skillWords(skill.name, skill.description).title };
    setSkillRefs((list) => (list.some((p) => p.id === pill.id) ? list : [...list, pill]));
    return pill;
  }, [skillWords]);
  const pickSkill = React.useCallback((skill: PickedSkill) => {
    const pill = skillPill(skill);
    requestAnimationFrame(() => { composerRef.current?.insertReference(pill); composerRef.current?.focus(); });
  }, [skillPill]);
  /* the skills a message can name: OpenFilm's, and of the agent's own those it has (let in, or all when it cannot be told) */
  const nameableSkills = React.useMemo(() => [
    ...(skillListing?.openfilm ?? []),
    ...(skillListing?.own.skills ?? []).filter((s) => !skillListing?.own.filtered || s.allowed),
  ], [skillListing]);
  /* a skill picked in Studio's skills: named in the message; Try now there: in a new conversation */
  const newConversation = React.useRef<() => void>(() => {});
  React.useEffect(() => app.onUseSkill?.((skill) => {
    if (skill.newConversation) newConversation.current();
    pickSkill(skill);
  }), [pickSkill]);
  /* a skill added from the examples (AddSkillDialog, at the chat's root), or turned on or off in them: the list read
     again, and the agents' sessions take it up; "make one with the agent" there: its message put in the composer */
  React.useEffect(() => {
    const changed = () => { void reloadSkills(); void app.skills?.changed?.().catch(() => {}); };
    const make = () => { composerRef.current?.setText(t('skills.makePrompt').replace('{folder}', skillListing?.mine ?? '')); composerRef.current?.focus(); };
    window.addEventListener(SKILLS_CHANGED, changed);
    window.addEventListener(MAKE_SKILL, make);
    return () => { window.removeEventListener(SKILLS_CHANGED, changed); window.removeEventListener(MAKE_SKILL, make); };
  }, [reloadSkills, skillListing, t]);
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
      /* the skills, each the pill the Skills button makes: after the files, which people reach for most and which stop
         at 20. Every one, uncut: an agent's own can be a hundred or more, and a person may not remember the name to type */
      {
        id: 'skills',
        groupLabel: t('skills.button'),
        limit: Infinity,
        items: nameableSkills.map((skill) => {
          const words = skillWords(skill.name, skill.description);
          return {
            id: skillReferenceId(skill.name),
            kind: 'skill' as const,
            label: words.title,
            /* what it does, cut to the row */
            ...(words.summary ? { detail: words.summary, describes: true } : {}),
            keywords: [skill.name],
            select: () => skillPill(skill),
          };
        }),
      },
    ];
  }, [selection, mentionFiles, nameableSkills, skillWords, skillPill, t, takeStudioRefs]);
  const onComposerChange = React.useCallback((state: PromptEditorState) => {
    setFollowUp(state.text);
    setFollowUpRefs(state.references);
  }, []);

  /* Studio's "Reference in chat": the thing becomes a pill where the cursor is */
  React.useEffect(() => app.onRefer((ref) => {
    const [pill] = takeStudioRefs([ref]);
    requestAnimationFrame(() => { composerRef.current?.insertReference(pill!); composerRef.current?.focus(); });
  }), [takeStudioRefs]);

  /* a question Studio wrote for the person (an example's "Explain how it's made"): in the composer, for them to send */
  React.useEffect(() => app.onAsk?.((request) => {
    const pills = takeStudioRefs(request.refs);
    requestAnimationFrame(() => {
      composerRef.current?.setText(request.text);
      composerRef.current?.insertReferences(pills);
      composerRef.current?.focus();
    });
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
  const describePill = React.useCallback((pill: { id: string; label: string; target?: Record<string, unknown> }) => {
    const name = skillReferencePackage(pill.id);
    if (name) {
      const skill = nameableSkills.find((s) => s.name === name);
      const words = skillWords(name, skill?.description);
      return { title: words.title, rows: [], text: words.text };
    }
    /* a file brought in: where it is, or why it could not be had */
    const file = attachmentOf(pill);
    if (file) {
      return {
        title: file.folder ? `${file.name}/` : file.name,
        rows: file.path ? [[t('refCard.path'), file.path] as [string, string]] : [],
        ...(file.state === 'failed' && file.error ? { text: [file.error] } : {}),
      };
    }
    return pillCard(pill, t);
  }, [t, nameableSkills, skillWords, attachmentOf]);
  const revealPill = React.useCallback((pill: { id: string; label: string; target?: Record<string, unknown> }) => {
    /* a skill: its page in the library; anything else: where it is in Studio */
    const name = skillReferencePackage(pill.id);
    if (name) { app.showExamples?.({ kind: 'skill', name }); return; }
    /* a file brought in opens to look at: a picture large, a video played, a text read; a folder, shown where it is */
    const file = attachmentOf(pill);
    if (file) {
      if (file.folder) { if (file.path && file.state === 'ready') void desktopBridge()?.revealPath(file.path); }
      else if (file.previewUrl) setOpenedFile({ name: file.name, kind: file.kind, url: file.previewUrl, ...(file.mediaType ? { mediaType: file.mediaType } : {}) });
      return;
    }
    const ref = refFromPill(pill);
    if (ref) app.showInStudio(ref);
  }, [attachmentOf]);
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
        /* a file of the project lights up in Studio's media; one elsewhere on the disk is in no pane there */
        const path = pill && !pill.target ? projectFilePath(fileReferencePath(pill.id)) : null;
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

  /** each open turn's way to settle (by turn id), and the agent's run each running turn belongs to */
  const settlers = React.useRef(new Map<string, (patch: Partial<Turn & TurnBalance>) => void>());
  const runs = React.useRef(new Map<string, { conversation: string; run: Promise<unknown> }>());
  /** the conversation shown now (a turn opened in another is kept, not shown) */
  const shownSession = React.useRef(sessionId);
  shownSession.current = sessionId;

  /* the agent working with nobody having written, in a conversation of this project: a background task of its own came
     back, and it takes it up, as in its own chat. A turn of its own, under a line saying so */
  const openTurnNow = React.useRef(openTurn);
  openTurnNow.current = openTurn;
  React.useEffect(() => onUnpromptedTurn(({ projectId, conversation, agent: by }) => {
    if (projectId !== projectKey) return null;
    const id = makeLocalAgentTurnId();
    const opened = openTurnNow.current(id, '', null, [], { conversation, by, origin: 'background' });
    return {
      turn: opened.turn,
      meta: opened.meta,
      done: (outcome) => settlers.current.get(id)?.(outcome === 'cancelled' ? { status: 'cancelled', cancelReason: 'user' } : { status: 'ready' }),
    };
  }), [projectKey]);

  /**
   * One turn of the conversation: shown at once, kept, and settled by `settlers` when the agent is done with it. The
   * project's files are read as it opens (`ready`), so what it changed in them is shown under its reply.
   */
  function openTurn(
    id: string, instruction: string, promptDisplay: Turn['promptDisplay'] | null, attachments: Turn['attachments'] = [],
    /* a turn the agent started by itself (a background task of its own came back): in its own conversation, maybe not
       the one shown, by the agent of that session */
    { conversation = sessionId, by = agent, origin }: { conversation?: string; by?: LocalAgentId; origin?: 'background' } = {},
  ): { turn: LocalAgentTurn; meta: LocalAgentTurnMeta; prefs: Record<string, unknown>; ready: Promise<boolean> } {
    const agent = by;
    const sessionId = conversation;
    const shown = conversation === shownSession.current;
    const turn = createLocalAgentTurn(id, agent, ordered.length);
    const agentStore = useLocalAgents.getState();
    const own = sessions.find((s) => s.id === sessionId)?.agentPrefs;
    const picked = conversationPrefs(agentStore.prefs, own);
    const options = agentOptions({ ...agentStore, prefs: picked }, agent);
    const prefs = effectivePrefs(picked, agent, agentStore.roster, options);
    const summary = agentModelSummary(options, prefs);
    /* how hard it thinks, as the menu offers it */
    const effortOption = options?.find((o) => o.category === 'thought_level');
    const effort = effortOption && offeredOption(agent, agentStore.roster, effortOption) ? summary.effort : null;
    const modelLabel = [summary.model, effort].filter(Boolean).join(' · ');
    const started: Turn = {
      ...makePlaceholder(id, 'video', instruction, { projectId: projectKey, sessionId }),
      ...(promptDisplay ? { promptDisplay } : {}),
      ...(attachments?.length ? { attachments } : {}),
      localAgent: { id: agent, model: modelLabel || null },
      ...(origin ? { origin } : {}),
    } as Turn;
    if (shown) setTurns((list) => mergeAssetLists([started], list));
    /* the conversation is named by the words: a reference reads as its name there, not as "[1: name]" */
    const title = instruction.replace(/\[\d+: ([^\]]*)\]/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 80);
    /* the agent and the model and effort it ran on, kept on the conversation: it goes on with them when opened again.
       A turn the agent started by itself keeps no options: the person chose none there */
    touchSession(sessionId, (s) => ({
      title: s.title || title, turns: s.turns + 1, agent,
      ...(origin ? {} : { agentPrefs: { ...s.agentPrefs, [agent]: { ...s.agentPrefs?.[agent], ...keptPrefs(options, prefs) } } }),
    }));
    const meta: LocalAgentTurnMeta = {
      turnId: id, projectId: projectKey, projectTitle: project.name, sessionId, agent, prompt: instruction,
      turnNo: ordered.length, startedAt: Date.now(), turn: started,
    };
    registerRunningLocalTurn({ id, projectId: projectKey, projectTitle: project.name, sessionId, agent, prompt: instruction, startedAt: meta.startedAt, turn: started });
    /* the project's files as the turn found them (read before the agent is sent anything); once the turn settles,
       what it changed in them is kept with it and shown under its reply. The turn settles first: comparing the files
       is not worth keeping the person waiting for */
    const ready = app.chat.snapshot(project.path, id).then(() => true, () => false);
    /* kept as it goes, not only once it ends: the app closed (or crashed) on a turn, it is still there, read back as
       interrupted, what it did so far shown and the next message going on from there */
    let keeping: ReturnType<typeof setTimeout> | null = null;
    const keep = () => { keeping = null; if (settlers.current.has(id)) saveLocalAgentTurn(meta.projectId, { ...started, updatedAt: new Date().toISOString() }, restingItems(turn.items)); };
    const stopKeeping = turn.store.subscribe(() => { keeping ??= setTimeout(keep, KEEP_RUNNING_MS); });
    settlers.current.set(id, (patch) => {
      settlers.current.delete(id);
      if (keeping) clearTimeout(keeping);
      stopKeeping();
      const done = settleLocalTurn(meta, turn, patch);
      void ready.then(async (taken) => {
        const found = taken ? await app.chat.changes(project.path, id).catch(() => null) : null;
        const fileChanges = found?.files ?? [];
        if (!fileChanges.length) return;
        const kept: Turn & TurnFileChanges = { ...done, fileChanges };
        saveLocalAgentTurn(meta.projectId, kept, turn.items);
        /* the files as the turn found them, kept by the app: its footer's Undo. Not kept with the turn: the app keeps
           them only while it runs */
        const undoable = found?.undoable === true;
        setTurns((list) => list.map((item) => (item.id === id ? { ...item, fileChanges, ...(undoable ? { undoable } : {}) } : item)));
      });
    });
    keep();
    return { turn, meta, prefs, ready };
  }

  /**
   * Send a turn to the agent: what it is sent (`prepared`: the text, and the pictures) may take a moment to make. It
   * settles the turn the agent's run ends on: this one, or the last message sent into it while it ran (steerTurn).
   */
  function runTurn(opened: ReturnType<typeof openTurn>, prepared: Promise<{ text: string; images: PromptImage[]; skills?: string[]; said?: () => void }>): void {
    const { turn, meta, prefs, ready } = opened;
    const id = meta.turnId;
    const finish = (lastTurnId: string | undefined, patch: Partial<Turn & TurnBalance>) => {
      settlers.current.get(lastTurnId ?? id)?.(patch);
      settlers.current.get(id)?.(patch);
    };
    /* the agent's own session of this conversation, gone on with (after a restart too); a new one is kept for next time */
    const resume = sessions.find((s) => s.id === sessionId)?.agentSessions?.[agent] ?? null;
    const run = Promise.all([prepared, ready]).then(([{ text, images, skills, said }]) => runLocalAgentTurn({
      projectId: projectKey,
      conversation: sessionId,
      resume,
      agent,
      cwd: project.path,
      text,
      images,
      turn,
      options: prefs,
      meta,
      onOptions: (options) => useLocalAgents.getState().noteOptions(agent, options),
      /* Studio's note in the message reached the agent: Studio counts it told (lib/studio-film keptNote) */
      onStarted: said,
      onSessionInfo: (info) => {
        /* a session it could not take up again has none of the skills' pages from before: those of this message only */
        const fresh = !info.resumed || info.sessionId !== resume;
        if (info.sessionId && fresh) {
          touchSession(sessionId, (s) => ({
            agentSessions: { ...s.agentSessions, [agent]: info.sessionId },
            skillsGiven: givenAfter(s.skillsGiven, agent, info.sessionId, skills ?? [], { fresh }),
          }));
        }
      },
    })).then(
      ({ stopReason, lastTurnId }) => finish(lastTurnId, stopReason === 'cancelled' ? { status: 'cancelled', cancelReason: 'user' } : { status: 'ready' }),
      (error: unknown) => {
        /* the ACP adapter wraps the agent's own message as JSON-RPC "Internal error: …": the message is the reason */
        const reason = (error instanceof Error ? error.message : String(error)).replace(/^Internal error:\s*/i, '').trim() || String(error);
        /* the service the app's own agent runs on has no balance left: said as such, with its page, not as an error */
        const balance = readBalance((error as { balance?: unknown } | null)?.balance);
        const lastTurnId = (error as { lastTurnId?: string } | null)?.lastTurnId;
        (localAgentTurn(lastTurnId ?? id) ?? turn).patch(balance ? { balance } : { error: reason });
        finish(lastTurnId, { status: 'error', error: reason, ...(balance ? { balance } : {}) });
      },
    ).finally(() => { runs.current.delete(id); });
    runs.current.set(id, { conversation: meta.sessionId, run });
  }

  /**
   * A message sent while a turn runs, as in the agent's own chat: into that turn, the agent reading it at its next step
   * (an agent that takes steering). It shows as a turn of its own, what the agent says from then on under it, and the
   * running one is done. One that did not join (the turn ended meanwhile) is sent once that run ends.
   */
  function steerTurn(fromId: string, opened: ReturnType<typeof openTurn>, prepared: Promise<{ text: string; images: PromptImage[]; skills?: string[]; said?: () => void }>): void {
    /* the agent's run going now (one at a time in a conversation): a message that did not join waits for it */
    const run = [...runs.current.values()].filter((r) => r.conversation === opened.meta.sessionId).at(-1)?.run ?? Promise.resolve();
    void Promise.all([prepared, opened.ready]).then(async ([{ text, images, skills, said }]) => {
      if (await steerLocalAgentTurn(fromId, opened.turn, text, images)) {
        said?.();
        settlers.current.get(fromId)?.({ status: 'ready' });
        return;
      }
      await run.catch(() => {});
      runTurn(opened, Promise.resolve({ text, images, ...(skills ? { skills } : {}), ...(said ? { said } : {}) }));
    });
  }

  /* the conversations whose last turn the person undid, told to their agent with the next message there */
  const undone = React.useRef(new Set<string>());
  const undoneNote = (conversation: string): string => {
    if (!undone.current.delete(conversation)) return '';
    return '\n\n<studio_note>The person undid your last turn: the project\'s files are back as they were before it, and its message is out of the chat.</studio_note>';
  };
  /**
   * Undo the conversation's last turn: the files as it found them (the app keeps them while it runs), the turn out of
   * the conversation, and its message back in the composer, its pills too (a file brought in is not kept: its pill goes).
   */
  const undoTurn = async (entry: ProjectVersion): Promise<void> => {
    const done = await app.chat.undo?.(project.path, entry.assetId).catch(() => null);
    if (!done?.ok) { setFollowUpError(t('undo.gone')); return; }
    undoLocalAgentTurn(projectKey, entry.assetId);
    setTurns((list) => list.filter((item) => item.id !== entry.assetId));
    touchSession(sessionId, (s) => ({ turns: Math.max(0, s.turns - 1) }));
    undone.current.add(sessionId);
    setFollowUpError(done.missed.length ? t('undo.missed').replace('{names}', done.missed.slice(0, 3).join(', ') + (done.missed.length > 3 ? ` (+${done.missed.length - 3})` : '')) : null);
    const display = entry.promptDisplay ?? { text: entry.prompt, references: [] };
    const studio = new Map<string, StudioRef>();
    const files: PromptReference[] = [];
    const named: PromptReference[] = [];
    /* kept as the composer had them */
    for (const pill of display.references as PromptReference[]) {
      const ref = refFromPill(pill);
      if (ref) studio.set(pill.id, ref);
      else if (skillReferencePackage(pill.id)) named.push(pill);
      else if (!isAttachmentPill(pill.id)) files.push(pill);
    }
    setStudioRefs(studio);
    setFileRefs(files);
    setSkillRefs(named);
    /* written once the pills are the composer's, so each token finds its pill */
    requestAnimationFrame(() => { composerRef.current?.setText(display.text); composerRef.current?.focus(); });
  };
  const undoNow = React.useRef(undoTurn);
  undoNow.current = undoTurn;
  /* the last turn's Undo, for the conversation shown and none running: asked on the composer first */
  const [undoAsk, setUndoAsk] = React.useState<ProjectVersion | null>(null);
  const onUndo = React.useMemo(() => (active ? null : (entry: ProjectVersion) => setUndoAsk(entry)), [active]);
  React.useEffect(() => { if (active) setUndoAsk(null); }, [active]);

  function submitFollowUp(): void {
    if (!followUpFilled) return;
    /* while a turn runs: into it, for an agent that takes that; else it waits for the turn to end */
    const steer = active && asset ? canSteer(asset.id) : false;
    if (active && !steer) { setQueued(sessionId); return; }
    setQueued(null);
    /* the sentence as the agent reads it: a pill becomes "[n: name]", and what each number is follows, in a block; a
       file brought in becomes where it is */
    const attached = attachmentsInText(composerFiles.files, followUpRefs);
    const attachedById = new Map(attached.map((f) => [f.id, f]));
    const used: StudioRef[] = [];
    const instruction = resolvePromptReferences(followUp, (pillId, index) => {
      const ref = studioRefs.get(pillId);
      if (!ref) return null;
      used[index - 1] = ref;
      return `[${index}: ${refPill(pillId, ref).label}]`;
    }, (pillId) => {
      const name = skillReferencePackage(pillId);
      if (name) return `skill “${name}”`;
      const file = attachedById.get(pillId);
      return file ? attachmentWords(file) ?? '' : null;
    }).trim();
    /* the skills it names, for this message: each one's SKILL.md follows it, unseen in the chat, the first time this
       conversation's agent session meets that skill (lib/skill-pages) */
    const agentSession = sessions.find((s) => s.id === sessionId)?.agentSessions?.[agent] ?? null;
    const skillNames = pagesToSend(activatedSkillIds(followUpRefs), sessions.find((s) => s.id === sessionId)?.skillsGiven, agent, agentSession);
    if (!instruction) return;
    const blocker = attachmentBlocker(attached, t);
    if (blocker) { setFollowUpError(blocker); return; }
    setFollowUpError(null);
    /* sent with the assets open: they close (as they were, for next time) and the conversation shows */
    if (assetsOpen) app.setAssetsOpen(false);
    const promptDisplay = buildPromptDisplay(followUp, followUpRefs.map(sentPill));
    thread.scrollToBottom({ smooth: true });
    composerRef.current?.clear();
    setFollowUp('');
    setFollowUpRefs([]);
    setStudioRefs(new Map());
    setFileRefs([]);
    setSkillRefs([]);
    const files = composerFiles.take(attached.map((f) => f.id));
    const id = makeLocalAgentTurnId();
    const refs = used.filter(Boolean);
    const stage = selection?.stage ?? null;
    /* each reference's picture is kept in the project for the agent (the block names it), and sent to one that takes pictures */
    const skillTexts = skillNames.length ? (app.skills?.texts(project.path, agent, skillNames).catch(() => []) ?? Promise.resolve([])) : Promise.resolve([]);
    if (skillNames.length) touchSession(sessionId, (s) => ({ skillsGiven: givenAfter(s.skillsGiven, agent, agentSession, skillNames) }));
    /* an example pointed at: its folder fetched now if it is not yet (the turn waits, as it waits for its reply) */
    const withFolders = Promise.all(refs.map(async (ref) => (ref.kind === 'example' && !ref.folder
      ? { ...ref, folder: await app.exampleFolder?.(ref.id).catch(() => undefined) } : ref)));
    /* the pictures sent: the references' first, then the files brought in, in the order of their pills, while there is
       room (the rest by their path) */
    /* what the person changed while the agent last worked that Studio kept over its writes, said with this message */
    const prepared = withFolders.then((ready) => Promise.all([referencePictures(ready, { project: project.path, turnId: id }), skillTexts, keptNote(project.id, sessionId)])
      .then(async ([{ pictures, images }, skills, kept]) => ({
        text: instruction + studioReferencesText(ready, { stage, pictures }) + kept.text + undoneNote(sessionId) + skills.map((s) => `\n\n${s.text}`).join(''),
        images: [...images, ...await attachedPictures(files, PROMPT_PICTURES_MAX - images.length)],
        skills: skills.map((s) => s.name),
        said: kept.said,
      })));
    const opened = openTurn(id, instruction, promptDisplay ?? null, turnAttachments(files));
    if (steer && asset) steerTurn(asset.id, opened, prepared);
    else runTurn(opened, prepared);
  }

  /* queued while the turn ran (an agent that cannot take a message mid-turn): sent as soon as it ends */
  React.useEffect(() => {
    /* another tab shown meanwhile: the message stays written, not sent there */
    if (queued && queued !== sessionId) setQueued(null);
    else if (queued && !active) submitFollowUp();
  }, [queued, active, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the conversations whose turn runs now, by the turn: their lights breathe, and they cannot be archived meanwhile */
  const allRunning = useRunningLocalTurns();
  const running = React.useMemo(
    () => new Map(allRunning.filter((r) => r.projectId === projectKey).map((r) => [r.sessionId, r.id])),
    [allRunning, projectKey],
  );
  /* those that stopped while another was shown, and how their last turn ended: lit until shown */
  const [unseen, setUnseen] = React.useState<Map<string, 'done' | 'error'>>(() => new Map());
  const wasRunning = React.useRef(running);
  React.useEffect(() => {
    const ended = [...wasRunning.current.keys()].filter((id) => !running.has(id) && id !== shownSession.current);
    wasRunning.current = running;
    if (!ended.length) return;
    setUnseen((map) => {
      const next = new Map(map);
      for (const id of ended) next.set(id, loadLocalAgentTurns(projectKey, id).at(-1)?.turn.status === 'error' ? 'error' : 'done');
      return next;
    });
  }, [running, projectKey]);
  React.useEffect(() => {
    setUnseen((map) => {
      if (!map.has(sessionId)) return map;
      const next = new Map(map);
      next.delete(sessionId);
      return next;
    });
  }, [sessionId]);
  /* each conversation's agent at work whichever is shown: a new one, or another, any time; none while
     the one shown is new itself (false) */
  const onNewSession = (): boolean => {
    if (blank && !running.has(sessionId)) { composerRef.current?.focus(); return false; }
    setSessionId(newSession().id);
    composerRef.current?.focus();
    return true;
  };
  newConversation.current = onNewSession;
  const onSelectSession = (id: string) => { setSessionId(id); composerRef.current?.focus(); };
  const onRenameSession = (id: string, title: string) => editSession(id, { title });
  const onPinSession = (id: string, pinned: boolean) => editSession(id, { pinned });
  /* the conversation shown, archived: a new one in its place */
  const onArchiveSession = (id: string, archived: boolean) => {
    if (archived && running.has(id)) return;
    editSession(id, { archived });
    if (archived && id === sessionId) setSessionId(newSession().id);
  };
  const shownSessions = React.useMemo(
    () => (sessions.some((s) => s.id === sessionId) ? sessions : [{ ...newSession(), id: sessionId }, ...sessions]),
    [sessions, sessionId],
  );

  const agentName = agent === 'byok' ? t('composer.agentOwnKey') : la.roster?.find((a) => a.id === agent)?.name ?? agent;
  /* the last turn failed for the account of the person's own agent it ran on: Switch account, and whose it is */
  const failedOn = asset?.localAgent?.id ?? agent;
  const switchFor = turnError && failedOn !== 'byok' && accountTrouble(turnError) && desktopBridge()?.openSettings
    ? { who: accountName(la.roster?.find((a) => a.id === failedOn)?.account) } : null;
  /* DeepSeek Harness's model runs on an API key this computer has none of: said in the chat's words, and a model of
     the person's DeepSeek account offered in its place, picked as the model menu picks it (for this agent from now on) */
  const keyless = turnError && failedOn === 'deepseek' ? routeWithoutKey(turnError) : null;
  const onAccount = keyless ? accountModel(agentOptions(la, 'deepseek')) : null;
  /* any of the account's models counts, picked here or in the menu: the one they are on is named */
  const onAccountPicked = onAccount ? accountModelOf(agentOptions(la, 'deepseek'), agentPrefs.deepseek?.[onAccount.configId]) : null;
  const pickAccountModel = () => {
    if (!onAccount) return;
    la.setPref('deepseek', onAccount.configId, onAccount.value);
    keepOnSession((s) => ({ agentPrefs: { ...s.agentPrefs, deepseek: { ...s.agentPrefs?.deepseek, [onAccount.configId]: onAccount.value } } }));
    composerRef.current?.focus();
  };
  const wasName = agentWas === 'byok' ? t('composer.agentOwnKey') : agentWas ? la.roster?.find((a) => a.id === agentWas)?.name ?? AGENT_DEFINITIONS[agentWas]?.name ?? agentWas : '';

  const editComposerCard = (
    <div className="flex flex-col gap-1">
      <div
        /* a file from the disk dropped on the card is brought along, a pill where it was let go (on the words) or at
           the cursor; Studio's things dropped on it become pills too */
        onKeyDownCapture={onComposerKey}
        onDragOver={(event) => {
          if (!showsDropCaret(event.dataTransfer)) return;
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
          attachFiles(filesFromTransfer(event.dataTransfer), { x: event.clientX, y: event.clientY });
        }}
        data-prompt-shell=""
        className={`rounded-[12px] border bg-[var(--bg-raised)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-colors duration-200 ${
          dropping ? 'border-[var(--accent)]' : 'border-[var(--border)] focus-within:border-[var(--text-faint)]'
        }`}
      >
        {openedFile ? <AttachmentPreview item={openedFile} onClose={() => setOpenedFile(null)} /> : null}
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
              contentClassName="text-[14px] leading-[22px] text-[var(--text)]"
              onPasteFiles={(files) => attachFiles(files)}
              pillState={attachmentState}
              pillOpens={opensPill}
              showsDropCaret={showsDropCaret}
              mentions={{ providers: mentionProviders, label: t('mention.menu'), onOpen: loadMentionFiles }}
            />
          </div>
          {/* while it works: Stop, or Send once something is written (it goes into the turn, or after it); Esc stops */}
          <Tooltip label={stopping ? t('project.stop') : t('project.sendFollowUp')} shortcut={stopping ? 'Esc' : 'Enter'}>
            <button
              type="button"
              onClick={stopping ? () => { if (asset) void cancelLocalAgentTurn(asset.id); } : submitFollowUp}
              disabled={stopping ? false : !followUpFilled}
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:text-[var(--text-faint)] disabled:hover:bg-transparent"
              aria-label={stopping ? t('project.stop') : t('project.sendFollowUp')}
            >
              {stopping ? <Square size={14} /> : <CornerDownLeft size={14} />}
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="flex items-center gap-0.5 px-0.5">
        <ModelPopover
          placement="top"
          align="start"
          agent={agent}
          prefs={agentPrefs}
          onPick={(id) => keepOnSession(() => ({ agent: id }))}
          onPref={(id, configId, value) => keepOnSession((s) => ({ agentPrefs: { ...s.agentPrefs, [id]: { ...s.agentPrefs?.[id], [configId]: value } } }))}
        />
        <div className="min-w-0 flex-1" />
        <input
          ref={attachInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => { attachFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }}
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

  /* Esc stops the turn while it runs (the send button's other half): only one pressed in the chat, not held, and not
     just after one in Studio (lib/esc-stop.ts) */
  const escStops = React.useRef(escStopper());
  React.useEffect(() => {
    if (!active || !asset) return undefined;
    const onKey = (event: KeyboardEvent) => { if (escStops.current(event, inChat(event.target))) void cancelLocalAgentTurn(asset.id); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, asset]);

  return (
    <ChatProjectContext.Provider value={projectKey}>
      <PromptPillHoverContext.Provider value={pillHover.hover}>
        <WaitingContext.Provider value={Boolean(localTurn?.state.question || localTurn?.state.permission || spendAsk)}>
          <StickToBottomContext.Provider value={thread}>
            {/* with the assets open only the composer shows, at the bottom, floating over Studio's drawer: the drawer
                runs on under it, fading out behind it so the words under the composer stay clear */}
            <aside className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden ${assetsOpen ? 'mt-auto shrink-0 bg-[linear-gradient(to_bottom,transparent,var(--bg-panel)_36px)]' : 'flex-1 bg-[var(--bg-panel)]'}`}>
              <div className={`relative min-h-0 min-w-0 flex-1 flex-col ${assetsOpen ? 'hidden' : 'flex'}`}>
                <ConversationBar
                  sessions={shownSessions}
                  currentSessionId={sessionId}
                  running={running}
                  unseen={unseen}
                  onSelectSession={onSelectSession}
                  onNewSession={onNewSession}
                  onRenameSession={onRenameSession}
                  onPinSession={onPinSession}
                  onArchiveSession={onArchiveSession}
                />
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                  {/* the first message well below the session bar, as a chat app opens a conversation; the last well above
                      the composer, room for the way back to it */}
                  <div
                    ref={thread.viewportRef}
                    onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
                    className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [overflow-anchor:none] [scrollbar-gutter:stable] px-4${blank ? ' justify-center py-3.5' : ' pt-8 pb-24'}`}
                  >
                    {blank ? (
                      <div ref={thread.contentRef}>
                        <ProjectStarters onSkill={pickSkill} />
                      </div>
                    ) : (
                      <div ref={thread.contentRef} className="min-w-0 shrink-0">
                        <PromptPillRevealContext.Provider value={sentPills}>
                          <TurnUndoContext.Provider value={onUndo}>
                          <ProjectFolderContext.Provider value={projectFolder}>
                            <LiveConversation
                              store={liveStore}
                              turns={opLog}
                              liveAssetId={active ? asset!.id : null}
                              liveActive={active}
                              liveActivity={activity}
                              lastTurnRef={tail.lastTurnRef}
                            />
                          </ProjectFolderContext.Provider>
                          </TurnUndoContext.Provider>
                        </PromptPillRevealContext.Provider>
                      </div>
                    )}
                  </div>
                  <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-[var(--bg-panel)] to-transparent transition-opacity duration-150 ${scrolled && !blank ? 'opacity-100' : 'opacity-0'}`} />
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--bg-panel)] to-transparent" />
                  {!blank && !thread.atBottom && (
                    <Tooltip label={t('project.jumpToLatest')}>
                      <button
                        type="button"
                        onClick={() => thread.scrollToBottom({ smooth: true })}
                        aria-label={t('project.jumpToLatest')}
                        className="absolute bottom-4 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-raised)] text-[var(--text-muted)] shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition hover:bg-[var(--bg-field)] hover:text-[var(--text)]"
                      >
                        <ArrowDown size={17} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>

              {/* over the drawer it starts at its first card: the height it tells (setComposerHeight) is where the drawer's
                  player ends, on the card, no strip between */}
              <div ref={composerBlockRef} className="relative flex shrink-0 flex-col px-4 pb-1.5">
                <div className="flex flex-col gap-2" data-composer-cards="">
                  {/* what is said apart from the conversation, each a notice on the composer (NoticeCard): Studio's
                      own trouble, the asks waiting on the person, then this conversation's */}
                  {assetsOpen ? null : banners}
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
                    <AgentPermissionCard
                      key={localTurn.state.permission.requestId}
                      agentName={agentName}
                      permission={localTurn.state.permission}
                      onAnswer={(optionId) => { if (asset) void answerLocalAgentPermission(asset.id, optionId); }}
                    />
                  ) : null}
                  {undoAsk ? (
                    <Notice tone="warn" role="alertdialog" title={t('undo.title')} onClose={() => setUndoAsk(null)}
                      actions={<>
                        <CardButton weight="quiet" onClick={() => setUndoAsk(null)}>{t('undo.cancel')}</CardButton>
                        <CardButton weight="danger" onClick={() => { const entry = undoAsk; setUndoAsk(null); void undoNow.current(entry); }}>{t('undo.confirm')}</CardButton>
                      </>}>
                      {t('undo.description')}
                    </Notice>
                  ) : null}
                  {turnError && !closed.has(`error:${sessionId}:${turnError}`) ? (
                    <Notice tone="error" below onClose={() => close(`error:${sessionId}:${turnError}`)}
                      actions={<>
                        {/* what to send when it keeps failing */}
                        <CopyDiagnostics />
                        {/* failed for its account: Settings → Agents to switch it */}
                        {switchFor ? <CardButton weight="secondary" onClick={() => desktopBridge()?.openSettings?.('agents')}>{t('composer.switchAccount')}</CardButton> : null}
                        {onAccount && !onAccountPicked ? <CardButton weight="primary" onClick={pickAccountModel}>{t('composer.useAccountModel').replace('{model}', onAccount.name)}</CardButton> : null}
                      </>}>
                      {keyless ? t(onAccount ? 'composer.routeNoKey' : 'composer.routeNoKeyNoAccount') : turnError}
                      {onAccountPicked ? ` ${t('composer.accountModelPicked').replace('{model}', onAccountPicked.name)}` : null}
                      {switchFor?.who ? ` ${t('composer.signedInAs').replace('{account}', switchFor.who)}` : null}
                    </Notice>
                  ) : null}
                  {localTurn?.state.balance && !closed.has(`balance:${sessionId}`) ? <BalanceNotice balance={localTurn.state.balance} onClose={() => close(`balance:${sessionId}`)} /> : null}
                  {followUpError ? <Notice tone="error" onClose={() => setFollowUpError(null)}>{followUpError}</Notice> : null}
                  {queued === sessionId && active ? (
                    <Notice actions={<CardButton weight="quiet" onClick={() => setQueued(null)}>{t('composer.queuedCancel')}</CardButton>}>{t('composer.queued')}</Notice>
                  ) : null}
                  {/* the agent this conversation used cannot be used now: the next message goes to the one picked below */}
                  {agentWas && !closed.has(`was:${sessionId}`) ? (
                    <Notice onClose={() => close(`was:${sessionId}`)}>{t('composer.agentWas').replace('{name}', wasName)}</Notice>
                  ) : null}
                  {contextFull ? (
                    <Notice onClose={() => setContextNoticeOff(sessionId)}
                      actions={<CardButton weight="secondary" onClick={onNewSession}>{t('composer.contextFullNew')}</CardButton>}>{t('composer.contextFull')}</Notice>
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

