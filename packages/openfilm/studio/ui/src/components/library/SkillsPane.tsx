/**
 * The library's skills, in the drawer: what an agent takes up when making a film. The side bar picks the installed
 * ones (all of them, the person's own, OpenFilm's, the agents' own) or OpenFilm's still to install (Discover).
 *
 * Installed, each skill is a line: its mark (its cover, else its icon), its title, under it its uid, owner/name
 * (`openfilm/keynote`, `river/keynote`: two of a name are told apart by it), and its switch: on, agents take it up when it fits; off, no agent gets it. A click opens its page (SkillPage). The lines
 * are in parts by whose they are, each headed with its count where more than one part is shown: OpenFilm's system
 * skills (how a film is made, its media, its canvas, in the order agents are given them), the community's installed,
 * the person's own (theirs, and this project's), then each agent's own (off until let in). Import is beside the search
 * (LibraryDrawer). Discover is a gallery of tiles to browse: cover, title, uid, Install.
 */
import React from 'react';
import { Plus } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost, type HostAgentId } from '@/lib/host';
import { seenSkills, sourcesApi, watchSkills, type SkillEntry } from '@/lib/project-sources';
import { byOrder, SkillCover, SkillMark, SkillPage, useSkillWords } from '../SkillPage';
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
  /** the skill whose page is shown (its name), none: the list */
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
    .filter((k) => !q || [words(k).title, words(k).summary, k.name, k.uid].some((w) => w?.toLowerCase().includes(q)))
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
    setSkills((list) => list.map((k) => (k.uid === skill.uid ? { ...k, installed: true } : k)));
    void sourcesApi.setSkillInstalled(skill.uid, true).catch(() => { void sourcesApi.skills(projectId).then(setSkills); });
  };
  const turn = (skill: SkillEntry, on: boolean) => {
    setSkills((list) => list.map((k) => (k.uid === skill.uid ? (on ? { ...k, off: undefined } : { ...k, off: true as const }) : k)));
    void sourcesApi.setSkillOn(skill.uid, on).catch(() => { void sourcesApi.skills(projectId).then(setSkills); });
  };
  /* named in the message as agents know it (`as`: another of its name is beside it) */
  const tryIt = (skill: SkillEntry) => studioHost?.useSkill?.({ name: skill.as ?? skill.name, description: skill.description, title: words(skill).title, newConversation: true });
  /* a page asked for by uid, or by the name agents know it by (the chat's) */
  const page = opened ? skills.find((k) => k.uid === opened) ?? skills.find((k) => (k.as ?? k.name) === opened) : undefined;
  if (page) {
    return <SkillPage key={page.uid} skill={page} setSkills={setSkills} projectId={projectId} onBack={() => onOpen(null)}
      {...(studioHost?.useSkill ? { onTry: tryIt } : {})} />;
  }
  if (line === 'discover') {
    return toInstall.length ? (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-0.5">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-2.5 gap-y-3.5">
          {toInstall.map((skill) => <SkillTile key={skill.uid} skill={skill} onOpen={() => onOpen(skill.uid)} onInstall={() => install(skill)} />)}
        </div>
      </div>
    ) : <Empty text={t(q ? 'assetDrawer.noSkillsFound' : 'assetDrawer.allSkillsInstalled')} />;
  }
  const lineOf = (skill: SkillEntry) => (
    <SkillLine key={skill.uid} mark={<SkillMark skill={skill} />} title={words(skill).title} under={skill.uid} mono
      tip={words(skill).summary} on={!skill.off} onOpen={() => onOpen(skill.uid)}
      label={t(skill.off ? 'gallery.turnOn' : 'gallery.turnOff').replace('{name}', words(skill).title)} onChange={(on) => turn(skill, on)} />
  );
  const parts: Array<{ key: string; title: string; lines: React.ReactNode[]; empty?: string }> = [
    { key: 'system', title: t('assetDrawer.skillsSystem'), lines: system.map(lineOf) },
    { key: 'community', title: t('assetDrawer.skillsCommunity'), lines: community.map(lineOf), ...(line === 'openfilm' && !q ? { empty: t('assetDrawer.noCommunitySkills') } : {}) },
    { key: 'mine', title: t('assetDrawer.skillsMine'), lines: mine.map(lineOf), ...(line === 'mine' && !q ? { empty: t('assetDrawer.noMineSkills') } : {}) },
    ...own.map((g) => ({
      key: g.id, title: g.name,
      lines: g.skills.map((k) => <SkillLine key={k.name} mark={<SkillMark skill={{}} />} title={k.name} under={k.description} tip={k.description} on={k.allowed}
        label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} onChange={(on) => agents.allow(g.id, k.name, on)} />),
    })),
  ].filter((p) => p.lines.length || p.empty);
  if (!parts.length) {
    return <Empty text={t(q ? 'assetDrawer.noSkillsFound' : line === 'agents' ? 'assetDrawer.noAgentSkills' : 'assetDrawer.noSkills')} />;
  }
  /* one part alone needs no heading: the side bar says what it is */
  const headed = parts.length > 1 || line === 'all';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-3 pt-0.5">
      {parts.map((p) => (
        <section key={p.key}>
          {headed ? (
            <h3 className="mb-1 flex items-baseline gap-1.5 px-1 text-[11.5px] font-medium text-[var(--text-muted)]">
              {p.title}<span className="tabular-nums text-[var(--text-faint)]">{p.lines.length}</span>
            </h3>
          ) : null}
          {p.lines}
          {!p.lines.length && p.empty ? <p className="px-1 py-2 text-[12px] text-[var(--text-faint)]">{p.empty}</p> : null}
        </section>
      ))}
    </div>
  );
}

/** Nothing to list: a word in the middle. */
function Empty({ text }: { text: string }) {
  return <p className="px-4 pt-12 text-center text-[12.5px] leading-relaxed text-[var(--text-faint)]">{text}</p>;
}

/** An installed skill: its mark, its title and what is under it, its switch; a click opens its page (an agent's own has none). */
function SkillLine({ mark, title, under, mono = false, tip, on, label, onChange, onOpen }: {
  mark: React.ReactNode; title: string; under: string; mono?: boolean; tip?: string; on: boolean; label: string;
  onChange: (on: boolean) => void; onOpen?: () => void;
}) {
  return (
    <div role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} title={tip}
      onClick={onOpen} onKeyDown={(e) => { if (onOpen && e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}
      className={`flex items-center gap-2.5 rounded-[8px] px-1 py-1.5 outline-none ${onOpen ? 'cursor-pointer hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--tl-accent)]' : ''}`}>
      <span className={on ? '' : 'opacity-50'}>{mark}</span>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[12.5px] font-medium leading-[17px] ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{title}</div>
        <div className={`truncate text-[11px] leading-[15px] text-[var(--text-faint)] ${mono ? 'font-mono' : ''}`}>{under}</div>
      </div>
      {/* the switch is its own: a press there does not open the page */}
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><SettingsSwitch checked={on} onChange={onChange} label={label} /></span>
    </div>
  );
}

/** Adding one of the person's own (the app's dialog: a link or a folder). */
export function ImportButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick}
      className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-[var(--surface-2)] px-2.5 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]">
      <Plus size={14} />{t('assetDrawer.skillImport')}
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

/** One skill to install, in Discover: its cover (its preview under the pointer) with Install over it, its title and uid under it. */
function SkillTile({ skill, onOpen, onInstall }: { skill: SkillEntry; onOpen: () => void; onInstall: () => void }) {
  const t = useT();
  const { title } = useSkillWords()(skill);
  const [hover, setHover] = React.useState(false);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group min-w-0 cursor-pointer select-none outline-none">
      <div className="relative aspect-video overflow-hidden rounded-md bg-[var(--surface-2)] ring-1 ring-transparent group-hover:ring-[var(--text-faint)] group-focus-visible:ring-[var(--tl-accent)]">
        <SkillCover key={skill.cover ?? ''} skill={skill} title={title} small playing={hover} />
        <button type="button" onClick={(e) => { e.stopPropagation(); onInstall(); }}
          className="absolute bottom-1 right-1 hidden h-[22px] items-center rounded-full bg-[var(--tl-accent)] px-2.5 text-[11px] font-medium text-black shadow-md group-hover:flex">{t('assetDrawer.skillInstall')}</button>
      </div>
      <div className="mt-1.5 truncate px-0.5 text-[12px] font-medium text-[var(--text-muted)] group-hover:text-[var(--text)]">{title}</div>
      <div className="truncate px-0.5 font-mono text-[10.5px] text-[var(--text-faint)]">{skill.uid}</div>
    </div>
  );
}
