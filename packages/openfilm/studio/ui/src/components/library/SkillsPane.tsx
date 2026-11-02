/**
 * The library's skills, in the drawer: what an agent takes up when making a film. The side bar picks the installed
 * ones (the person's own, OpenFilm's installed, this project's) or OpenFilm's still to install. Each is a row of its
 * title, what it is for and where it comes from, with what to do now: Try (a new conversation with it named) once it
 * is installed, Install before. A row opens its page in the Community (SkillsLibrary keeps the whole of it).
 */
import React from 'react';
import { Check, Sparkles } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { seenSkills, sourcesApi, watchSkills, type SkillEntry } from '@/lib/project-sources';
import { byOrder, useSkillWords } from '../SkillsLibrary';

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
  const shown = skills
    .filter(line === 'installed' ? installedOf : (k) => k.source === 'official' && !installedOf(k))
    .filter((k) => !q || [words(k).title, words(k).summary, k.name].some((w) => w?.toLowerCase().includes(q)))
    .sort(byOrder);
  const install = (skill: SkillEntry) => {
    setSkills((list) => list.map((k) => (k.name === skill.name ? { ...k, installed: true } : k)));
    void sourcesApi.setSkillInstalled(skill.name, true).catch(() => { void sourcesApi.skills(projectId).then(setSkills); });
  };
  const tryIt = (skill: SkillEntry) => studioHost?.useSkill?.({ name: skill.name, description: skill.description, title: words(skill).title, newConversation: true });
  const from = (skill: SkillEntry) => t(skill.source === 'official' ? 'assetDrawer.skillOfficial' : skill.source === 'mine' ? 'assetDrawer.skillMine' : 'assetDrawer.skillProject');

  if (!shown.length) {
    return <p className="px-4 pt-12 text-center text-[12.5px] leading-relaxed text-[var(--text-faint)]">{t(q ? 'assetDrawer.noSkillsFound' : line === 'installed' ? 'assetDrawer.noSkills' : 'assetDrawer.allSkillsInstalled')}</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3 pt-0.5">
      {shown.map((skill) => {
        const { title, summary } = words(skill);
        const installed = installedOf(skill);
        return (
          <div key={`${skill.source}:${skill.name}`} role="button" tabIndex={0} onClick={() => onOpen(skill.name)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(skill.name); }}
            className="flex cursor-pointer flex-col gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] p-2.5 outline-none transition hover:border-[var(--border-strong)] focus-visible:border-[var(--tl-accent)]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[var(--surface-3)] text-[var(--text-muted)]"><Sparkles size={13} /></span>
              <span className="min-w-0 truncate text-[12.5px] font-semibold text-[var(--text)]">{title}</span>
            </span>
            {summary ? <span className="line-clamp-2 text-[11.5px] leading-[16px] text-[var(--text-muted)]">{summary}</span> : null}
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[10.5px] text-[var(--text-faint)]">{from(skill)}{skill.off ? ` · ${t('assetDrawer.skillOff')}` : ''}</span>
              {installed ? (
                studioHost?.useSkill ? (
                  <button type="button" onClick={(e) => { e.stopPropagation(); tryIt(skill); }}
                    className="h-6 shrink-0 rounded-[6px] border border-[var(--border-strong)] px-2 text-[11px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]">{t('assetDrawer.skillTry')}</button>
                ) : <span className="flex h-6 shrink-0 items-center gap-1 text-[11px] text-[var(--tl-accent)]"><Check size={12} />{t('assetDrawer.skillInstalled')}</span>
              ) : (
                <button type="button" onClick={(e) => { e.stopPropagation(); install(skill); }}
                  className="h-6 shrink-0 rounded-[6px] bg-[var(--text)] px-2 text-[11px] font-medium text-[var(--bg)] transition hover:opacity-90">{t('assetDrawer.skillInstall')}</button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
