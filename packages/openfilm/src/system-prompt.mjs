// @ts-check
/**
 * OpenFilm's system prompt (SYSTEM_PROMPT.md): what every agent is told before anything else, whichever agent it is
 * and however it is reached. It says where the agent is, how to be with the person, and that skills say how each kind
 * of work is done. It holds nothing of any one kind of work: what a film is, how one is seen or rendered, where media
 * comes from are each a skill's, with the commands that skill uses, read when a task needs it. So the prompt stays a
 * few lines however much OpenFilm can do.
 *
 * One text, three ways to an agent: `openfilm` alone prints it with OpenFilm's own skills listed after it (the CLI:
 * an agent in a terminal, and one an app started that was told to run it); the desktop app's own agent has it as its
 * system prompt. After its first lines comes the part for where the agent is: `<!-- in a terminal -->` (how Studio
 * is opened; how it talks with the person is that agent's own), or `<!-- in the app -->` (Studio is beside it, and
 * how to be with the person there, who came to make a video and not to read code); what follows
 * `<!-- everywhere -->` is for both.
 */
import { readFileSync } from 'node:fs';

/** @typedef {'terminal' | 'app'} Where where an agent works: in a terminal of its own, or in the desktop app's chat, Studio beside it */

const MARK = /^<!-- (in a terminal|in the app|everywhere) -->\n/m;

/**
 * The system prompt for an agent there.
 * @param {Where} [where] @param {string} [text] SYSTEM_PROMPT.md (read when not given)
 */
export function systemPrompt(where = 'terminal', text = readFileSync(new URL('../SYSTEM_PROMPT.md', import.meta.url), 'utf8')) {
  const parts = text.split(MARK);
  const wanted = where === 'app' ? 'in the app' : 'in a terminal';
  /** @type {string[]} */
  const kept = [parts[0]];
  for (let i = 1; i < parts.length; i += 2) if (parts[i] === wanted || parts[i] === 'everywhere') kept.push(parts[i + 1]);
  return `${kept.map((part) => part.trim()).join('\n\n')}\n`;
}
