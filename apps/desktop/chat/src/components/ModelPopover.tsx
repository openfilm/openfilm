/**
 * The composer's agent button: which agent is thinking and with what (its model, reasoning effort and speed), and a
 * menu to change them.
 *
 * The menu lists the agents switched on in Settings → Agents (none when only one is: there is nothing to choose), then
 * a row for each option the agent reports, with its value; pointing at a row opens its choices in a side menu beside
 * it. Choosing leaves both open (a model and an effort are often changed together); a click elsewhere closes them.
 *
 * The chat is a view of its own and nothing can be drawn outside it, and the two never cover each other: the side menu
 * takes the room beside the card (a long name wraps to fit), the card slides left to make that room, and in a narrow
 * chat the card narrows to half of it.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, KeyRound } from 'lucide-react';
import { keepFocus, Popover } from './Popover';
import { useT } from '@/i18n';
import { Tooltip } from '@/components/Tooltip';
import { AgentIcon } from '@/components/AgentIcons';
import { POPOVER_CHROME } from '@/components/ComposerCard';
import { desktopBridge, type LocalAgentId, type RosterAgent } from '@/lib/desktop-bridge';
import { agentModelSummary, currentAgent, effectivePrefs, fixedModel, offeredOption, optionLabel, optionValue, shownAgents, useLocalAgents } from '@/state/local-agent-store';
import { chatLayer } from '@/lib/chat-layer';

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

type Option = { id: string; name: string; category?: string; options?: Array<{ value: unknown; name: string; description?: string }> };

/** The options the menu offers, in this order: the model, the reasoning effort, the speed (when the model has one). */
const isSpeed = (o: Option) => o.category === 'speed' || /^(fast|fast-mode|speed)$/i.test(o.id) || /\b(fast|speed)\b/i.test(o.name);
function menuOptions(options: Option[] | undefined): Option[] {
  const pick = (test: (o: Option) => boolean) => (options ?? []).find((o) => test(o) && (o.options?.length ?? 0) > 1);
  return [pick((o) => o.category === 'model'), pick((o) => o.category === 'thought_level'), pick(isSpeed)].filter((o): o is Option => Boolean(o));
}

export function ChatAgentIcon({ id, size = 14 }: { id: LocalAgentId; size?: number }) {
  if (id === 'byok') return <KeyRound size={size} />;
  return <AgentIcon id={id} size={size} />;
}

export function ModelPopover({ placement = 'bottom', align = 'start' }: { placement?: 'top' | 'bottom'; align?: 'start' | 'end' } = {}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  /** the option whose side menu is open */
  const [side, setSide] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  /** how far the card has slid left to make room for a side menu: it only grows while the menu is open */
  const [cardShift, setCardShift] = React.useState(0);
  const [sideStyle, setSideStyle] = React.useState<React.CSSProperties | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const sideRef = React.useRef<HTMLDivElement | null>(null);
  const rowRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const closeTimer = React.useRef<number | null>(null);
  const stopTimer = () => { if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const showSide = (id: string) => { stopTimer(); setSide(id); };
  const hideSideSoon = () => { stopTimer(); closeTimer.current = window.setTimeout(() => setSide(null), SIDE_CLOSE_MS); };
  React.useEffect(() => { if (!open) { stopTimer(); setSide(null); setNote(null); setCardShift(0); } }, [open]);
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
  const agent = currentAgent(la);
  const shown = shownAgents(la.roster);
  const ready = (id: LocalAgentId) => shown.find((a) => a.id === id)?.status === 'ready';
  React.useEffect(() => { if (ready(agent)) void ensureOptions(agent); });
  React.useEffect(() => {
    if (!open) return;
    void refresh().then(() => {
      for (const a of shownAgents(useLocalAgents.getState().roster)) if (a.status === 'ready') void ensureOptions(a.id);
    });
  }, [open, refresh, ensureOptions]);

  const options = la.options[agent];
  const prefs = effectivePrefs(la.prefs, agent, la.roster, la.options[agent]);
  const rows = menuOptions(options).filter((o) => offeredOption(agent, la.roster, o));
  const summary = agentModelSummary(options, prefs);
  const triggerModel = fixedModel(agent, la.roster) ?? summary.model;
  const triggerEffort = rows.some((o) => o.category === 'thought_level') ? summary.effort : null;
  const valueOf = (o: Option) => (o.category === 'model' ? triggerModel : null) ?? optionLabel(options, o.id, optionValue(options, prefs, o.id)) ?? '';
  const rowLabel = (o: Option) => (o.category === 'model' ? t('composer.model') : o.category === 'thought_level' ? t('composer.effort') : isSpeed(o) ? t('composer.speed') : o.name);
  const nameOf = (a: RosterAgent) => (a.id === 'byok' ? t('composer.agentOwnKey') : a.name);

  /* an agent that is not ready: what it needs, said here; setting it up is Settings → Agents */
  const statusOf = (a: RosterAgent): string | null => {
    if (a.status === 'ready') return null;
    if (a.status === 'checking') return t('composer.agentLoading');
    if (a.status === 'missing') return t('composer.agentNotFound');
    if (a.status === 'sign-in' || a.status === 'off') return t('composer.agentConnect');
    if (a.status === 'waiting') return t('composer.agentWaiting');
    return t('composer.agentSetUp');
  };
  const chooseAgent = (a: RosterAgent) => {
    setNote(null);
    setSide(null);
    if (a.status === 'ready') { la.pick(a.id); return; }
    if (a.status === 'sign-in' || a.status === 'off') {
      la.pick(a.id);
      void desktopBridge()?.agents?.connect(a.id).then((r) => { if (!r.ok) setNote(r.error ?? t('composer.agentConnectFailed')); });
      return;
    }
    if (a.status === 'checking' || a.status === 'waiting') return;
    setOpen(false);
    desktopBridge()?.openSettings?.('agents');
  };
  const openSettings = () => { setOpen(false); desktopBridge()?.openSettings?.('agents'); };
  const current = shown.find((a) => a.id === agent);
  const choosing = side ? rows.find((o) => o.id === side) : undefined;
  const chosenValue = (o: Option) => optionValue(options, prefs, o.id);
  const pickChoice = (o: Option, value: unknown) => la.setPref(agent, o.id, value);

  /* the side menu beside its row: on the right of the card, the card sliding left when the window is too narrow for
     both, and over the card's right edge only when it cannot slide far enough; measured again once it is drawn */
  const sidePainted = sideStyle !== null;
  React.useLayoutEffect(() => {
    const card = cardRef.current;
    const row = choosing ? rowRefs.current[choosing.id] : null;
    if (!open || !choosing || !card || !row) { setSideStyle(null); return; }
    const c = card.getBoundingClientRect();
    const el = sideRef.current;
    const sideMax = Math.max(0, room - c.width);
    const w = Math.min(sideMax, Math.max(SIDE_MIN_W, el?.offsetWidth ?? SIDE_MIN_W));
    const h = el?.offsetHeight ?? 8 + (choosing.options?.length ?? 0) * 28;
    const width = window.innerWidth;
    const height = window.innerHeight;
    let left = c.right + SIDE_GAP;
    const need = left + w - (width - EDGE);
    if (need > 0) {
      const slide = Math.min(need, Math.max(0, c.left - EDGE));
      if (slide > 0) setCardShift((s) => s + slide);
      left = Math.max(EDGE, Math.min(left - slide, width - EDGE - w));
    }
    let top = row.getBoundingClientRect().top - 4;
    if (top + h > height - EDGE) top = Math.max(EDGE, height - EDGE - h);
    setSideStyle({ position: 'fixed', left, top, zIndex: 10001, minWidth: Math.min(SIDE_MIN_W, sideMax), width: 'max-content', maxWidth: sideMax, maxHeight: height - 2 * EDGE });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the open row
  }, [open, choosing?.id, cardShift, sidePainted, room]);

  const sideMenu = open && choosing && typeof document !== 'undefined' ? createPortal(
    <div ref={sideRef} onMouseEnter={() => showSide(choosing.id)} onMouseLeave={hideSideSoon}
      style={{ ...POPOVER_CHROME, padding: 4, overflowY: 'auto', ...(sideStyle ?? { position: 'fixed', left: -9999, top: 0 }) }}>
      {/* the names only: no descriptions, and no "Default" row (a default is one of the others) */}
      {(choosing.options ?? []).filter((choice) => choice.value !== 'default').map((choice) => {
        const selected = chosenValue(choosing) === choice.value;
        return (
          <button key={String(choice.value)} type="button" onMouseDown={keepFocus}
            onClick={() => pickChoice(choosing, choice.value)} className={ROW}>
            <span className="min-w-0 flex-1 truncate text-[var(--text)]">{choice.name}</span>
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
              <span className="shrink-0 text-[var(--text-dim)]"><ChatAgentIcon id={agent} size={13} /></span>
              <span className="truncate text-[var(--text-dim)] transition group-hover:text-[var(--text)]">
                {(ready(agent) && triggerModel) || (current ? nameOf(current) : t('composer.agentNone'))}
              </span>
              {ready(agent) && triggerEffort ? <span className="text-[var(--text-muted)] transition group-hover:text-[var(--text-dim)]">{triggerEffort}</span> : null}
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
            {shown.length > 1 ? (
              <>
                <div className="px-2.5 pb-1 pt-1 text-[11px] text-[var(--text-faint)]">{t('composer.agentSection')}</div>
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
                {note ? <p className="px-2.5 pb-1 pt-0.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{note}</p> : null}
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
                  ? <>{t('composer.agentOptionsFailed')} <button type="button" onMouseDown={keepFocus} onClick={() => void la.ensureOptions(agent)} className="text-[var(--text)] underline underline-offset-2">{t('project.retry')}</button></>
                  : t('composer.agentLoading')}
              </p>
            ) : rows.map((o, i) => (
              <React.Fragment key={o.id}>
                {i > 0 ? <div className="mx-1 my-0.5 h-px bg-[var(--border)]" /> : null}
                <button type="button" ref={(el) => { rowRefs.current[o.id] = el; }} aria-haspopup="menu" aria-expanded={side === o.id}
                  onMouseDown={keepFocus} onMouseEnter={() => showSide(o.id)} onMouseLeave={hideSideSoon} onFocus={() => showSide(o.id)}
                  onClick={() => showSide(o.id)}
                  className={`${ROW_BASE} ${side === o.id ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}>
                  <span className="shrink-0 text-[var(--text)]">{rowLabel(o)}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-[var(--text-dim)]">{valueOf(o)}</span>
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
