import React from 'react';
import { Clapperboard, Scissors, Workflow } from 'lucide-react';
import { useT } from '@/i18n';
import { setPluginOn, usePlugins, type Plugin } from '@/lib/plugins';
import { forgetSeenSkills } from '@/lib/project-sources';
import { SettingsGroup, SettingsItem, SettingsPage, SettingsSwitch, settingsError } from './ui';

const MARK: Record<string, React.ReactNode> = {
  edit: <Scissors size={18} strokeWidth={1.75} />,
  canvas: <Workflow size={18} strokeWidth={1.75} />,
  motion: <Clapperboard size={18} strokeWidth={1.75} />,
};

/**
 * OpenFilm's plugins (lib/plugins; src/plugins.mjs), each turned on or off: a plugin's workbench is shown, and the
 * skills that go with it are given to agents, only while it is on. The last workbench on stays on. A film made with a
 * plugin plays and exports the same with it off.
 */
export function PluginsSection() {
  const t = useT();
  const plugins = usePlugins();
  const [error, setError] = React.useState<string | null>(null);
  const turn = (plugin: Plugin, on: boolean) => {
    setError(null);
    void setPluginOn(plugin.id, on).then(forgetSeenSkills).catch((e: unknown) => setError(e instanceof Error && e.message !== 'failed' ? e.message : t('settings.plugins.failed')));
  };
  return (
    <SettingsPage note={t('settings.plugins.intro')}>
      <SettingsGroup footnote={t('settings.plugins.footnote')}>
        {plugins.map((p) => {
          const name = t(`settings.plugins.names.${p.id}`);
          const skills = p.skills.length ? t('settings.plugins.withSkills').replace('{skills}', p.skills.map((s) => t(`settings.plugins.skills.${s}`)).join(t('settings.plugins.sep'))) : null;
          return (
            <SettingsItem key={p.id} mark={MARK[p.id]} title={name}
              badge={p.beta ? <span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">{t('settings.plugins.beta')}</span> : undefined}
              description={<>{t(`settings.plugins.notes.${p.id}`)}{skills ? <span className="block text-[var(--text-faint)]">{skills}</span> : null}</>}
              control={<SettingsSwitch checked={p.on} disabled={p.on && p.last} onChange={(on) => turn(p, on)}
                label={t(p.on ? 'settings.plugins.turnOff' : 'settings.plugins.turnOn').replace('{name}', name)} />} />
          );
        })}
      </SettingsGroup>
      {error ? <p role="alert" className={settingsError}>{error}</p> : null}
    </SettingsPage>
  );
}
