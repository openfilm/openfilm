/**
 * The library's plugins, in the drawer: what OpenFilm is made of (lib/plugins; src/plugins.mjs). A plugin is one thing
 * OpenFilm can do, for the agent and for the person alike, under one switch: on, its workbench (or its part of the
 * library) is shown and agents are given the skills that go with it; off, neither, and a film made with it plays and
 * exports the same. What is not made yet is listed after them so the whole is in sight, with no switch.
 *
 * Each plugin is a line: its mark, its title, what it is for under it, and its switch. A click opens its page: the
 * same, said in full, and the skills it teaches an agent, each opening its own page (SkillPage). OpenFilm's own
 * skills are found here, with the plugin they go with, not among the library's Skills.
 */
import React from 'react';
import { ArrowLeft, AudioLines, Clapperboard, Film, FolderOpen, Layers, Palette, Puzzle, Scissors, Workflow, type LucideIcon } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { setPluginOn, usePlugins, type Plugin } from '@/lib/plugins';
import { forgetSeenSkills, seenSkills, sourcesApi, watchSkills, type SkillEntry } from '@/lib/project-sources';
import { inLanguage, SkillMark, SkillPage, useSkillWords } from '../SkillPage';
import { SettingsSwitch } from '../settings/ui';

export const PLUGIN_ICONS: Record<string, LucideIcon> = {
  film: Film, folder: FolderOpen, scissors: Scissors, workflow: Workflow, clapperboard: Clapperboard, audio: AudioLines, palette: Palette, layers: Layers,
};
/** each mark its own color, as the skills' are */
const HUES: Record<string, number> = { film: 28, folder: 212, scissors: 18, workflow: 188, clapperboard: 262, audio: 286, palette: 328, layers: 42 };

/** A plugin as people see it: its title and summary in the language shown, else its id. */
export function usePluginWords() {
  const lang = useLanguage();
  return (plugin: Pick<Plugin, 'id' | 'title' | 'summary'>) => ({ title: inLanguage(plugin.title, lang) ?? plugin.id, summary: inLanguage(plugin.summary, lang) ?? '' });
}

function PluginMark({ plugin, big = false }: { plugin: Plugin; big?: boolean }) {
  const Mark = PLUGIN_ICONS[plugin.icon ?? ''] ?? Puzzle;
  const hue = HUES[plugin.icon ?? ''] ?? 220;
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center ${big ? 'h-12 w-12 rounded-[11px]' : 'h-8 w-8 rounded-[7px]'}`}
      style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `hsl(${hue} 80% 72%)`, boxShadow: `inset 0 0 0 1px hsl(${hue} 70% 60% / 0.28)` }}>
      <Mark size={big ? 22 : 15} strokeWidth={1.7} />
    </span>
  );
}

const Beta = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-[var(--text-muted)]">{children}</span>
);

export function PluginsPane({ projectId }: { projectId: string | null }) {
  const t = useT();
  const words = usePluginWords();
  const skillWords = useSkillWords();
  const plugins = usePlugins();
  const [opened, setOpened] = React.useState<string | null>(null);
  const [skillOpen, setSkillOpen] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /* OpenFilm's own skills, for the ones a plugin teaches */
  const [skills, setSkills] = React.useState<SkillEntry[]>(() => seenSkills(projectId) ?? []);
  React.useEffect(() => {
    let live = true;
    void sourcesApi.skills(projectId).then((list) => { if (live) setSkills(list); }, () => {});
    const stop = watchSkills(projectId, (list) => { if (live) setSkills(list); });
    return () => { live = false; stop(); };
  }, [projectId]);

  const turn = (plugin: Plugin, on: boolean) => {
    setError(null);
    /* its skills go on and off with it: what was last seen of them is let go, and they are read again */
    void setPluginOn(plugin.id, on).then(() => { forgetSeenSkills(); return sourcesApi.skills(projectId).then(setSkills); })
      .catch((e: unknown) => setError(e instanceof Error && e.message !== 'failed' ? e.message : t('assetDrawer.pluginFailed')));
  };
  const switchOf = (plugin: Plugin) => {
    if (plugin.soon) return null;
    const name = words(plugin).title;
    return <SettingsSwitch checked={plugin.on} onChange={(on) => turn(plugin, on)}
      label={t(plugin.on ? 'assetDrawer.pluginTurnOff' : 'assetDrawer.pluginTurnOn').replace('{name}', name)} />;
  };

  const page = opened ? plugins.find((p) => p.id === opened) : undefined;
  const skill = page && skillOpen ? skills.find((k) => k.uid === skillOpen) : undefined;
  if (page && skill) return <SkillPage key={skill.uid} skill={skill} setSkills={setSkills} projectId={projectId} onBack={() => setSkillOpen(null)} />;
  if (page) {
    const { title, summary } = words(page);
    const taught = page.skills.map((name) => skills.find((k) => k.core && k.name === name)).filter((k): k is SkillEntry => k != null);
    return (
      <>
        <div className="flex shrink-0 px-3 pb-2 pt-2.5">
          <button type="button" onClick={() => { setOpened(null); setError(null); }} className="-ml-1 flex h-8 items-center gap-1.5 rounded-md pl-1.5 pr-2.5 text-[12.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            <ArrowLeft size={14} />{t('gallery.back')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(var(--drawer-under,0px)+16px)] pt-0.5">
          <div className="flex items-center gap-3">
            <PluginMark plugin={page} big />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <h2 className="min-w-0 truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{title}</h2>
              {page.beta ? <Beta>{t('assetDrawer.pluginBeta')}</Beta> : null}
            </div>
            {switchOf(page)}
          </div>
          <p className="mt-3 text-[12.5px] leading-[19px] text-[var(--text)]">{summary}</p>
          <p className="mt-2 text-[12px] leading-[18px] text-[var(--text-muted)]">
            {t(page.soon ? 'assetDrawer.pluginSoonNote' : 'assetDrawer.pluginOffNote')}
          </p>
          {error ? <p role="alert" className="mt-2 text-[12px] text-[var(--warn)]">{error}</p> : null}
          {taught.length ? (
            <section className="mt-5">
              <h3 className="mb-1 px-1 text-[11.5px] font-medium text-[var(--text-muted)]">{t('assetDrawer.pluginSkills')}</h3>
              {taught.map((k) => (
                <div key={k.uid} role="button" tabIndex={0} onClick={() => setSkillOpen(k.uid)} onKeyDown={(e) => { if (e.key === 'Enter') setSkillOpen(k.uid); }}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-1 py-1.5 outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]">
                  <span className={k.off ? 'opacity-50' : ''}><SkillMark skill={k} /></span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[12.5px] font-medium leading-[17px] ${k.off ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{skillWords(k).title}</div>
                    <div className="truncate text-[11px] leading-[15px] text-[var(--text-faint)]">{skillWords(k).summary}</div>
                  </div>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </>
    );
  }

  /* the ones there are to turn, then the ones still to come under their own head */
  const parts = [
    { key: 'made', title: null, list: plugins.filter((p) => !p.soon) },
    { key: 'soon', title: t('assetDrawer.pluginsSoon'), list: plugins.filter((p) => p.soon) },
  ].filter((p) => p.list.length);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-[calc(var(--drawer-under,0px)+12px)] pt-3">
      {error ? <p role="alert" className="px-1 text-[12px] text-[var(--warn)]">{error}</p> : null}
      {parts.map((part) => (
        <section key={part.key}>
          {part.title ? (
            <h3 className="mb-1 flex items-center gap-1.5 px-1 py-0.5 text-[11.5px] font-medium text-[var(--text-muted)]">
              {part.title}<span className="tabular-nums text-[var(--text-faint)]">{part.list.length}</span>
            </h3>
          ) : null}
          {part.list.map((p) => {
            const { title, summary } = words(p);
            const dim = !p.on;
            return (
              <div key={p.id} role="button" tabIndex={0} title={summary} onClick={() => { setError(null); setOpened(p.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpened(p.id); }}
                className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-1 py-1.5 outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]">
                <span className={dim ? 'opacity-50' : ''}><PluginMark plugin={p} /></span>
                <div className="min-w-0 flex-1">
                  <div className={`flex items-center gap-1.5 text-[12.5px] font-medium leading-[17px] ${dim ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>
                    <span className="truncate">{title}</span>{p.beta ? <Beta>{t('assetDrawer.pluginBeta')}</Beta> : null}
                  </div>
                  <div className="truncate text-[11px] leading-[15px] text-[var(--text-faint)]">{summary}</div>
                </div>
                {/* the switch is its own: a press there does not open the page */}
                <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{switchOf(p)}</span>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
