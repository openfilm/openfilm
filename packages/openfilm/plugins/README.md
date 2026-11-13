# Making a plugin

A plugin teaches OpenFilm one more kind of work. It is a folder: what an agent is taught (a skill), and what shows outside the
conversation (a workbench in Studio, commands). OpenFilm's own plugins are the folders beside this file (`edit`, `canvas`,
`motion`…), and they are made the same way as anyone's.

Only in the conversation, it is a skill; also outside it, a plugin.

## The folder

```
my-plugin/
  SKILL.md        what an agent is taught: front matter with `name` and `description`, then the way to work
  openfilm.json   how people see it (optional): `title`, `summary`, `icon`, by language
  package.json    what runs (optional): `browser`, `bin`, `scripts.start`
  index.html      a page shown as its workbench (optional)
```

Put it in your Skills folder (`~/Movies/OpenFilm/Skills` on macOS, `~/Videos/OpenFilm/Skills` elsewhere; `OPENFILM_SKILLS`
names another), or in a project's `skills/` folder to keep it with that project. The library's Plugins tab lists it, with
its switch.

A workbench is one of three things, the first one found:

| `package.json` | What it is | What it reaches |
|---|---|---|
| `browser`: a JavaScript module | A custom element, loaded into Studio's own page and put where the workbench is | `openfilm/studio` (below), as OpenFilm's own workbenches do |
| `scripts.start`: a command line | A program started in the plugin's folder, serving its workbench on `PORT` (host `127.0.0.1`); `OPENFILM_PROJECT` is the project's folder | Whatever it serves |
| (none) and `index.html` | A web page, shown in a frame on an origin of its own, told where the project's files are by `?project=` | The project's files, read there, and written (PUT) once the person lets it |

An element or a program runs only once the person lets the plugin run; nothing writes the project's files before they say so.

`bin` gives commands: `"bin": { "look": "look.mjs" }` is `openfilm my-plugin look`, for an agent and for other plugins alike.
A `bin` that is one file is one command, `openfilm my-plugin`.

A film never depends on a plugin. What a plugin writes into `film.html` is standard HTML and CSS and files of the project,
so the film plays and renders with the plugin off.

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
  an icon (a name as `openfilm.json`'s `icon` gives one: `film`, `folder`, `scissors`, `workflow`, `clapperboard`, `audio`,
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
- `provide(name, { add, command })`: what your own workbench takes while it is there; returns the way to take it back.
  `add(paths, { show })` is called for `addTo`; `command(command)` for a command meant for it alone. What was asked of it
  before it was there is given to it now. `name` is its `plugin` attribute.
- `onCommand(listener)`: the app's commands that are not the page's own (`{ type: 'seek', time }`, `{ type: 'select-clip', id }`,
  `{ type: 'highlight', ref }`…); returns the way to stop.

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
changes), `useProvide(name, workbench)`, `useCommand(listener)` and `useTopBar(owner, tools)`.

The import map also names `react`, `react/jsx-runtime`, `react-dom` and `react-dom/client`: Studio's own copy. An element that
imports them by those names draws with the same React as Studio. It may bundle its own React instead; it then uses
`openfilm/studio`, not the React layer.

### What is not public

Everything else in Studio's page is OpenFilm's own and may change with any version: its modules, its elements, its classes and
its styles. OpenFilm's edit reaches a little more of the shell than this (its panes' layout, the library's actions on its
timeline), through a module that is built into it and not named by the import map.
