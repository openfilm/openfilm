/**
 * The library's skills, in the drawer: what an agent takes up when making a film. The side bar picks the installed
 * ones (the person's own, OpenFilm's installed, this project's) or OpenFilm's still to install. Each is a tile of its
 * cover (its preview under the pointer, whose it is on its corner) and title, with what to do now over the cover: Try (a new
 * conversation with it named) once it is installed, Install before. One opens its page (SkillsLibrary keeps the whole
 * of it), on its own.
 */
import React from 'react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { seenSkills, sourcesApi, watchSkills, type SkillEntry } from '@/lib/project-sources';
import { byOrder, SkillCover, useSkillWords } from '../SkillsLibrary';
import { SourceBadge, SourceChips, sourcesIn, type Source } from './SourceChips';

/** An official one not installed is in the catalog only; the person's own and a project's are installed already. */
const installedOf = (skill: SkillEntry) => skill.installed !== false;

export type SkillsLine = 'installed' | 'discover';

export function SkillsPane({ line, query, projectId, onOpen }: {
  line: SkillsLine;
  query: string;
  projectId: string | null;
  /** its page in the Community */
  onOpen: (name: string) => void;
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

  const chips = <SourceChips sources={sources} value={source} onChange={setSource} />;
  if (!shown.length) {
    return <p className="px-4 pt-12 text-center text-[12.5px] leading-relaxed text-[var(--text-faint)]">{t(q ? 'assetDrawer.noSkillsFound' : line === 'installed' ? 'assetDrawer.noSkills' : 'assetDrawer.allSkillsInstalled')}</p>;
  }
  return (
    <>
    {chips}
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-0.5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-x-2.5 gap-y-3">
        {shown.map((skill) => <SkillTile key={`${skill.source}:${skill.name}`} skill={skill} note={note(skill)} onOpen={() => onOpen(skill.name)}
          {...(installedOf(skill) ? (studioHost?.useSkill ? { onTry: () => tryIt(skill) } : {}) : { onInstall: () => install(skill) })} />)}
      </div>
    </div>
    </>
  );
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
