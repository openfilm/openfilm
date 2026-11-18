#!/usr/bin/env node
// @ts-check
/**
 * `openfilm canvas [apply <steps> | add <file…>]`: the project's canvas read, or steps taken on it, through the Studio
 * running (started when needed; studio/client.mjs canvasCommand). `add` is steps too: files put in a row (add.mjs). The canvas plugin brings it (its package.json's `bin`), so it is
 * there only while the plugin is on (src/plugin-commands.mjs). What it prints and its exit status are the same as when
 * it was one of OpenFilm's own commands: 0 done, 1 it failed, 2 not a project or a wrong command.
 */
import { parseArgs } from 'node:util';
import { canvasCommand } from '../../studio/client.mjs';
import { addSteps } from './add.mjs';
import { UsageError } from '../../src/shared.mjs';

/* how `openfilm` is typed here (src/plugin-commands.mjs gives it) */
const RUN = process.env.OPENFILM_RUN || 'openfilm';

const HELP = `openfilm canvas [apply <steps> | add <file…>]

  The project's canvas: a board beside the edit where the person lays out notes, the project's files and nodes that
  make a picture, a clip or a sound, wired into each other. Nothing on it is in the film until it is put on the timeline.

  canvas                 the board as JSON: nodes (id, x, y; a note's text, a file's path, a group's name and color,
                         a making node's make, prompt, model, opts, versions and the one shown, path) and wires
                         (from, to, order: what goes into a node, in that order)
  canvas add <file…>     files of the project put on the board the person has open, in a row below what is there,
                         in the order named
  canvas apply <steps>   steps on it, all taken or none: a JSON list, a .json file, or - to read it
    {"op":"add","kind":"note|file|image|video|sfx|music|tts|cut|group","id":"…", text | path | prompt, via, model,
      preset, opts: {ratio, sec, mode, quality, size, count, voice}, name, color, x, y, w, h, group: "<group id>",
      inputs: ["<id>", …], around: ["<id>", …]}
                         a node; its id names it for later steps. Without x, y it goes right of its inputs (wired into
                         it in that order), else below the rest. A group made around nodes holds them. A cut is
                         the order what is wired into it goes onto the timeline in, when the person sends it there.
    {"op":"set","id":"…", …}   {"op":"remove","id":"…"}   {"op":"wire","from":"…","to":"…"}   {"op":"unwire",…}
    {"op":"version","id":"…","path":"assets/…"}   a file made with \`openfilm get\` as a making node's newest version

  A making node is asked its prompt with the notes wired into it first; a tts node speaks it in opts.voice (a voiceId
  from \`openfilm get voice\`; none: its service's first voice in the person's language). How a video uses the
  pictures wired in is its opts.mode: text, first (the first picture is its first frame), firstLast (first and last
  frame), refs (references for people and places) or omni (pictures, a voice or a clip). A picture's preset puts
  ready words first: portrait, fullBody, expressions, turnaround16 (a character), storyboard, cameras9, scene,
  product… The person presses Make (a group's Make all makes it in wire order), or you make it with \`openfilm get\`
  and add the file as a version. The person sees each change on the board at once.`;

/* the help speaks the name this was run as: `openfilm` or `npx openfilm` */
const named = (/** @type {string} */ text) => text.replace(/^( {2})?openfilm(?= )/gm, `$1${RUN}`);

let parsed;
try {
  parsed = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { help: { type: 'boolean', short: 'h' } } });
} catch (e) {
  /* an option it does not have: say which, and what it takes */
  console.error(`${RUN} canvas: ${/** @type {Error} */ (e).message.replace(/\. To specify a positional argument.*$/s, '')}\n\n${named(HELP)}`);
  process.exit(2);
}
if (parsed.values.help) {
  console.log(named(HELP));
  process.exit(0);
}
try {
  let words = parsed.positionals;
  if (words[0] === 'add') {
    /* the board read, the row worked out on it, and laid down as steps */
    const root = process.env.OPENFILM_PROJECT;
    if (!root) throw new UsageError('run it in a film\'s folder (one with film.html)');
    const read = await canvasCommand([], (line) => console.error(line));
    if (read.ok === false) { for (const line of read.lines) console.error(line); process.exit(read.usage ? 2 : 1); }
    let steps;
    try { steps = await addSteps(JSON.parse(read.lines.join('\n')), root, words.slice(1), { cwd: process.cwd() }); } catch (e) { throw new Error(`add: ${/** @type {Error} */ (e).message}`); }
    words = ['apply', JSON.stringify(steps)];
  }
  const result = await canvasCommand(words, (line) => console.error(line));
  for (const line of result.lines) console.log(line);
  if (result.ok === false) process.exitCode = result.usage ? 2 : 1;
} catch (e) {
  console.error(`${RUN} canvas: ${/** @type {Error} */ (e).message}`);
  process.exit(e instanceof UsageError ? 2 : 1);
}
