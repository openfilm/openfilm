/**
 * Storage in the resource center: at the foot of its sidebar, the free space on the projects' disk, a click away the
 * storage page in its right side (StoragePane: settings/StorageGroup), as the system's settings show a page beside
 * their list. Read again when the library moves.
 */
import React from 'react';
import { HardDrive, X } from 'lucide-react';
import { api, LIBRARY_EVENT, type StudioLocation } from '@/api';
import { useT } from '@/i18n';
import { size, StorageGroup } from './settings/StorageGroup';
import shared from './ProjectsView.module.css';

export function ProjectsStorage({ className, selected, onOpen }: { className: string; selected: boolean; onOpen: () => void }) {
  const t = useT();
  const [place, setPlace] = React.useState<StudioLocation | null>(null);
  React.useEffect(() => {
    let live = true;
    const load = () => { void api.locations().then((l) => { if (live) setPlace(l.projects); }, () => {}); };
    load();
    window.addEventListener(LIBRARY_EVENT, load);
    return () => { live = false; window.removeEventListener(LIBRARY_EVENT, load); };
  }, [selected]);
  return (
    <button type="button" className={className} title={place?.path} aria-current={selected ? 'page' : undefined} data-active={selected} onClick={onOpen}>
      <HardDrive size={15} />
      <span>{t('settings.storage.group')}</span>
      {place?.free != null ? <small>{t('projectBrowser.storageFree').replace('{size}', size(place.free))}</small> : null}
    </button>
  );
}

/** The storage page, in the resource center's right side. */
export function StoragePane({ onClose }: { onClose?: () => void }) {
  const t = useT();
  return (
    <div data-storage-pane="" className="flex min-h-0 flex-1 flex-col">
      <div className={shared.toolbar}>
        <h2 className="m-0 text-[19px] font-semibold tracking-[-0.035em] text-[var(--text)]">{t('settings.storage.group')}</h2>
        {onClose ? <button type="button" className={shared.iconButton} style={{ marginLeft: 'auto' }} aria-label={t('project.close')} onClick={onClose}><X size={17} /></button> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-8 pb-10 pt-6">
          <StorageGroup titled={false} />
        </div>
      </div>
    </div>
  );
}
