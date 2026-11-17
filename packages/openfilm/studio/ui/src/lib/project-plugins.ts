/**
 * The plugins a project has: OpenFilm's own (lib/plugins), then the ones someone made, among the person's own, this
 * project's, and those installed. A skill shows nowhere but in the conversation; a plugin is one that also shows
 * outside it: it brings a surface the person works in, a web page at its folder's root (openfilm/src/skills.mjs
 * SKILL_PAGE), an element put in the editor's own page (its `browser` module) or a program that serves a page (its
 * `scripts.start`). Commands alone (its package.json's `bin`) leave a
 * skill a skill. A plugin someone made is one like any other: its skill is what an agent is given, its surface is its
 * workbench, and its switch is the skill's.
 */
import { useEffect, useMemo, useState } from 'react';
import { inPersonsOrder, usePlugins, useWorkbenchOrder, type Plugin } from './plugins.ts';
import { seenSkills, watchSkills, type SkillEntry } from './project-sources.ts';

/**
 * A skill that is a plugin, as one: with a surface, its workbench is named by its uid; one whose openfilm.json asks for
 * a tab of the library shows its surface there instead, and has no workbench. A workbench is laid out among the
 * page's panels in the blocks its openfilm.json declares (lib/blocks), its own keyed by its uid.
 */
export const pluginOfSkill = (skill: SkillEntry): Plugin => {
  const surface = skill.tab ? {} : { workbench: skill.uid, ...(skill.blocks ? { blocks: skill.blocks } : {}) };
  return {
    id: skill.uid, title: skill.shown?.title ?? { en: skill.name }, summary: skill.shown?.summary ?? { en: skill.description },
    ...(skill.icon ? { icon: skill.icon } : {}), ...(skill.appIcon ? { appIcon: skill.appIcon } : {}), skills: [skill.name], on: !skill.off, skill: skill.uid,
    ...(skill.commands?.length ? { commands: skill.commands } : {}), ...(skill.tab ? { tab: skill.tab } : {}),
    ...(skill.surface ? { ...surface, page: skill.surface } : {}), ...(skill.files ? { files: skill.files } : {}),
    ...(skill.program ? { ...surface, program: true, runs: Boolean(skill.runs) } : {}),
    ...(skill.inApp ? { ...surface, inApp: true, runs: Boolean(skill.runs), ...(skill.element ? { element: skill.element } : {}) } : {}),
  };
};

/** Whether a skill is a plugin: it shows outside the conversation (openfilm/src/skills.mjs isPlugin). */
export const isPlugin = (skill: SkillEntry): boolean => Boolean(skill.surface || skill.program || skill.inApp);

/** The skills of a list that are plugins, installed. */
export const skillPlugins = (skills: readonly SkillEntry[]): Plugin[] => skills.filter((k) => isPlugin(k) && k.installed !== false).map(pluginOfSkill);

/** OpenFilm's own and those someone made, in the order the person put them in (Community › Mine). */
export function usePluginsOf(projectId: string | null): readonly Plugin[] {
  const plugins = usePlugins();
  const order = useWorkbenchOrder();
  const [skills, setSkills] = useState<SkillEntry[]>(() => seenSkills(projectId) ?? []);
  useEffect(() => {
    let live = true;
    const stop = watchSkills(projectId, (list) => { if (live) setSkills(list); });
    return () => { live = false; stop(); };
  }, [projectId]);
  return useMemo(() => inPersonsOrder([...plugins, ...skillPlugins(skills)], order), [plugins, skills, order]);
}
