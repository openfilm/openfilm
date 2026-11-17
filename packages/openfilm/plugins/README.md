# Making a plugin

A plugin teaches OpenFilm one more kind of work. It is a folder: what an agent is taught (a skill), and what shows outside the
conversation (a workbench in Studio, commands). OpenFilm's own plugins are the folders beside this file (`screening`, `edit`, `canvas`,
`color`), and they are made the same way as anyone's.

Only in the conversation, it is a skill; also outside it, a plugin.

## The folder

```
my-plugin/
  SKILL.md        what an agent is taught: front matter with `name` and `description`, then the way to work
  openfilm.json   how people see it (optional): `title`, `summary`, `icon`, by language; its category and profile;
                  `requires`, `tab` and `blocks`, below
  package.json    what runs (optional): `browser`, `bin`, `scripts.start`
  index.html      a page shown as its workbench (optional)
```

Put it in your Skills folder (`~/Movies/OpenFilm/Skills` on macOS, `~/Videos/OpenFilm/Skills` elsewhere; `OPENFILM_SKILLS`
names another), or in a project's `skills/` folder to keep it with that project. Studio's Community window (the OpenFilm
menu, or the compass beside the chat's "+") lists it under Added with its switch: as a workbench when it has a page,
else as a skill. People see "workbench" and "skill"; "plugin" is the word for those who make them.

### How it is listed: category and profile

The Community window lists workbenches and skills in the order a film is made (each says its category), and opens on a
page that sums it up at the top. Its openfilm.json says so (each optional; a skill's openfilm.json the same):

| Field | What it says |
|---|---|
| `category` | `material` (shots, pictures, sets to make the film from), `edit` (cutting it, watching it), `picture` (color, motion, compositing), `sound`, `recipe` (a whole way of making one kind of film), `tool` (anything else). None: a skill is a recipe (a look, `kind: "style"`, the picture's), a plugin a tool |
| `difficulty` | how much there is to learn before the first result, 1 (anyone, at once) to 5 (a professional's) |
| `ease` | how little work a result takes once learned, 1 (all by hand) to 5 (a sentence to the agent) |
| `audience` | who it is for, by language: `{ "en": "Designers who tune animation by hand", … }` |
| `cost` | `free`, or `generation` when using it makes media with a paid service |
| `details` | a few lines on what it is for and how it is used, by language, one thing a line (`When to use it: …`) |

How it is used (its workbench or tab, the conversation, its commands) is read from what it brings, so it is not said.

### What it builds on: `requires`

As a package names the packages it depends on, a skill or a plugin names the skills it builds on, in its openfilm.json:
`"requires": ["film"]`. OpenFilm's own are `film` (how a film is written: film.html, its pages, looking at it) and
`media` (the library and the services that make media). An agent is given the skills of the plugins on and of the
skills on, and the skills these require, and so on, each once, a skill after those it builds on; it is told what each
builds on, and reads those first. One that requires nothing is given without them: a plugin that only lays out notes
needs no film. No skill is given to every agent; what is is the system prompt, a few lines on where the agent is, how it
is with the person, and how things are pointed at (Links, below).

So a skill of yours says only what it adds:

- what the system prompt or a skill it requires already says (how film.html is written, looking before saying it
  works, changing only what was asked, how to link) it does not say again: it requires that skill;
- a plugin that adds no way of writing (a new way to see or point at the film) brings no skill at all, only `requires`;
- a skill's sections are its own: one titled as a section of a skill it requires is a test's failure in OpenFilm's own.

A workbench is one of three things, the first one found:

| `package.json` | What it is | What it reaches |
|---|---|---|
| `browser`: a JavaScript module | A custom element, loaded into Studio's own page and put where the workbench is | `openfilm/studio` (below), as OpenFilm's own workbenches do |
| `scripts.start`: a command line | A program started in the plugin's folder, serving its workbench on `PORT` (host `127.0.0.1`); `OPENFILM_PROJECT` is the project's folder | Whatever it serves |
| (none) and `index.html` | A web page, shown in a frame on an origin of its own, told where the project's files are by `?project=` | The project's files, read there, and written (PUT) once the person lets it |

An element or a program runs only once the person lets the plugin run; nothing writes the project's files before they say so.

### A tab of the library

A plugin's workbench can be a tab of the library drawer instead, beside Media, Templates and the rest: its `openfilm.json`
says `"tab": { "icon": "layers", "title": { "en": "Notes", "zh-CN": "笔记" } }` (each optional: the plugin's own `icon` and
`title` when left out; `"tab": true` is the same as `{}`). The tab comes after the library's own, while the plugin is on, and
is arranged with them in Settings › Advanced. It shows what the workbench would: the element (told the same `project-id`,
`plugin`, `project` and `folder`), the program's page, or `index.html`. A plugin of OpenFilm's own (`plugins/<id>/`) declares
both if it wants both: its `workbench` and its `tab` show the same element, the one its `browser` module names
(`export { default } from 'openfilm/workbench/<name>'`, built from `studio/ui/src/plugins/<name>/index.tsx`); a tab named
by a plugin's id that is also one of the library's own takes that one's place.

A tab's element is made once for the project and kept for as long as the page is open: while another tab is shown, or the
drawer is closed, it is moved out of sight, and moved back when the tab is shown again. A move calls `disconnectedCallback`
and then `connectedCallback`; keep what the element holds across one (let it go only if `isConnected` is still false a
moment after `disconnectedCallback`, as OpenFilm's own elements do).

`bin` gives commands: `"bin": { "look": "look.mjs" }` is `openfilm my-plugin look`, for an agent and for other plugins alike.
A `bin` that is one file is one command, `openfilm my-plugin`.

A film never depends on a plugin. What a plugin writes into `film.html` is standard HTML and CSS and files of the project,
so the film plays and renders with the plugin off.

### A connector: `.mcp.json`

A plugin reaches a service your agent can use when its folder has a `.mcp.json`, written as a Claude Code plugin's:

```json
{ "mcpServers": { "notion": { "type": "http", "url": "https://mcp.notion.com/mcp" } } }
```

Each server is a remote one (`"type": "http"`, an `https://` address, optional string `headers`) or a program to run
(`"type": "stdio"`, its `command`, `args` and string `env`); at most eight, each named in lowercase letters, digits,
`-` and `_`. Put no keys in the file.

The desktop app signs the person in to a remote server once, in their browser (the MCP authorization flow: OAuth with
PKCE, OpenFilm registering itself with the service's authorization server, a loopback redirect), keeps what it gets
sealed with the system's keychain, and refreshes it. Every agent reaches the server through a door on 127.0.0.1 that
puts the person's token on each request (ACP `mcpServers` of `session/new`), so OpenFilm's own agent, Claude Code and
Codex all use it and none holds the credentials; a tool that may change something asks the person first. A plugin with
only a `.mcp.json` and its `openfilm.json` is listed as a connector in the Community, with `examples` (a few things a
person could say, in each language) offered on its page.

### `look`: what an agent sees of your dimension

A workbench plugin lets an agent check its work without the interface: a `look` command that tells the film as your
workbench sees it, in numbers and pictures, as `openfilm look` tells the picture and the sound (`openfilm edit look` is
that one).

```
openfilm my-plugin look [what] [t | a-b] [--json]
```

- `what`: what of yours to look at (a clip's id, a file of the project); none, the whole film. `t` one moment in seconds
  (`12.5`), `a-b` a stretch (`3-6`); neither, the whole length.
- It prints plain text, a line each: what it looked at first, then what it found, every number with its unit
  (`-14.2 LUFS`, `6500 K`, `12 %`, `3.5 s`), what is wrong (`✗ …`), what to watch (`! …`), what is right (`✓ …`), and last
  the path of each picture it saved (`→ …`). Pictures go under the project's `.film/look/<plugin>/`.
- `--json` prints one JSON object instead, for a program: `{ "ok": true, "files": [ … ], … }` with your numbers.
- Its exit status is `openfilm look`'s: 0 done, 1 the film or the look failed (the output says why), 2 not a project or
  a wrong command.

`openfilm edit look` is `openfilm look` as it is, with its options (`--count`, `--full`, `--loudness`) and no `--json` yet.

A plugin of OpenFilm's own does the convention's part with `runLook` (`src/plugin-look.mjs`), and only looks:

```js
import { join } from 'node:path';
import { runLook } from '../../src/plugin-look.mjs';

process.exitCode = await runLook(async ({ project, what, at, range, dir, shown }) => {
  const picture = join(dir(), 'a.png'); // measured and drawn from the project's files
  return { lines: ['clip a · 0–4 s', 'white balance  6500 K', `→ ${shown(picture)}`], files: [picture], data: { kelvin: 6500 } };
}, { plugin: 'my-plugin', usage: 'openfilm my-plugin look [what] [t | a-b]' });
```

## Links

A link names a thing of the project: a path in its folder and, after `#`, what in that file. After `#` there is only
what the web already has, so agents write links untaught and every plugin's mean the same: an element's id (HTML), and
a time and a part of the picture as W3C Media Fragments write them (`t=`, `xywh=`, joined by `&`), the same `#t=` the
film's sources are cut with.

| Link | What it names |
|---|---|
| `film.html#<clip-id>` | a clip of the film, by its id |
| `film.html#t=12.5` | a moment of the film, in seconds |
| `film.html#t=3,6` | a stretch of it |
| `film.html#t=12.5&xywh=640,200,320,180` | a part of the picture then: x, y, width, height in the stage's pixels |
| `assets/a.mp4` | a file of the project (`#t=3,6` a stretch of it, `#xywh=…` a part of its picture) |
| `.film/canvas.json#<node-id>` | a thing in a plugin's own file, by its id |

It is one form both ways. What the person points at reaches the agent as numbered links to where it is (`[1: the
logo](film.html#t=12.5&xywh=…)`, and what is there after the message); the agent points back with Markdown links to the
project, which the chat draws as the same pills. A command prints the same links (`openfilm edit add` prints each new
clip's), and a plugin opens them (`open`, below). Opening one shows the workbench that shows its file (the edit for
`film.html`, the canvas for its boards, a plugin's for the files it claims), which shows the thing and lights it a
moment; a file no workbench claims is pointed out in the library.

So a plugin of yours:

- keeps its things in its own files, each with an `id`; a link to one is its file and `#` its id. No other form.
- shows its files' links in `show(link)` (`provide`, below), read with `links` (`openfilm/studio`): `t=` where its
  things have time, `xywh=` where they have a picture, and lights what the link names for a moment, so it is found.
- leaves the way links are written to the system prompt: a skill of yours says to link what it changed, not how.

## An element: `openfilm/studio`

The module named by `browser` default-exports a custom element (a class that extends `HTMLElement`). Studio defines it,
puts one where the workbench is, and tells it:

- `project-id`: the project shown, for `openfilm/studio`
- `plugin`: its workbench's name, which others put files into it by
- `project`: where the project's files are read and written, as a page is told
- `folder`: the project's folder on this computer

It imports `openfilm/studio` by that name: Studio's page has an import map that names it. It needs no framework and no build.

```js
// ui.js
import { project, topBar, toast, chat, addTo } from 'openfilm/studio';

export default class FileCount extends HTMLElement {
  connectedCallback() {
    const id = this.getAttribute('project-id');
    const of = project(id);
    const draw = () => {
      const state = of.get();
      this.textContent = state ? `${state.name}: ${state.files.length} files` : '…';
    };
    draw();
    this.stop = of.subscribe(draw);
    topBar.set(this.getAttribute('plugin'), { tools: [{ id: 'hello', label: 'Say hello', icon: 'film', onClick: () => toast('Hello') }] });
  }

  disconnectedCallback() {
    this.stop?.();
    topBar.set(this.getAttribute('plugin'), null);
  }
}
```

### What it gives

`version`: `1`. A change that would break a plugin written for it comes with a new number.

**The project.** `project(id)` is the project, the same object each time:

- `get()`: the project as it is now, the same value until something in it changes; `null` until Studio has read it.
  `{ id, name, folder, film, files, made, sources, shown, chat }`:
  - `folder`: its folder on this computer
  - `film`: the address its files are served from, ending in `/` (`film.html` and every file beside it, by path)
  - `files`: its media and its pages as the library lists them: `{ path, name, kind, size, mtimeMs, durationMs?, w?, h?, … }`
  - `made`: how files were made by a service (`openfilm get`), by path: `{ words, by, model?, … }`
  - `sources`: where a file's bytes, poster and waveform are read from: `file(f)`, `poster(f)`, `wave(f)`, `pagePoster(f)`
  - `shown`: the workbench shown, by name (`edit`, `canvas`, a plugin's), or `null`
  - `chat`: the app's chat beside the project, `{ open, toggle() }`, in an app that has one; else `null`
- `subscribe(listener)`: be told each time `get()` changes; returns the way to stop.
- `film.read()`: `film.html` as read: `{ text, rev, value, problems, missing }`; `value` is the film (`{ stage, tracks }`,
  SPEC.md), `null` when the file does not read.
- `film.write(ops, rev)`: write edits, by clip id, as the edit writes them, made against revision `rev` (`null`: whichever is
  there). They are applied to the film as it is: one that moved on meanwhile keeps what was written to it (`rebased: true`),
  and an edit whose clip is gone is refused (the promise rejects with why). The edit shows the result at once. An edit is
  one of `{ op: 'fields', clip, fields }`, `{ op: 'set', clip, field, value }`, `{ op: 'insert', clip: { src, … }, at }`,
  `{ op: 'move', clip, at }`, `{ op: 'remove', clip }` and the others in `studio/server/ops.mjs`.
- `importFiles(files, { into, onProgress })`: bring files of this computer (`File`s) into the project, under `into`
  (`assets`); resolves with where each landed.
- `showFile(path)`: open the library on a file of the project, the file pointed out.

**The page.**

- `toast(message, { error })`: say something at the foot of the page.
- `openSettings(section)`: open Settings, on `general`, `agents`, `models` (the services that make media), `shortcuts`,
  `advanced` or `developer`.
- `topBar.set(owner, { tools })`: buttons on the top bar, before the workbench switch, in place of the ones `owner` put there
  before; `topBar.set(owner, null)` takes them off. A tool is `{ id, label, onClick, icon?, text?, pressed?, disabled? }`:
  an icon (a name as `openfilm.json`'s `icon` gives one: `film`, `folder`, `scissors`, `workflow`, `clapperboard`, `projector`, `spline`, `box`, `audio`,
  `palette`, `layers`) or a few words (`text`), with `label` as its tooltip. The bar draws them itself, so they look like
  its own and work whatever the element is drawn with. Buttons stay until taken off: take them off as the element goes, or
  while it is not the workbench shown (`shown`).

**The app's chat** (the desktop app; in a browser each is `undefined`). `chat.refer(ref)` puts a reference in the message
being written; `chat.select(selection)` says what is selected and where the playhead is (`{ projectId, time, refs }`);
`chat.hover(ref)` says what the pointer is over (`null`: nothing). A reference is `{ kind: 'file', path, fileKind }`,
`{ kind: 'time', time }`, `{ kind: 'clip', id, … }` and so on (`StudioRef` in `studio/ui/src/lib/host.ts`).

**Between workbenches.**

- `addTo(name, paths, { show })`: put files of the project, by path, into the workbench `name` (`addTo('edit', [path])` puts
  them at the end of the film; `show: true` shows that workbench after). Kept until that workbench is there to take them.
- `links`: a link read, as `show` is given one: `links.parse(link)` its path and what after `#` (null: it names nothing
  in the project); `links.time(fragment)` the moment (`{ at }`) or stretch (`{ start, end }`) of its `t=`, and
  `links.box(fragment)` the part of the picture of its `xywh=`, each null when it has none.
- `open(link)`: send the person to what a link names (Links, above): `open('film.html#' + id)` after putting a clip in
  the film shows the edit with it selected.
- `provide(name, { add, command, opens, show, settle, restored })`: what your own workbench takes while it is there;
  returns the way to take it back. `add(paths, { show })` is called for `addTo`; `command(command)` for a command meant
  for it alone. `opens`: the files it shows, as patterns of paths in the project (`film.html`, `.film/canvas.json`,
  `looks/*.cube`, `**/*.cube`: `*` in a name, `**` across folders, matched against the whole path); a link to one of
  them shows your workbench and calls `show(link)` with it. The pattern that names a path most closely wins. Studio
  remembers what a workbench said it opens, so once it has been in the page a link shows it again while it is not.
  The project's version history is Studio's, whichever workbench is shown: `settle()` is called as it opens and before
  it saves a version or puts the project's files back (stop what plays, write what is still waiting; it waits for the
  promise), and `restored()` once a version's files were put back, here or in another window (forget your undo steps,
  read the files again). What was asked of it before it was there is given to it now. `name` is its `plugin` attribute.
- `onCommand(listener)`: the app's commands that are not the page's own and not a link (`{ type: 'highlight', ref }`,
  `{ type: 'show-box', time, box }`, `{ type: 'show-track', track }`…); returns the way to stop. A clip, a moment, a
  stretch, a node or a file the app asks to show is a link, given to the workbench that shows it.

**Blocks.** A workbench whose element runs in Studio's page (OpenFilm's own, or one someone made, once the person lets it
run) can be laid out among the page's panels, as the edit is, instead of taking the whole of the page's middle: its `openfilm.json` says which blocks it draws, and Studio arranges
them with the page's own (the app's chat, the library) and with blocks another workbench draws. The person shows, hides,
sizes and moves them from the layout's menu, as the edit's; each workbench has an arrangement of its own.

```json
"blocks": [
  { "id": "scopes", "title": { "en": "Scopes" }, "edge": "left", "size": 320 },
  { "id": "wheels", "title": { "en": "Wheels" }, "edge": "right", "size": 320, "open": false },
  "edit:viewer", "edit:timeline"
]
```

A block: `id`; `title` by language; `edge`, where it is when the panels are docked: `center` (the main block, one), or
`left`, `right`, `top`, `bottom` of it; `size`, its width beside the main block or its height above or below it, as it
first opens; `open: false` to start hidden; `min`, the smallest it is drawn where panels float (`[width, height]`);
`range`, the sizes a person may give it. `"owner:id"` is a block another workbench draws, as that one declares it (the
edit's are `viewer`, `layers`, `inspector` and `timeline`): the example shows the edit's viewer and timeline beside its
own. `"blocks": "edit"` instead lays the workbench out in the edit's arrangement. The workbench of a plugin someone made
is named by its skill's uid (`local/grade`): its element's `plugin` attribute, the `owner` of its own blocks below.

The element draws each of its blocks into the place Studio gives it:

- `blocks.slot(owner, id)`: the place of block `id` of the workbench `owner` (its `plugin` attribute): an element that is
  the same one for the page's life. Studio puts it wherever the block is in the arrangement shown, and takes it out while
  the block is not there; what is drawn in it stays drawn.
- `blocks.draw(owner, id)`: say the block is drawn; returns the way to say it no longer is. Studio lays a block out only
  while it is drawn.
- `blocks.shown(owner, id)`: whether it is in the arrangement shown now and visible; `blocks.subscribe(listener)` is told
  when that changes, and returns the way to stop.
- `blocks.open(owner, id, open)`: show or hide it in the arrangement shown.

```js
const scopes = blocks.slot('grade', 'scopes');
const stop = blocks.draw('grade', 'scopes');
scopes.append(drawScopes());
```

**A plugin's own server code.** A plugin of OpenFilm's own (`plugins/<id>/`) may bring a `server.mjs` whose routes Studio
answers under `/api/plugins/<id>/…` while the plugin is on (`studio/server/plugin-servers.mjs` says how to write one).
`pluginApi(id)` calls them from the element: `get(path)`, `post(path, body)`, `put(path, body)`, `patch(path, body)` and
`delete(path)` resolve with the route's JSON answer and reject with its error; `events(projectId, listener)` hears what the
server code tells the project's pages (its `studio.emit`), and returns the way to stop.

```js
const notes = pluginApi('notes');
const { text } = await notes.get(`projects/${encodeURIComponent(id)}/note`);
const stop = notes.events(id, (data) => console.log(data));
```

### React

`openfilm/studio/react` is the same for an element drawn with React: `useProject(id)` (the project's `get()`, drawn again as it
changes), `useProvide(name, workbench)`, `useCommand(listener)`, `useTopBar(owner, tools)` and `useBlock(owner, id)` (a
block drawn while the component is there: its `slot`, to draw into with `createPortal`, and whether it is `shown`).

The import map also names `react`, `react/jsx-runtime`, `react-dom` and `react-dom/client`: Studio's own copy. An element that
imports them by those names draws with the same React as Studio. It may bundle its own React instead; it then uses
`openfilm/studio`, not the React layer.

### What is not public

Everything else in Studio's page is OpenFilm's own and may change with any version: its modules, its elements, its classes and
its styles. OpenFilm's edit reaches a little more of the shell than this (how its blocks are sized where they are docked,
the library's actions on its timeline), through a module that is built into it and not named by the import map.
