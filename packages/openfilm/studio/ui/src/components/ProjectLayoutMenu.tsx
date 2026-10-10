import React from 'react';
import { createPortal } from 'react-dom';
import { Layers, MessageSquare, PanelBottom, PanelLeft, PanelRight, PanelsRightBottom } from 'lucide-react';
import { useT } from '@/i18n';
import { Tooltip } from './Tooltip';

/** The top bar's Layout button: a small panel of switches that show or hide the Assets, Layers, Timeline and Inspector
    panes (and the host app's own panel, when there is one). */
export function ProjectLayoutMenu({ className, assets, layers, timeline, inspector, onAssets, onLayers, onTimeline, onInspector, hostPanel }: {
  className?: string;
  /** the app's own panel around Studio (lib/host.ts `panel`), switched here like Studio's own */
  hostPanel?: { label: string; open: boolean; onChange: (open: boolean) => void } | null;
  /** null: the media is not a pane of Studio's here (the host app keeps it in its own panel) */
  assets: boolean | null;
  layers: boolean;
  timeline: boolean;
  inspector: boolean;
  onAssets: (open: boolean) => void;
  onLayers: (open: boolean) => void;
  onTimeline: (open: boolean) => void;
  onInspector: (open: boolean) => void;
}) {
  const t = useT();
  const button = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = React.useState<{ right: number; top: number } | null>(null);
  const id = React.useId();
  React.useEffect(() => {
    if (!anchor) return;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setAnchor(null);
    };
    const close = () => setAnchor(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); button.current?.focus(); }
    };
    /* capture phase: the picture, the timeline and inputs each stop pointerdown, so it never bubbles to window.
       A click into the preview iframe sends no event at all, only a window blur — that counts as "elsewhere" too. */
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [anchor]);
  return <>
    <Tooltip label={t('layout.title')} side="bottom">
      <button ref={button} type="button" className={className} aria-label={t('layout.title')}
        aria-haspopup="dialog" aria-expanded={!!anchor} aria-controls={anchor ? id : undefined}
        onClick={() => {
          const rect = button.current!.getBoundingClientRect();
          setAnchor(current => current ? null : { right: Math.max(12, window.innerWidth - rect.right), top: rect.bottom + 6 });
        }}><PanelsRightBottom size={16} /></button>
    </Tooltip>
    {anchor && createPortal(<div ref={panel} id={id} role="dialog" aria-label={t('layout.title')}
      style={anchor} className="fixed z-[110] w-52 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.12)]">
      <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-[var(--text-faint)]">{t('layout.title')}</div>
      {[
        /* the app's own panel first: in an app with a chat, the chat is the pane people switch most */
        ...(hostPanel ? [['panel', hostPanel.label, hostPanel.open, hostPanel.onChange, MessageSquare] as const] : []),
        ...(assets == null ? [] : [['assets', t('layout.assets'), assets, onAssets, PanelLeft] as const]),
        ['layers', t('layout.layers'), layers, onLayers, Layers] as const,
        ['timeline', t('layout.timeline'), timeline, onTimeline, PanelBottom] as const,
        ['inspector', t('layout.inspector'), inspector, onInspector, PanelRight] as const,
      ].map(([key, label, checked, change, Icon]) => <button key={key} type="button" role="switch"
        aria-checked={checked} onClick={() => change(!checked)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-[var(--text)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-[var(--border-strong)]">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--surface-2)] text-[var(--text-muted)]"><Icon size={13} aria-hidden /></span>
        <span className="flex-1 text-left">{label}</span>
        {/* a switch, not a tick: each pane is open or closed, not one picked from a set. Ink-colored, not blue. */}
        <span aria-hidden className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${checked ? 'bg-[var(--text)]' : 'bg-[var(--surface-2)] ring-1 ring-inset ring-[var(--border)]'}`}>
          <span className={`absolute top-[3px] h-3 w-3 rounded-full transition-all ${checked ? 'left-[15px] bg-[var(--bg)]' : 'left-[3px] bg-[var(--text-faint)]'}`} />
        </span>
      </button>)}
    </div>, document.body)}
  </>;
}
