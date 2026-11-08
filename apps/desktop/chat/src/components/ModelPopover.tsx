/**
 * The composer's agent button: which agent is thinking and with what (its model, reasoning effort and speed), and a
 * menu to change them.
 *
 * The menu opens on a heading with a button to Settings → Agents, then lists the agents switched on there (none when
 * only one is: there is nothing to choose, and the heading names it instead), then its model and effort, always, and
 * its speed when it has one (agent-menu-rows.ts), each with its value; pointing at a row opens its choices in a side
 * menu beside it. Choosing leaves both open (a model and an effort are often changed together); a click elsewhere
 * closes them.
 *
 * The chat is a view of its own and nothing can be drawn outside it, and the two never cover each other: the side menu
 * takes the room beside the card (a long name wraps to fit), the card slides left to make that room, and in a narrow
 * chat the card narrows to half of it.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, KeyRound, Settings } from 'lucide-react';
import { keepFocus, Popover } from './Popover';
import { useT } from '@/i18n';
import { Tooltip } from '@/components/Tooltip';
import { AgentIcon } from '@/components/AgentIcons';
import { BrandLogo } from '@/components/BrandLogo';
import { POPOVER_CHROME } from '@/components/ComposerCard';
import { desktopBridge, type LocalAgentId, type RosterAgent } from '@/lib/desktop-bridge';
import { agentModelSummary, agentOptions, currentAgent, effectivePrefs, offeredChoices, offeredOption, optionLabel, optionValue, shownAgents, useLocalAgents } from '@/state/local-agent-store';
import { chatLayer } from '@/lib/chat-layer';
import { isSpeed, menuOptions, type MenuOption } from '@/lib/agent-menu-rows';

/** the card, wider when it lists the agents; the side menu's least width; the gap between them; the window's margin */
const CARD_W = 236;
const CARD_W_ONE_AGENT = 204;
const SIDE_MIN_W = 156;
/** the narrowest the card gets in a narrow chat */
const CARD_MIN_W = 150;
const SIDE_GAP = 2;
const EDGE = 8;
/** how long a side menu stays once the pointer leaves its row (to cross the gap into it) */
const SIDE_CLOSE_MS = 120;

const ROW_BASE =
  'flex min-h-[28px] w-full items-center gap-2 rounded-[6px] px-2.5 text-[13px] font-normal tracking-normal text-left outline-none transition';
const ROW = `${ROW_BASE} hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]`;

type Option = MenuOption;

/** A row's choices: those the agent offers there, or its one value when that is all it has (a "default" too). */
function rowChoices(agent: LocalAgentId, o: Option, chosen: unknown): NonNullable<Option['options']> {
  if (o.fixed) return o.options!.slice(0, 1);
  return offeredChoices(agent, o, chosen);
}

/** Why the agent could not be started for its settings, as it said, on a few lines; none when it started and offered none. */
function failureReason(error: { text: string } | undefined): string | null {
  if (!error || error.text === 'no options') return null;
  return error.text.replace(/\s+/g, ' ').trim().slice(0, 400) || null;
}

export function ChatAgentIcon({ id, size = 14 }: { id: LocalAgentId; size?: number }) {
  if (id === 'openfilm') return <BrandLogo size={size} />;
  if (id === 'byok') return <KeyRound size={size} />;
  return <AgentIcon id={id} size={size} />;
}

/**
 * The composer's agent menu. In a conversation, `agent` and `prefs` are the ones it goes on with (lib/conversation-agent),
 * and `onPick` and `onPref` keep a change on it too; without them, the agent and options picked last.
 */
export function ModelPopover({ placement = 'bottom', align = 'start', agent: conversationAgent, prefs: conversationPrefs, onPick, onPref }: {
  placement?: 'top' | 'bottom';
  align?: 'start' | 'end';
  agent?: LocalAgentId;
  prefs?: Partial<Record<LocalAgentId, Record<string, unknown>>>;
  onPick?: (agent: LocalAgentId) => void;
  onPref?: (agent: LocalAgentId, configId: string, value: unknown) => void;
} = {}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  /** the option whose side menu is open */
  const [side, setSide] = React.useState<string | null>(null);
  /** how far the card has slid left to make room for a side menu; kept within the window on resize */
  const [cardShift, setCardShift] = React.useState(0);
  const [sideStyle, setSideStyle] = React.useState<React.CSSProperties | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const sideRef = React.useRef<HTMLDivElement | null>(null);
  const rowRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const closeTimer = React.useRef<number | null>(null);
  const stopTimer = () => { if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const showSide = (id: string) => { stopTimer(); setSide(id); };
  const hideSideSoon = () => { stopTimer(); closeTimer.current = window.setTimeout(() => setSide(null), SIDE_CLOSE_MS); };
  React.useEffect(() => { if (!open) { stopTimer(); setSide(null); setCardShift(0); } }, [open]);
  React.useEffect(() => stopTimer, []);
  /* the window's width while open: the card and the side menu share it */
  const [windowW, setWindowW] = React.useState(() => window.innerWidth);
  React.useEffect(() => {
    if (!open) return;
    const read = () => setWindowW(window.innerWidth);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [open]);
  const room = windowW - 2 * EDGE - SIDE_GAP;

  const la = useLocalAgents();
  const { hydrate, refresh, ensureOptions } = la;
  React.useEffect(() => { hydrate(); }, [hydrate]);
  const agent = conversationAgent ?? currentAgent(la);
  const shown = shownAgents(la.roster);
  const ready = (id: LocalAgentId) => shown.find((a) => a.id === id)?.status === 'ready';
  const selectedReady = ready(agent);
  const configurationRevision = la.roster?.find((a) => a.id === agent)?.configurationRevision;
  React.useEffect(() => { if (selectedReady) void ensureOptions(agent); }, [agent, selectedReady, configurationRevision, ensureOptions]);
  React.useEffect(() => {
    if (!open) return;
    void refresh();
    if (useLocalAgents.getState().roster?.some((a) => a.id === agent && a.shown && a.status === 'ready')) void ensureOptions(agent, { retry: true });
  }, [open, agent, refresh, ensureOptions]);

  const picked = conversationPrefs ?? la.prefs;
  const options = agentOptions({ ...la, prefs: picked }, agent);
  const prefs = effectivePrefs(picked, agent, la.roster, options);
  const rows = options ? menuOptions(options, t('composer.optionDefault')).filter((o) => offeredOption(agent, la.roster, o)) : [];
  const summary = agentModelSummary(options, prefs);
  const triggerModel = summary.model;
  const triggerEffort = rows.some((o) => o.category === 'thought_level' && !o.fixed) ? summary.effort : null;
  const valueOf = (o: Option) => (o.fixed ? (optionLabel(options, o.id, optionValue(options, prefs, o.id)) ?? o.options![0]!.name)
    : (o.category === 'model' ? triggerModel : null) ?? optionLabel(options, o.id, optionValue(options, prefs, o.id)) ?? '');
  const rowLabel = (o: Option) => (o.category === 'model' ? t('composer.model') : o.category === 'thought_level' ? t('composer.effort') : isSpeed(o) ? t('composer.speed') : o.name);
  const nameOf = (a: RosterAgent) => (a.id === 'byok' ? t('composer.agentOwnKey') : a.name);

  /* an agent that is not ready: what it needs, said here; setting it up is Settings → Agents */
  const statusOf = (a: RosterAgent): string | null => {
    if (a.status === 'ready') return null;
    if (a.status === 'checking') return t('composer.agentLoading');
    if (a.status === 'missing') return t('composer.agentNotFound');
    if (a.status === 'waiting') return t('composer.agentWaiting');
    return t('composer.agentSetUp');
  };
  const chooseAgent = (a: RosterAgent) => {
    setSide(null);
    if (a.status === 'ready') { la.pick(a.id); onPick?.(a.id); return; }
    if (a.status === 'checking' || a.status === 'waiting') return;
    /* not connected, signed out, not found, no key: set up in Settings → Agents, where connecting and signing in are */
    setOpen(false);
    desktopBridge()?.openSettings?.('agents');
  };
  const openSettings = () => { setOpen(false); desktopBridge()?.openSettings?.('agents'); };
  const current = shown.find((a) => a.id === agent);
  const choosing = side ? rows.find((o) => o.id === side) : undefined;
  const chosenValue = (o: Option) => (o.fixed ? o.options![0]!.value : optionValue(options, prefs, o.id));
  /* a fixed row's one value is already the one in use */
  const pickChoice = (o: Option, value: unknown) => { if (!o.fixed) { la.setPref(agent, o.id, value); onPref?.(agent, o.id, value); } };

  /* Keep the side menu beside its row and inside the window, including when an agent adds choices while it is open
     or the window's height changes. Measure again after width/height constraints change the rendered menu. */
  const sidePainted = sideStyle !== null;
  React.useLayoutEffect(() => {
    const card = cardRef.current;
    const row = choosing ? rowRefs.current[choosing.id] : null;
    const el = sideRef.current;
    if (!open || !choosing || !card || !row || !el) { setSideStyle(null); return; }
    const update = () => {
      const c = card.getBoundingClientRect();
      const width = window.innerWidth;
      const height = window.innerHeight;
      const sideMax = Math.max(0, width - 2 * EDGE - SIDE_GAP - c.width);
      const minWidth = Math.min(SIDE_MIN_W, sideMax);
      const maxHeight = Math.max(0, height - 2 * EDGE);
      const w = Math.min(sideMax, Math.max(minWidth, el.offsetWidth));
      const h = Math.min(el.offsetHeight, maxHeight);
      const baseLeft = c.left + cardShift;
      let shift = Math.min(cardShift, Math.max(0, baseLeft - EDGE));
      let left = c.right + cardShift - shift + SIDE_GAP;
      const need = left + w - (width - EDGE);
      if (need > 0) {
        const slide = Math.min(need, Math.max(0, baseLeft - shift - EDGE));
        shift += slide;
        left -= slide;
      }
      if (shift !== cardShift) setCardShift(shift);
      left = Math.max(EDGE, Math.min(left, width - EDGE - w));
      const top = Math.max(EDGE, Math.min(row.getBoundingClientRect().top - 4, height - EDGE - h));
      setSideStyle((previous) => previous?.left === left && previous.top === top && previous.minWidth === minWidth
        && previous.maxWidth === sideMax && previous.maxHeight === maxHeight ? previous
        : { position: 'fixed', left, top, zIndex: 10001, minWidth, width: 'max-content', maxWidth: sideMax, maxHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    observer.observe(card);
    observer.observe(row);
    // The parent Popover also moves on resize/scroll. Read after its React update has committed.
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the open row
  }, [open, choosing?.id, cardShift, sidePainted, room]);

  const sideMenu = open && choosing && typeof document !== 'undefined' ? createPortal(
    <div ref={sideRef} onMouseEnter={() => showSide(choosing.id)} onMouseLeave={hideSideSoon}
      style={{ ...POPOVER_CHROME, padding: 4, overflowY: 'auto', ...(sideStyle ?? { position: 'fixed', left: -9999, top: 0 }) }}>
      {/* The model's maker for OpenFilm, then its name; the choices follow Settings' order and visibility. */}
      {rowChoices(agent, choosing, chosenValue(choosing)).map((choice) => {
        const selected = chosenValue(choosing) === choice.value;
        return (
          <button key={String(choice.value)} type="button" onMouseDown={keepFocus}
            disabled={choice.disabled} title={choice.disabled ? t('composer.modelUnavailableInfo') : undefined}
            onClick={() => pickChoice(choosing, choice.value)} className={`${ROW} disabled:cursor-default disabled:opacity-50`}>
            {agent === 'openfilm' && choosing.category === 'model' ? <span className="flex w-4 shrink-0 justify-center text-[var(--text-muted)]"><AgentIcon id={String(choice.value).startsWith('anthropic/') ? 'claude' : String(choice.value).startsWith('openai/') ? 'codex' : 'deepseek'} size={14} /></span> : null}
            <span className="min-w-0 flex-1 truncate text-[var(--text)]">{choice.name}</span>
            {choice.disabled ? <span className="text-[11px] text-[var(--text-muted)]">{t('composer.modelUnavailable')}</span> : null}
            <Check size={13} className={`ml-2 shrink-0 text-[var(--text)] ${selected ? '' : 'invisible'}`} />
          </button>
        );
      })}
    </div>,
    chatLayer(),
  ) : null;

  return (
    <>
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      align={align}
      bare
      insideRefs={[sideRef]}
      trigger={
        <Tooltip label={t('composer.model')}>
          <button type="button" onMouseDown={keepFocus}
            className="group inline-flex h-8 max-w-full items-center rounded-full px-2 text-[12.5px] font-medium transition hover:bg-[var(--bg-hover)]">
            <span className="inline-flex min-w-0 max-w-[190px] items-center gap-1.5 truncate whitespace-nowrap">
              <span className="shrink-0 text-[var(--text-muted)]"><ChatAgentIcon id={agent} size={13} /></span>
              <span className="truncate text-[var(--text-muted)] transition group-hover:text-[var(--text)]">
                {(ready(agent) && triggerModel) || (current ? nameOf(current) : t('composer.agentNone'))}
              </span>
              {ready(agent) && triggerEffort ? <span className="text-[var(--text-muted)] transition group-hover:text-[var(--text-muted)]">{triggerEffort}</span> : null}
            </span>
          </button>
        </Tooltip>
      }
    >
      <div ref={cardRef} style={{ ...POPOVER_CHROME, width: Math.min(shown.length > 1 ? CARD_W : CARD_W_ONE_AGENT, Math.max(CARD_MIN_W, Math.floor(room / 2))), padding: 4, transform: cardShift ? `translateX(-${cardShift}px)` : undefined }}>
        {shown.length === 0 && la.roster ? (
          <div className="px-2.5 py-2 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            {t('composer.agentNoneShown')}{' '}
            <button type="button" onMouseDown={keepFocus} onClick={openSettings} className="text-[var(--text)] underline underline-offset-2">{t('composer.openSettings')}</button>
          </div>
        ) : (
          <>
            {/* the heading, and Settings → Agents beside it (where agents are switched on, connected and signed in) */}
            <div className="flex items-center gap-2 pb-0.5 pl-2.5 pr-0.5 pt-0.5">
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-faint)]">{shown.length > 1 ? t('composer.agentSection') : current ? nameOf(current) : t('composer.agentSection')}</span>
              <Tooltip label={t('composer.openSettings')}>
                <button type="button" aria-label={t('composer.openSettings')} onMouseDown={keepFocus} onMouseEnter={hideSideSoon} onClick={openSettings}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-faint)] outline-none transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:bg-[var(--bg-hover)]">
                  <Settings size={13} />
                </button>
              </Tooltip>
            </div>
            {shown.length > 1 ? (
              <>
                {shown.map((a) => {
                  const status = statusOf(a);
                  return (
                    <button key={a.id} type="button" onMouseDown={keepFocus} onMouseEnter={hideSideSoon} onClick={() => chooseAgent(a)} className={ROW}>
                      <span className={`flex w-4 shrink-0 justify-center ${status ? 'text-[var(--text-faint)]' : 'text-[var(--text)]'}`}><ChatAgentIcon id={a.id} /></span>
                      <span className={`min-w-0 flex-1 truncate ${status ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{nameOf(a)}</span>
                      {agent === a.id && !status ? <Check size={13} className="shrink-0 text-[var(--text)]" />
                        : status ? <span className="min-w-0 max-w-[55%] truncate text-[11.5px] text-[var(--text-faint)]" title={status}>{status}</span> : null}
                    </button>
                  );
                })}
                <div className="mx-1 my-1 h-px bg-[var(--border)]" />
              </>
            ) : null}
            {!ready(agent) ? (
              <div className="px-2.5 py-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
                {current ? `${nameOf(current)}: ${statusOf(current) ?? ''}` : t('composer.agentLoading')}{' '}
                <button type="button" onMouseDown={keepFocus} onClick={openSettings} className="text-[var(--text)] underline underline-offset-2">{t('composer.openSettings')}</button>
              </div>
            ) : rows.length === 0 ? (
              <p className="px-2.5 py-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
                {la.optionsError[agent]
                  ? <>
                    {la.optionsError[agent]?.code === 'outdated' ? t('composer.agentOutdated') : t('composer.agentOptionsFailed')} <button type="button" onMouseDown={keepFocus} onClick={() => void la.ensureOptions(agent, { retry: true })} className="text-[var(--text)] underline underline-offset-2">{t('project.retry')}</button>
                    {/* what the agent said, so the person can fix it (a setting it cannot read) or tell us */}
                    {failureReason(la.optionsError[agent]) ? (
                      <span className="mt-1 line-clamp-4 block select-text break-words text-[11.5px] text-[var(--text-faint)]" title={la.optionsError[agent]?.text}>{failureReason(la.optionsError[agent])}</span>
                    ) : null}
                  </>
                  : t('composer.agentLoading')}
              </p>
            ) : rows.map((o, i) => (
              <React.Fragment key={o.id}>
                {i > 0 ? <div className="mx-1 my-0.5 h-px bg-[var(--border)]" /> : null}
                <button type="button" data-agent-option={o.id} ref={(el) => { rowRefs.current[o.id] = el; }} aria-haspopup="menu" aria-expanded={side === o.id}
                  onMouseDown={keepFocus} onMouseEnter={() => showSide(o.id)} onMouseLeave={hideSideSoon} onFocus={() => showSide(o.id)}
                  onClick={() => showSide(o.id)}
                  className={`${ROW_BASE} ${side === o.id ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}>
                  <span className="shrink-0 text-[var(--text)]">{rowLabel(o)}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-[var(--text-muted)]">{valueOf(o)}</span>
                  <ChevronRight size={12} className="shrink-0 text-[var(--text-faint)]" />
                </button>
              </React.Fragment>
            ))}
          </>
        )}
      </div>
    </Popover>
    {sideMenu}
    </>
  );
}

export { Popover } from './Popover';
