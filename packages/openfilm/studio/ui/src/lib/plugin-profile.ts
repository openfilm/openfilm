/**
 * What the library's Plugins tab tells people of a plugin or a skill before they turn it on: which one category it is
 * in (what it helps make), and its profile (src/plugins.mjs profileOf): how hard it is to start with, how little work
 * a result takes, who it is for, whether it costs money; and how it is used (where it shows, whether an agent is
 * taught it, its commands), read from what it brings.
 */
import type { Plugin, Profile } from './plugins.ts';
import { isPlugin } from './project-plugins.ts';
import type { SkillEntry } from './project-sources.ts';

/** The categories, in the order a film is made: material, the cut, the picture, the sound; then whole ways of making one, and the rest. */
export const CATEGORIES = ['material', 'edit', 'picture', 'sound', 'recipe', 'tool'] as const;
export type Category = (typeof CATEGORIES)[number];

/** One of OpenFilm's own plugins: the category it says (each says one). */
export const categoryOfPlugin = (plugin: Pick<Plugin, 'profile'>): Category => plugin.profile?.category ?? 'tool';

/**
 * A skill: the category it says; else a look is the picture's, and any other is a way of making a kind of film, as
 * skills of OpenFilm's, the community's and the person's are.
 */
export const categoryOfSkill = (skill: Pick<SkillEntry, 'profile' | 'kind'>): Category => skill.profile?.category ?? (skill.kind === 'style' ? 'picture' : 'recipe');

/** How it is used: a surface of its own (a workbench, or a tab of the library), the conversation (a skill an agent is taught), commands. */
export type Use = 'surface' | 'chat' | 'commands';
export const USES: readonly Use[] = ['surface', 'chat', 'commands'];

export const usesOfPlugin = (plugin: Pick<Plugin, 'workbench' | 'tab' | 'skills' | 'commands'>): Use[] => [
  ...(plugin.workbench || plugin.tab ? ['surface' as const] : []), ...(plugin.skills.length ? ['chat' as const] : []), ...(plugin.commands?.length ? ['commands' as const] : []),
];
export const usesOfSkill = (skill: SkillEntry): Use[] => [...(isPlugin(skill) ? ['surface' as const] : []), 'chat', ...(skill.commands?.length ? ['commands' as const] : [])];

export type { Profile };
