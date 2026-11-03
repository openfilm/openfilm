/**
 * The library's skills, in the drawer: what an agent takes up when making a film. The side bar picks the installed
 * ones (the person's own, OpenFilm's installed, this project's) or OpenFilm's still to install. Each is a tile of its
 * cover (its preview under the pointer, whose it is on its corner) and title, with what to do now over the cover: Try (a new
 * conversation with it named) once it is installed, Install before. A click on one opens its page in their place
 * (SkillPage), Back returns to them. Under the installed ones: the skills the person installed in an agent themselves
 * (Codex, Claude Code…), each off until let in.
 */
import React from 'react';
import { useT } from '@/i18n';
import { studioHost, type HostAgentId } from '@/lib/host';
import { seenSkills, sourcesApi, watchSkills, type SkillEntry } from '@/lib/project-sources';
import { byOrder, SkillCover, SkillPage, useSkillWords } from '../SkillPage';
import { SettingsSwitch } from '../settings/ui';
import { SourceBadge, SourceChips, sourcesIn, type Source } from './SourceChips';

/** An official one not installed is in the catalog only; the person's own and a project's are installed already. */
const installedOf = (skill: SkillEntry) => skill.installed !== false;

export type SkillsLine = 'installed' | 'discover';

/** One of an agent's own skills, and whether OpenFilm lets it in. */
type AgentSkill = { name: string; description: string; allowed: boolean };
type AgentGroup = { id: HostAgentId; name: string; skills: AgentSkill[] };

export function SkillsPane({ line, query, projectId, opened, onOpen }: {
  line: SkillsLine;
  query: string;
  projectId: string | null;
  /** the skill whose page is shown (its name), none: the tiles */
  opened: string | null;
  onOpen: (name: string | null) => void;
}) {
  const t = useT();
  const words = useSkillWords();
  const [skills, setSkills] = React.useState<SkillEntry[]>(() => seenSkills(projectId) ?? []);
  React.useEffect(() => {
    let live = true;
    void sourcesApi.skills(projectId).then((list) => { if (live) setSkills(list); }, () => {});
    const stop = watchSkills(projectId, (list) => { if (live) setSkills(list); });
    return () => { live = false; stop(); };
  }, [projectId]);

  const agents = useAgentSkills(line === 'installed');
  const q = query.trim().toLowerCase();
  const [source, setSource] = React.useState<Source | ''>('');
  const listed = skills
    .filter(line === 'installed' ? installedOf : (k) => k.source === 'official' && !installedOf(k))
    .filter((k) => !q || [words(k).title, words(k).summary, k.name].some((w) => w?.toLowerCase().includes(q)))
    .sort(byOrder);
  const sources = sourcesIn(listed.map(sourceOf));
  const shown = source && sources.includes(source) ? listed.filter((k) => sourceOf(k) === source) : listed;
  const install = (skill: SkillEntry) => {
    setSkills((list) => list.map((k) => (k.name === skill.name ? { ...k, installed: true } : k)));
    void sourcesApi.setSkillInstalled(skill.name, true).catch(() => { void sourcesApi.skills(projectId).then(setSkills); });
  };
  const tryIt = (skill: SkillEntry) => studioHost?.useSkill?.({ name: skill.name, description: skill.description, title: words(skill).title, newConversation: true });
  /* the corner says whose it is; under the title, only what the corner cannot: this project's, or off */
  const note = (skill: SkillEntry) => [skill.source === 'project' ? t('assetDrawer.skillProject') : '', skill.off ? t('assetDrawer.skillOff') : ''].filter(Boolean).join(' · ');

  const page = opened ? skills.find((k) => k.name === opened) : undefined;
  if (page) {
    return <SkillPage key={`${page.source}:${page.name}`} skill={page} setSkills={setSkills} projectId={projectId} onBack={() => onOpen(null)}
      {...(studioHost?.useSkill ? { onTry: tryIt } : {})} />;
  }
  const chips = <SourceChips sources={sources} value={source} onChange={setSource} />;
  const own = agents.groups
    .map((g) => ({ ...g, skills: g.skills.filter((k) => !q || [k.name, k.description].some((w) => w.toLowerCase().includes(q))) }))
    .filter((g) => g.skills.length);
  if (!shown.length && !own.length) {
    return <p className="px-4 pt-12 text-center text-[12.5px] leading-relaxed text-[var(--text-faint)]">{t(q ? 'assetDrawer.noSkillsFound' : line === 'installed' ? 'assetDrawer.noSkills' : 'assetDrawer.allSkillsInstalled')}</p>;
  }
  return (
    <>
    {shown.length ? chips : null}
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-0.5">
      {shown.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-x-2.5 gap-y-3">
          {shown.map((skill) => <SkillTile key={`${skill.source}:${skill.name}`} skill={skill} note={note(skill)} onOpen={() => onOpen(skill.name)}
            {...(installedOf(skill) ? (studioHost?.useSkill ? { onTry: () => tryIt(skill) } : {}) : { onInstall: () => install(skill) })} />)}
        </div>
      ) : null}
      {own.map((g) => (
        <section key={g.id} className={shown.length ? 'mt-5' : ''}>
          <h3 className="text-[12px] font-medium text-[var(--text)]">{t('gallery.fromAgent').replace('{name}', g.name)}</h3>
          <p className="mb-1 text-[11px] text-[var(--text-faint)]">{t('gallery.agentHint')}</p>
          {g.skills.map((k) => (
            <div key={k.name} className="flex items-center gap-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className={`truncate font-mono text-[12px] ${k.allowed ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{k.name}</div>
                {k.description ? <div className="truncate text-[11px] text-[var(--text-faint)]" title={k.description}>{k.description}</div> : null}
              </div>
              <SettingsSwitch checked={k.allowed} onChange={(on) => agents.allow(g.id, k.name, on)} label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} />
            </div>
          ))}
        </section>
      ))}
    </div>
    </>
  );
}

/** The skills each of the person's agents has of its own, for the agents that can be told which to leave out (read when `shown`). */
function useAgentSkills(shown: boolean) {
  const [groups, setGroups] = React.useState<AgentGroup[]>([]);
  const host = studioHost?.agents;
  const read = React.useCallback(async () => {
    if (!host?.skills) return;
    const agents = (await host.list().catch(() => [])).filter((a) => a.status === 'ready' && a.shown);
    const read = await Promise.all(agents.map(async (a) => {
      const own = await host.skills!(a.id).catch(() => null);
      return own?.filtered && own.skills.length ? { id: a.id, name: a.name, skills: own.skills } : null;
    }));
    setGroups(read.filter((g): g is AgentGroup => g != null));
  }, [host]);
  React.useEffect(() => { if (shown) void read(); }, [shown, read]);
  const allow = (id: HostAgentId, name: string, allowed: boolean) => {
    setGroups((list) => list.map((g) => (g.id === id ? { ...g, skills: g.skills.map((k) => (k.name === name ? { ...k, allowed } : k)) } : g)));
    void host?.allowSkill?.(id, name, allowed)?.catch(() => {}).finally(() => { void read(); });
  };
  return { groups: shown ? groups : [], allow };
}

/** A skill's source: OpenFilm's own, else the person's (their Skills folder, or this project's). */
const sourceOf = (skill: SkillEntry): Source => (skill.source === 'official' ? 'official' : 'mine');

/** One skill: its cover (its preview under the pointer), with Try or Install over it, and its title and source under it. */
function SkillTile({ skill, note, onOpen, onTry, onInstall }: { skill: SkillEntry; note: string; onOpen: () => void; onTry?: () => void; onInstall?: () => void }) {
  const t = useT();
  const { title } = useSkillWords()(skill);
  const [hover, setHover] = React.useState(false);
  const act = onInstall ? { label: t('assetDrawer.skillInstall'), run: onInstall } : onTry ? { label: t('assetDrawer.skillTry'), run: onTry } : null;
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group min-w-0 cursor-pointer select-none outline-none">
      <div className="relative aspect-video overflow-hidden rounded-md bg-[var(--surface-2)] ring-1 ring-transparent group-hover:ring-[var(--text-faint)] group-focus-visible:ring-[var(--tl-accent)]">
        <SkillCover key={skill.cover ?? ''} skill={skill} title={title} small playing={hover} />
        <SourceBadge source={sourceOf(skill)} />
        {act ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); act.run(); }}
            className="absolute bottom-1 right-1 hidden h-[22px] items-center rounded-full bg-[var(--tl-accent)] px-2.5 text-[11px] font-medium text-black shadow-md group-hover:flex">{act.label}</button>
        ) : null}
      </div>
      <div className="mt-1.5 truncate px-0.5 text-[11.5px] text-[var(--text-muted)] group-hover:text-[var(--text)]">{title}</div>
      {note ? <div className="truncate px-0.5 text-[10.5px] text-[var(--text-faint)]">{note}</div> : null}
    </div>
  );
}
