/**
 * Settings → General → Storage: where new projects go (studio/server's locations, src/locations.mjs). It shows its
 * folder and the free space on its disk, and can be changed (the system's folder dialog), opened in the file manager,
 * or set back to its default. Projects made before stay where they are. Exports have no setting: the export dialog
 * picks the folder and keeps the last one.
 */
import React from 'react';
import { useT } from '@/i18n';
import { api, type StudioLocation, type StudioLocations } from '@/api';
import { studioHost } from '@/lib/host';
import { SettingsButton, SettingsField, SettingsGroup, SettingsItem, settingsError } from './ui';

type Which = keyof StudioLocations;

/** Bytes as the person reads a disk's free space: GB, or MB below one. */
function size(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(bytes >= 1e11 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export function StorageGroup() {
  const t = useT();
  const [where, setWhere] = React.useState<StudioLocations | null>(null);
  const [busy, setBusy] = React.useState<Which | null>(null);
  const [error, setError] = React.useState<{ which: Which; text: string } | null>(null);
  /* where no folder dialog can open (a browser on another system), the path is typed */
  const [typing, setTyping] = React.useState<{ which: Which; text: string } | null>(null);
  const load = React.useCallback(() => { void api.locations().then(setWhere).catch(() => {}); }, []);
  React.useEffect(load, [load]);
  if (!where) return null;

  const keep = async (which: Which, folder: string | null) => {
    setBusy(which);
    setError(null);
    try {
      await api.setPrefs({ projectsFolder: folder });
      setTyping(null);
      load();
    } catch (e) {
      setError({ which, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const change = async (which: Which) => {
    const ask = { title: t(`settings.storage.${which}Pick`), button: t('settings.storage.pickButton'), at: where[which].path };
    try {
      const pick = studioHost?.folders?.pick;
      const picked = pick ? await pick(ask) : await api.pickFolder(ask.title, ask.at);
      if (picked) await keep(which, picked);
    } catch {
      setTyping({ which, text: where[which].path });
    }
  };

  const row = (which: Which, place: StudioLocation) => (
    <SettingsItem
      key={which}
      title={t(`settings.storage.${which}`)}
      description={(
        <>
          <span className="block">{t(`settings.storage.${which}Hint`)}</span>
          {typing?.which === which ? (
            <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (typing.text.trim()) void keep(which, typing.text.trim()); }}>
              <SettingsField autoFocus value={typing.text} onChange={(e) => setTyping({ which, text: e.target.value })} spellCheck={false}
                aria-label={t(`settings.storage.${which}`)} className="font-mono text-[13px]"
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTyping(null); } }} />
              <SettingsButton type="submit" variant="primary" disabled={busy === which || !typing.text.trim()}>{t('settings.storage.save')}</SettingsButton>
            </form>
          ) : (
            <span className="mt-1 block break-all font-mono text-[13px] text-[var(--text)]" title={place.path}>{place.path}</span>
          )}
          {place.free != null ? <span className="mt-0.5 block text-[13px]">{t('settings.storage.free').replace('{size}', size(place.free))}</span> : null}
          {error?.which === which ? <span className={`mt-1 block ${settingsError}`} role="alert">{error.text}</span> : null}
        </>
      )}
      control={(
        <>
          {place.chosen ? (
            <SettingsButton variant="quiet" disabled={busy === which} onClick={() => void keep(which, null)} title={place.default}>{t('settings.storage.reset')}</SettingsButton>
          ) : null}
          <SettingsButton variant="quiet" onClick={() => void api.openLocation(which).catch(() => {})}>{t('settings.storage.show')}</SettingsButton>
          <SettingsButton disabled={busy === which} onClick={() => void change(which)}>{t('settings.storage.change')}</SettingsButton>
        </>
      )}
    />
  );

  return (
    <SettingsGroup title={t('settings.storage.group')}>
      {row('projects', where.projects)}
    </SettingsGroup>
  );
}
