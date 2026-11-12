/**
 * The plugins a project has: OpenFilm's own (lib/plugins), then the ones someone made, which are skills with a surface
 * (a web page at their folder's root; openfilm/src/skills.mjs SKILL_PAGE): the person's own, this project's, and those
 * installed. One of those is a plugin like any other: its skill is what an agent is given, its page is its workbench,
 * and its switch is the skill's.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePlugins, type Plugin } from './plugins.ts';
import { seenSkills, watchSkills, type SkillEntry } from './project-sources.ts';

/** A skill with a surface, as the plugin it is: its workbench is named by its uid. */
export const pluginOfSkill = (skill: SkillEntry): Plugin => ({
  id: skill.uid, title: skill.shown?.title ?? { en: skill.name }, summary: skill.shown?.summary ?? { en: skill.description },
  ...(skill.icon ? { icon: skill.icon } : {}), workbench: skill.uid, skills: [skill.name], on: !skill.off, page: skill.surface!, skill: skill.uid,
});

/** The skills of a list that are plugins: installed, with a surface. */
export const skillPlugins = (skills: readonly SkillEntry[]): Plugin[] => skills.filter((k) => k.surface && k.installed !== false).map(pluginOfSkill);

export function usePluginsOf(projectId: string | null): readonly Plugin[] {
  const plugins = usePlugins();
  const [skills, setSkills] = useState<SkillEntry[]>(() => seenSkills(projectId) ?? []);
  useEffect(() => {
    let live = true;
    const stop = watchSkills(projectId, (list) => { if (live) setSkills(list); });
    return () => { live = false; stop(); };
  }, [projectId]);
  return useMemo(() => [...plugins, ...skillPlugins(skills)], [plugins, skills]);
}
