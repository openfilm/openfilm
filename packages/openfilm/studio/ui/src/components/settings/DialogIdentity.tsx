import React from 'react';
import { ExternalLink, X } from 'lucide-react';

/** The same identity header for a service card and an agent's information or connection help. */
export function DialogIdentity({ mark, name, titleId, website, actions, status }: {
  mark: React.ReactNode;
  name: string;
  titleId?: string;
  website?: { href: string; label: string };
  actions?: React.ReactNode;
  status?: React.ReactNode;
}) {
  return (
    <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 pr-8">
      <span className="row-span-2 flex h-12 w-12 items-center justify-center rounded-[12px] bg-[var(--bg-field)] text-[var(--text)]">{mark}</span>
      <div className="min-w-0">
        <h2 id={titleId} className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{name}</h2>
        {website ? (
          <a href={website.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[13.5px] text-[var(--text-faint)] transition hover:text-[var(--text)]">
            {website.label}<ExternalLink size={11} />
          </a>
        ) : null}
      </div>
      <div className="flex items-center gap-1 pt-1">{actions}</div>
      {status ? <div className="col-span-2 col-start-2 mt-1 flex min-w-0 text-[13.5px]">{status}</div> : null}
    </header>
  );
}

export function DialogClose({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} aria-label={label}
      className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
      <X size={16} />
    </button>
  );
}
