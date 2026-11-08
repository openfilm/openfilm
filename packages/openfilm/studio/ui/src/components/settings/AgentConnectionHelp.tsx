import React from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useT } from '@/i18n';
import type { HostAgent, HostAgentDiagnosis } from '@/lib/host';
import { agentMark } from '@/lib/provider-marks';
import { ProviderMark } from './ProviderMark';
import { DialogClose, DialogIdentity } from './DialogIdentity';
import { SettingsButton, SettingsLinkButton } from './ui';

/** Connection instructions and opt-in diagnostics, above Settings without closing the parent dialog on Escape. */
export function AgentConnectionHelp({ agent, status, report, checking, hint, error, notice, copied, onClose, onCheck, onLocate, onCopy, actions, connectionStatus }: {
  agent: HostAgent;
  status: string | null;
  report: HostAgentDiagnosis | null;
  checking: boolean;
  hint: string | null;
  error?: string;
  notice?: string;
  copied?: boolean;
  onClose: () => void;
  onCheck?: () => void;
  onLocate?: () => void;
  onCopy?: () => void;
  actions?: React.ReactNode;
  connectionStatus?: React.ReactNode;
}) {
  const t = useT();
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return undefined;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.showModal();
    return () => { node.close(); document.body.style.overflow = overflow; };
  }, []);

  const setup = agent.setupRequired === 'code-tab' ? 'claudeSetup' : agent.path ? 'helpFound'
    : agent.app ? 'helpDesktopOnly' : ['codex', 'copilot', 'opencode', 'deepseek'].includes(agent.id) ? 'helpBundled' : 'helpInstall';
  const words = (key: string) => t(`settings.agents.${key}`).replaceAll('{name}', agent.name);
  const raw = [error, agent.connectionIssue?.message, report?.text].filter(Boolean).join('\n\n');
  const website = (() => {
    if (!agent.install) return undefined;
    try { const url = new URL(agent.install); return { href: url.href, label: url.host }; }
    catch { return undefined; }
  })();

  return createPortal(
    <dialog ref={dialog} aria-label={words('helpTitle')} aria-modal="true"
      className="m-auto max-h-[85vh] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg-raised)] p-0 text-[var(--text)] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5)] backdrop:bg-black/50 open:flex open:flex-col"
      style={{ width: 'min(640px, calc(100vw - 32px))' }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <DialogClose label={words('close')} onClose={onClose} />
      <div className="shrink-0 px-7 pt-7">
        <DialogIdentity name={agent.name} mark={<ProviderMark id={agentMark(agent.id)} size={24} />} website={website} actions={actions} status={connectionStatus} />
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-7 py-5 text-[14px] leading-relaxed text-[var(--text-muted)]">
        <section>
          <h4 className="mb-2 font-medium text-[var(--text)]">{words('helpConnect')}</h4>
          <ol className="ml-5 list-decimal space-y-2">
            <li>{words(setup)}</li><li>{words('helpLogin')}</li><li>{words('helpRefresh')}</li>
          </ol>
        </section>
        <section className="mt-5">
          <h4 className="mb-2 font-medium text-[var(--text)]">{words('helpMissingTitle')}</h4>
          <p>{words('helpMissingBody')}</p>
          <p className="mt-2">{words('helpDesktop')}</p>
          {onLocate ? <button type="button" onClick={() => { onClose(); onLocate(); }} className="mt-2 text-[13px] underline underline-offset-2 hover:text-[var(--text)]">{words('locateFolder')}</button> : null}
        </section>
        {agent.connectionIssue ? <p className="mt-4">{words(agent.connectionIssue.kind === 'quota' ? 'quotaHelp' : 'credentialsHelp')}</p> : null}
        <section className="mt-5 border-t border-[var(--border)] pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="font-medium text-[var(--text)]">{words('helpCheckTitle')}</h4>
            {onCheck ? <SettingsButton variant="quiet" disabled={checking} onClick={onCheck}>{checking ? <Loader2 size={14} className="animate-spin" /> : null}{words(checking ? 'searching' : 'recheck')}</SettingsButton> : null}
          </div>
          {status && !connectionStatus ? <p>{status}</p> : null}
          {notice ? <p role="status" className="mt-2">{notice}</p> : null}
          {agent.path ? <p className="mt-1 break-all font-mono text-[12px]">{agent.path}</p> : null}
          {hint ? <p role="status" className="mt-2">{hint}</p> : null}
          {raw ? <details className="mt-3 text-[13px]">
            <summary className="cursor-pointer py-1">{words('technicalDetails')}</summary>
            <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-[var(--bg-field)] p-3 font-mono text-[12px]">{raw}</pre>
          </details> : null}
          {report && onCopy ? <div className="mt-3 flex flex-col gap-2 text-[12px]">
            <p>{words('reportNote')}</p>
            <SettingsButton variant="quiet" onClick={onCopy}>{copied ? <Check size={14} /> : <Copy size={14} />}{words(copied ? 'copied' : 'copyReport')}</SettingsButton>
          </div> : null}
        </section>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--border)] px-7 py-4">
        {agent.install ? <SettingsLinkButton href={agent.install}>{words('helpOfficial')}</SettingsLinkButton> : <span />}
        <SettingsButton autoFocus onClick={onClose}>{words('helpDone')}</SettingsButton>
      </footer>
    </dialog>, document.body,
  );
}
