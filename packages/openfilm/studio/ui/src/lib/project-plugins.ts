/**
 * The plugins a project has: OpenFilm's own (lib/plugins), then the ones someone made, among the person's own, this
 * project's, and those installed. A skill shows nowhere but in the conversation; a plugin is one that also shows
 * outside it: it brings a surface the person works in, a web page at its folder's root (openfilm/src/skills.mjs
 * SKILL_PAGE) or a program that serves one (its `scripts.start`). Commands alone (its package.json's `bin`) leave a
 * skill a skill. A plugin someone made is one like any other: its skill is what an agent is given, its surface is its
 * workbench, and its switch is the skill's.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePlugins, type Plugin } from './plugins.ts';
import { seenSkills, watchSkills, type SkillEntry } from './project-sources.ts';

/** A skill that is a plugin, as one: with a surface, its workbench is named by its uid. */
export const pluginOfSkill = (skill: SkillEntry): Plugin => ({
  id: skill.uid, title: skill.shown?.title ?? { en: skill.name }, summary: skill.shown?.summary ?? { en: skill.description },
  ...(skill.icon ? { icon: skill.icon } : {}), skills: [skill.name], on: !skill.off, skill: skill.uid,
  ...(skill.surface ? { workbench: skill.uid, page: skill.surface } : {}), ...(skill.files ? { files: skill.files } : {}),
  ...(skill.program ? { workbench: skill.uid, program: true, runs: Boolean(skill.runs) } : {}),
});

/** Whether a skill is a plugin: it shows outside the conversation (openfilm/src/skills.mjs isPlugin). */
export const isPlugin = (skill: SkillEntry): boolean => Boolean(skill.surface || skill.program);

/** The skills of a list that are plugins, installed. */
export const skillPlugins = (skills: readonly SkillEntry[]): Plugin[] => skills.filter((k) => isPlugin(k) && k.installed !== false).map(pluginOfSkill);

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
