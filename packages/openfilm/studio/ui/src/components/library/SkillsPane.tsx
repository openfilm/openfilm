/**
 * The library's skills, in the drawer: what an agent takes up when making a film. The side bar picks the installed
 * ones (all of them, the person's own, OpenFilm's, the agents' own) or OpenFilm's still to install. OpenFilm's are its
 * system skills (how a film is made, its media, its canvas: each a line with its switch, as the agents are given them)
 * and the community's installed; the person's own (theirs, and this project's) come with Import first, where the app
 * can add one. Each installed or to install is a tile of its cover (its preview under the pointer) and title, with what
 * to do now over the cover: Try (a new conversation with it named) once it is installed, Install before. A click on
 * one opens its page in their place (SkillPage), Back returns to them. Last: the skills the person installed in an
 * agent themselves (Codex, Claude Code…), each off until let in.
 */
import React from 'react';
import { Plus } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost, type HostAgentId } from '@/lib/host';
import { seenSkills, sourcesApi, watchSkills, type SkillEntry } from '@/lib/project-sources';
import { byOrder, SkillCover, SkillPage, useSkillWords } from '../SkillPage';
import { SettingsSwitch } from '../settings/ui';

/** An official one not installed is in the catalog only; the person's own and a project's are installed already. */
const installedOf = (skill: SkillEntry) => skill.installed !== false;

export type SkillsLine = 'all' | 'mine' | 'openfilm' | 'agents' | 'discover';

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

  const shows = (what: 'mine' | 'openfilm' | 'agents') => line === 'all' || line === what;
  const agents = useAgentSkills(shows('agents'));
  const q = query.trim().toLowerCase();
  const found = skills
    .filter((k) => !q || [words(k).title, words(k).summary, k.name].some((w) => w?.toLowerCase().includes(q)))
    .sort(byOrder);
  /* OpenFilm's own in the order agents are given them, as the API lists them */
  const system = shows('openfilm') ? skills.filter((k) => k.core && found.includes(k)) : [];
  const community = shows('openfilm') ? found.filter((k) => !k.core && k.source === 'official' && installedOf(k)) : [];
  const mine = shows('mine') ? found.filter((k) => k.source !== 'official') : [];
  const toInstall = line === 'discover' ? found.filter((k) => k.source === 'official' && !installedOf(k)) : [];
  const own = agents.groups
    .map((g) => ({ ...g, skills: g.skills.filter((k) => !q || [k.name, k.description].some((w) => w.toLowerCase().includes(q))) }))
    .filter((g) => g.skills.length);
  const install = (skill: SkillEntry) => {
    setSkills((list) => list.map((k) => (k.name === skill.name ? { ...k, installed: true } : k)));
    void sourcesApi.setSkillInstalled(skill.name, true).catch(() => { void sourcesApi.skills(projectId).then(setSkills); });
  };
  const turn = (skill: SkillEntry, on: boolean) => {
    setSkills((list) => list.map((k) => (k.name === skill.name ? (on ? { ...k, off: undefined } : { ...k, off: true as const }) : k)));
    void sourcesApi.setSkillOn(skill.name, on).catch(() => { void sourcesApi.skills(projectId).then(setSkills); });
  };
  const tryIt = (skill: SkillEntry) => studioHost?.useSkill?.({ name: skill.name, description: skill.description, title: words(skill).title, newConversation: true });
  /* adding one of the person's own: the app's dialog (a link or a folder); the web editor has none */
  const importSkill = studioHost?.skills?.add;
  /* under the title, what the section cannot say: this project's, or off */
  const note = (skill: SkillEntry) => [skill.source === 'project' ? t('assetDrawer.skillProject') : '', skill.off ? t('assetDrawer.skillOff') : ''].filter(Boolean).join(' · ');

  const page = opened ? skills.find((k) => k.name === opened && !k.core) : undefined;
  if (page) {
    return <SkillPage key={`${page.source}:${page.name}`} skill={page} setSkills={setSkills} projectId={projectId} onBack={() => onOpen(null)}
      {...(studioHost?.useSkill ? { onTry: tryIt } : {})} />;
  }
  const tiles = (list: SkillEntry[], first?: React.ReactNode) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-x-2.5 gap-y-3">
      {first}
      {list.map((skill) => <SkillTile key={`${skill.source}:${skill.name}`} skill={skill} note={note(skill)} onOpen={() => onOpen(skill.name)}
        {...(installedOf(skill) ? (studioHost?.useSkill ? { onTry: () => tryIt(skill) } : {}) : { onInstall: () => install(skill) })} />)}
    </div>
  );
  /* Import stays in sight on the person's own, even with none yet */
  const importTile = importSkill && shows('mine') && !q ? <ImportTile onClick={importSkill} /> : null;
  const sections = [
    system.length ? (
      <Section key="system" title={t('assetDrawer.skillsSystem')} hint={t('assetDrawer.skillsSystemHint')}>
        {system.map((k) => <SkillLine key={k.name} title={words(k).title} summary={words(k).summary} on={!k.off}
          label={t(k.off ? 'gallery.turnOn' : 'gallery.turnOff').replace('{name}', words(k).title)} onChange={(on) => turn(k, on)} />)}
      </Section>
    ) : null,
    community.length ? <Section key="community" title={t('assetDrawer.skillsCommunity')}>{tiles(community)}</Section> : null,
    mine.length || importTile ? (
      <Section key="mine" title={line === 'all' ? t('assetDrawer.skillsMine') : undefined}>{tiles(mine, importTile)}</Section>
    ) : null,
    ...own.map((g) => (
      <Section key={g.id} title={t('gallery.fromAgent').replace('{name}', g.name)} hint={t('gallery.agentHint')}>
        {g.skills.map((k) => <SkillLine key={k.name} title={k.name} mono summary={k.description} on={k.allowed}
          label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} onChange={(on) => agents.allow(g.id, k.name, on)} />)}
      </Section>
    )),
    toInstall.length ? <Section key="discover">{tiles(toInstall)}</Section> : null,
  ].filter(Boolean);
  const empty = q ? 'assetDrawer.noSkillsFound' : line === 'discover' ? 'assetDrawer.allSkillsInstalled' : line === 'mine' ? 'assetDrawer.noMineSkills'
    : line === 'agents' ? 'assetDrawer.noAgentSkills' : 'assetDrawer.noSkills';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3 pt-0.5">
      {sections}
      {/* the person's own with only Import: a word under it */}
      {!sections.length || (line === 'mine' && !mine.length) || (line === 'openfilm' && !community.length && !q) ? (
        <p className={`text-center text-[12.5px] leading-relaxed text-[var(--text-faint)] ${sections.length ? '' : 'px-1 pt-12'}`}>
          {t(line === 'openfilm' && sections.length ? 'assetDrawer.noCommunitySkills' : empty)}
        </p>
      ) : null}
    </div>
  );
}

/** A part of the skills: its heading and what it is, when it needs saying. */
function Section({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      {title ? <h3 className="text-[12px] font-medium text-[var(--text)]">{title}</h3> : null}
      {hint ? <p className="text-[11px] text-[var(--text-faint)]">{hint}</p> : null}
      <div className={title || hint ? 'mt-2' : ''}>{children}</div>
    </section>
  );
}

/** A skill as a line with its switch: one of OpenFilm's system skills, or an agent's own. */
function SkillLine({ title, summary, mono = false, on, label, onChange }: {
  title: string; summary: string; mono?: boolean; on: boolean; label: string; onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[12px] ${mono ? 'font-mono' : 'font-medium'} ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{title}</div>
        {summary ? <div className="truncate text-[11px] text-[var(--text-faint)]" title={summary}>{summary}</div> : null}
      </div>
      <SettingsSwitch checked={on} onChange={onChange} label={label} />
    </div>
  );
}

/** The first of the person's own: a skill added from a link or a folder (the app's dialog). */
function ImportTile({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="group min-w-0 select-none text-left outline-none">
      <div className="flex aspect-video flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--border-strong)] text-[var(--text-muted)] group-hover:border-[var(--text-muted)] group-hover:text-[var(--text)] group-focus-visible:border-[var(--tl-accent)]">
        <Plus size={18} />
      </div>
      <div className="mt-1.5 truncate px-0.5 text-[11.5px] text-[var(--text-muted)] group-hover:text-[var(--text)]">{t('assetDrawer.skillImport')}</div>
    </button>
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

/** One skill: its cover (its preview under the pointer), with Try or Install over it, and its title under it. */
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
