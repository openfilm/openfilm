#!/usr/bin/env node
import { parseArgs } from 'node:util';

const USAGE = `openfilm — a film is a function of time: given t, it draws that moment

  openfilm open   [folder | url]      start or open a project; Studio shows it to the person
  openfilm look   [what] [t | a-b]    check the film and draw it: a contact sheet with its sound and loudness
  openfilm render [a-b]               the MP4, saved beside film.html
  openfilm get    [what] [--options]  voice-over, music, sound effects, transcripts, images, video, from a connected service

  Run with no arguments for the manual; \`openfilm <command> --help\` for one command's options; --version for the version.
  look, render and get work on the project around the current folder.
  Exit status: 0 done, 1 the film or the command failed (the output says why), 2 not a project or a wrong command.`;

/* one command's help: what it does, what it takes, where its output goes */
const COMMAND_HELP = {
  open: `openfilm open [folder | url]

  folder   a new film: a folder named after it (made if missing); or an existing project
           A folder that is not a project yet gets an empty film.html, 1920 × 1080 (its viewport <meta>) with no
           tracks; nothing else is created. Not a code project
           (package.json, Cargo.toml, go.mod, pyproject.toml…): the film gets a folder of its own inside it.
  url      a film on GitHub or GitLab: a repository (https://github.com/owner/repo) or a folder in one
           (…/tree/main/<folder>), copied into the projects library without its git history, then opened
  without  the project around the current folder, else the one opened last, else Studio's projects (where the
           person can start one). The current folder is never made a project: name it (.) for that.

  Starts OpenFilm Studio if it is not running and prints its address. A Studio page already open, in any browser,
  switches to the project, and nothing more opens; otherwise open the address in your built-in browser, and if no
  page connects within 15 s, Studio opens the person's browser (OPENFILM_NO_BROWSER=1: never).`,
  look: `openfilm look [what] [t | a-b]

  what   the project (default), a web page (.html), or a media file (video, image, sound)
  t      one frame at full size, e.g. 4.5
  a-b    a dense sheet of a stretch, e.g. 3-6
         without either: a contact sheet of the whole thing, its sound and loudness, and a check that
         the same t draws the same picture

  Writes PNGs under .film/cache/look/ of the project and prints their paths. A project Studio has not shown yet is
  opened in Studio first, so the person watches it.

  --count <n>     frames in a sheet (12)`,
  render: `openfilm render [a-b]

  Render the project around the current folder to video.
  The whole film goes to <project>/<folder name>.mp4, beside film.html; a range (a-b) goes to .film/cache/render/.
  A project Studio has not shown yet is opened in Studio first.

  --out <file>    another path; .webm or .mov with --alpha
  --fps <n>       frame rate (30)
  --4k            3840 px wide              --scale <n>     any device pixel ratio
  --blur          motion blur (8 samples)   --samples <n>   --shutter <0..1>
  --alpha         transparent background    --workers <n>   parallel browsers`,
};

/* `openfilm` alone: the manual, the whole of what an agent needs to know. `get` takes any options its verb has,
   so it goes to Studio (studio/client.mjs) before the fixed options below are parsed. */
const RAW = process.argv.slice(2);
/* the command as the agent can type it here: the one that ran it when it says so (OPENFILM_RUN: the development
   checkout's .dev/bin/openfilm), through npx always the newest (npx keeps the first one it fetched for a bare name),
   else `openfilm` where it is installed */
const RUN = process.env.OPENFILM_RUN || (process.env.npm_command === 'exec' ? 'npx -y openfilm@latest' : 'openfilm');
/**
 * A newer openfilm, said once in a line before what the command prints: looked up on npm (at most daily, briefly) when
 * a session starts (the manual, open), else only as learnt before, so look, render and get never wait for it.
 */
const updateNotice = async (network) => {
  const latest = await (await import('../studio/client.mjs')).newerOpenfilm({ network }).catch(() => null);
  if (latest) console.error(`openfilm ${latest} is out (this is an older one): run commands as \`npx -y openfilm@latest …\` to use it; it updates Studio too.`);
};
if (RAW.length === 0) {
  const { readFileSync } = await import('node:fs');
  await updateNotice(true);
  console.log(readFileSync(new URL('../MANUAL.md', import.meta.url), 'utf8').replaceAll('npx openfilm', RUN));
  process.exit(0);
}
if (RAW.length === 1 && (RAW[0] === '--version' || RAW[0] === '-v')) {
  const { readFileSync } = await import('node:fs');
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  process.exit(0);
}
await updateNotice(RAW[0] === 'open');
if (RAW[0] === 'get') {
  let result;
  try { result = await (await import('../studio/client.mjs')).getMedia(RAW.slice(1), (line) => console.error(line)); }
  catch (e) { result = { code: 1, lines: [`openfilm get: ${e.message}`] }; }
  for (const line of result.lines) console.log(line);
  process.exit(result.code);
}

/* the help speaks the name this was run as: `openfilm` or `npx openfilm` */
const named = (text) => text.replace(/^( {2})?openfilm(?= )/gm, `$1${RUN}`).replace('`openfilm <command>', `\`${RUN} <command>`);
let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      count: { type: 'string' }, out: { type: 'string', short: 'o' }, '4k': { type: 'boolean' }, scale: { type: 'string' },
      blur: { type: 'boolean' }, samples: { type: 'string' }, shutter: { type: 'string' }, alpha: { type: 'boolean' },
      fps: { type: 'string' }, workers: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
} catch (e) {
  /* an option no command has: say which, and what there is, rather than Node's stack */
  console.error(`${RUN}: ${e.message.replace(/\. To specify a positional argument.*$/s, '')}\n\n${named(USAGE)}`);
  process.exit(2);
}
const { values: o, positionals } = parsed;
const [cmd, ...args] = positionals;
const HELP = named(USAGE);
if (o.help && COMMAND_HELP[cmd]) { console.log(named(COMMAND_HELP[cmd])); process.exit(0); }
if (o.help || !cmd) { console.log(HELP); process.exit(0); }
const num = (v) => (v == null ? undefined : Number(v));
const opts = { ...o, count: num(o.count), scale: num(o.scale), samples: num(o.samples), shutter: num(o.shutter), fps: num(o.fps), workers: num(o.workers) };
/* a number option out of its range is a wrong command (2), said before anything starts */
const RANGES = { count: [1, 200, true], fps: [1, 240, true], scale: [0.1, 8, false], samples: [1, 64, true], shutter: [0, 1, false], workers: [1, 64, true] };
for (const [name, [lo, hi, whole]] of Object.entries(RANGES)) {
  const v = opts[name];
  if (v === undefined || (Number.isFinite(v) && v >= lo && v <= hi && (!whole || Number.isInteger(v)))) continue;
  console.error(`${RUN} ${cmd ?? ''}: --${name} is ${whole ? 'a whole number' : 'a number'} from ${lo} to ${hi}, not ${o[name]}`.replace(' :', ':'));
  process.exit(2);
}
const commands = {
  open: () => open(args[0] ?? null),
  look: () => import('../src/look.mjs').then((m) => m.look(args, opts)),
  render: () => import('../src/render.mjs').then((m) => m.render(args, opts)),
};
/**
 * Show a project in Studio; `.film/opened` marks a project Studio has shown. A folder named is made a project when it is
 * not one; with none, the project around the current folder, else the one opened last: the current folder (a code
 * repository, the home folder) is never made a project unasked.
 * @param {string | null} folder
 */
async function open(folder) {
  /* a film on GitHub: copied into the library first, then opened as any folder */
  if (folder != null && /^(https?:\/\/|(www\.)?(github|gitlab)\.com\/)/i.test(folder)) {
    const fetched = await fetchFilm(folder);
    if (!fetched.ok) return fetched;
    folder = fetched.path;
  }
  const { openInStudio } = await import('../studio/client.mjs');
  const { existsSync, mkdirSync, statSync, writeFileSync } = await import('node:fs');
  const { dirname, join, resolve } = await import('node:path');
  const fallback = process.env.OPENFILM_NO_BROWSER ? 0 : 15;
  /* a person at a terminal has no browser of an agent's: theirs opens at once */
  const now = !process.env.OPENFILM_NO_BROWSER && Boolean(process.stdout.isTTY && process.stdin.isTTY);
  /* a checkout whose editor was never built (npm install builds it): Studio would show only that it is missing */
  if (!existsSync(new URL('../studio/ui/dist/index.html', import.meta.url))) {
    console.error('Studio\'s editor is not built in this checkout: run `npm run build:ui` (npm install does it).');
  }
  /** the project `from` is in (it, or a folder above it), if any */
  const around = (from) => { for (let up = from; up !== dirname(up); up = dirname(up)) if (existsSync(join(up, 'film.html'))) return up; return null; };
  let asked = folder == null ? around(process.cwd()) : resolve(folder);
  if (asked && existsSync(asked) && !statSync(asked).isDirectory()) return { ok: false, usage: true, lines: [`${RUN} open: ${asked} is a file; a project is a folder`] };
  /* a folder inside a project (scenes/, assets/) is the project around it, as look and render take it */
  if (asked && existsSync(asked) && !existsSync(join(asked, 'film.html'))) asked = around(asked) ?? asked;
  /* a code project is not a film: the film gets a folder of its own (a folder of media kept in git is fine) */
  const MANIFESTS = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt', 'Gemfile', 'pom.xml', 'build.gradle', 'composer.json', 'Package.swift'];
  const code = (dir) => MANIFESTS.some((name) => existsSync(join(dir, name)));
  if (asked && existsSync(asked) && !existsSync(join(asked, 'film.html')) && code(asked)) {
    return { ok: false, usage: true, lines: [`${RUN} open: ${asked} is a code project, not a film; give the film a folder of its own: \`${RUN} open <name>\` makes <name>/ here`] };
  }
  try {
    const { project, url, pages } = await openInStudio(asked, { fallback, now, say: (line) => console.error(line) });
    if (project) {
      mkdirSync(join(project.path, '.film'), { recursive: true });
      writeFileSync(join(project.path, '.film', 'opened'), '');
    }
    /* an agent opens it in its own browser whatever else shows Studio: a page open elsewhere is not the agent's */
    return { ok: true, lines: [project ? `project  ${project.path}` : `project  none yet: the person starts one in Studio, or \`${RUN} open <folder>\` makes one`, `Studio   ${url}`,
      /* a page in sight switched to it: nothing more opens, nor should be opened */
      pages ? '         already open in a browser, now showing this project: open nothing more'
        : now ? '         opened in your browser'
          : fallback ? `         open this address in your built-in browser now; with none, it opens in the person's browser in ${fallback} s`
            : '         open this address in your built-in browser now, or give it to the person'] };
  } catch (e) { return { ok: false, lines: [`${RUN} open: ${e.message}`] }; }
}
/**
 * `openfilm open <url>`: the repository or folder fetched into the projects library (studio/server/fetch-repo.mjs),
 * its progress on stderr.
 * @param {string} url
 */
async function fetchFilm(url) {
  const { FetchError, fetchFilm: fetchInto, parseRepoUrl } = await import('../studio/server/fetch-repo.mjs');
  const { libraryRoot } = await import('../studio/server/projects.mjs');
  let source;
  try { source = parseRepoUrl(url); } catch (e) { return { ok: false, usage: true, lines: [`${RUN} open: ${e.message}`] }; }
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  let said = '';
  try {
    const path = await fetchInto(source, {
      library: libraryRoot(),
      onProgress: ({ phase, bytes }) => {
        const line = phase === 'lookup' ? `Looking up ${source.web}…` : phase === 'copy' ? `Fetched ${mb(bytes)}` : null;
        if (line && line !== said) console.error((said = line));
      },
    });
    return { ok: true, path };
  } catch (e) {
    return { ok: false, usage: e instanceof FetchError && ['url', 'host'].includes(e.code), lines: [`${RUN} open: ${e.message}`] };
  }
}
if (!commands[cmd]) { console.error(`${RUN}: no command ${cmd}\n\n${HELP}`); process.exit(2); }

if (cmd === 'look' || cmd === 'render') {
  const { existsSync } = await import('node:fs');
  const { dirname, join, resolve } = await import('node:path');
  /* a project is made by \`open\`: look and render work in one (the one around here, or around what they look at) */
  const around = (from) => { for (let up = resolve(from); up !== dirname(up); up = dirname(up)) if (existsSync(join(up, 'film.html'))) return up; return null; };
  const target = args.find((a) => !/^\d+(\.\d+)?(-\d+(\.\d+)?)?$/.test(a));
  const project = around('.') ?? (target ? around(target) : null);
  if (!project) { console.error(`${RUN} ${cmd}: ${resolve('.')} is not in a project; \`${RUN} open\` makes one and shows it in Studio`); process.exit(2); }
  /* a project Studio has never shown (copied, cloned, forked): show it now, so the person watches from the start */
  if (!existsSync(join(project, '.film', 'opened'))) {
    const shown = await open(project);
    for (const line of shown.lines) console.error(line);
    if (!shown.ok) console.error(`${RUN} ${cmd}: carrying on without Studio`);
  }
}

/** The first run on a machine has no browser yet: fetch Playwright's Chromium once, then run the command again. */
async function installChromium() {
  const { createRequire } = await import('node:module');
  const { spawnSync } = await import('node:child_process');
  const { dirname, join } = await import('node:path');
  const cli = join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'cli.js');
  console.error(`${RUN}: first run on this machine, downloading the browser films are drawn in (about 100 MB, once)`);
  const r = spawnSync(process.execPath, [cli, 'install', 'chromium-headless-shell'], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  if (r.status !== 0) throw new Error('could not download the browser; run `npx playwright-core install chromium-headless-shell` and try again');
}

const FFMPEG_HELP = 'macOS: brew install ffmpeg · Debian/Ubuntu: sudo apt install ffmpeg · Windows: winget install ffmpeg';
const noFfmpeg = async () => {
  const { spawnSync } = await import('node:child_process');
  return ['ffmpeg', 'ffprobe'].some((bin) => spawnSync(bin, ['-version'], { stdio: 'ignore', windowsHide: true }).error);
};
if ((cmd === 'look' || cmd === 'render') && await noFfmpeg()) {
  console.error(`${RUN} ${cmd}: needs ffmpeg and ffprobe on the PATH (${FFMPEG_HELP})`);
  process.exit(2);
}
if (cmd === 'open') {
  /* Studio draws pages' pictures in the headless browser: have it before Studio starts, not after its first try */
  const { launch } = await import('../src/host.mjs');
  try { await (await launch()).close(); }
  catch (e) { if (/Executable doesn't exist/.test(e.message)) await installChromium(); }
  if (await noFfmpeg()) console.error(`${RUN} ${cmd}: Studio needs ffmpeg for video pictures, sound waves and exports; install it (${FFMPEG_HELP})`);
}

try {
  let result;
  try { result = await commands[cmd](); }
  catch (e) {
    if (!/Executable doesn't exist/.test(e.message)) throw e;
    await installChromium();
    result = await commands[cmd]();
  }
  for (const line of result.lines) console.log(line);
  if (result.ok === false) process.exitCode = result.usage ? 2 : 1;
} catch (e) {
  console.error(`${RUN} ${cmd}: ${e.message}`);
  const { UsageError } = await import('../src/shared.mjs');
  process.exit(e instanceof UsageError ? 2 : 1);
}
