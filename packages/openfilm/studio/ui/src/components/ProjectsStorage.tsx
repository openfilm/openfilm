/**
 * Where the projects are kept, at the foot of the projects window's sidebar: the free space on its disk, and a click
 * away the storage card (settings/StorageGroup): the folder, open it, change it, what the projects take and clearing
 * their cache. Read again when the library moves.
 */
import React from 'react';
import { HardDrive } from 'lucide-react';
import { api, LIBRARY_EVENT, type StudioLocation } from '@/api';
import { useT } from '@/i18n';
import { Card } from './settings/ProvidersSection';
import { size, StorageGroup } from './settings/StorageGroup';

export function ProjectsStorage({ className }: { className: string }) {
  const t = useT();
  const [place, setPlace] = React.useState<StudioLocation | null>(null);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    const load = () => { void api.locations().then((l) => { if (live) setPlace(l.projects); }, () => {}); };
    load();
    window.addEventListener(LIBRARY_EVENT, load);
    return () => { live = false; window.removeEventListener(LIBRARY_EVENT, load); };
  }, []);
  /* closed: the space it may have freed or taken shows */
  const close = () => { setOpen(false); void api.locations().then((l) => setPlace(l.projects), () => {}); };
  return (
    <>
      <button type="button" className={className} title={place?.path} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <HardDrive size={15} />
        <span>{t('settings.storage.group')}</span>
        {place?.free != null ? <small>{t('projectBrowser.storageFree').replace('{size}', size(place.free))}</small> : null}
      </button>
      {open ? (
        <Card label={t('settings.storage.group')} onClose={close}>
          <StorageGroup />
        </Card>
      ) : null}
    </>
  );
}
