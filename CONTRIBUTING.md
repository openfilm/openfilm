# Contributing

Thanks for helping. Issues and pull requests are welcome. Everything here runs on your machine with your own keys:
nothing else is needed to run it, change it or test it.

## Quick start

You need Node 22.18 or later (the tests run TypeScript directly), pnpm 9 (`corepack enable` gives you the version
this repository names in package.json), ffmpeg on the PATH, and git.

```sh
git clone https://github.com/openfilm/openfilm && cd openfilm
pnpm install                 # also builds Studio's editor (packages/openfilm: build:ui)
pnpm --filter openfilm exec playwright-core install chromium-headless-shell
pnpm dev                     # Studio from this checkout, with a sample film
pnpm test
```

From the root:

| Command | What it does |
| --- | --- |
| `pnpm dev` | Studio from source (packages/openfilm's `dev`), apart from an installed OpenFilm |
| `pnpm dev:desktop` | the desktop app from source, as "OpenFilm Dev" |
| `pnpm test` | every package's tests |
| `pnpm typecheck` | every package's types |
| `pnpm build` | Studio's editor and the desktop app's window |
| `pnpm audit:public` | what must not be in a public repository: secrets (gitleaks), home folders, paths out of the repository, prose in another language than English outside the translations, dependencies outside this workspace |
| `pnpm check:pack` | packs `openfilm` as npm would get it, lists its files and checks them |
| `pnpm changeset` | adds a changeset to your pull request (below, Releases) |

`pnpm --filter <package> <script>` runs one package's script; the packages are `openfilm`, `@openfilm/shared` and
`@openfilm/desktop`.

## Layout

```
packages/openfilm/   npm `openfilm`: the format, the CLI and Studio
  SPEC.md, MANUAL.md   the film format; the manual `openfilm` prints for agents
  bin/                 the `openfilm` command
  src/                 reading film.html, the host that draws frames in a headless browser, look and render
  studio/server/       Studio's server: projects, edits, history, exports, media providers
  studio/ui/           Studio's editor (React, built with Vite into studio/ui/dist, which the server serves)
  studio/client.mjs    how the command finds or starts Studio
  test/                pages the tests draw
  scripts/             `pnpm dev`; product.mjs (which build the package is, below)
packages/shared/     `@openfilm/shared`: what the desktop app's chat shares with its main process (not published)
apps/desktop/        the desktop app (Electron)
  src/                 the main process: windows, Studio, the agents, updates
  shell/               the window's page: Studio's editor (from packages/openfilm) with the chat beside it
  chat/                the chat (React)
  scripts/             start (from source) and release (a build)
skills/              the skill that points coding agents to the manual
scripts/             the public audit, the package check
docs/                pictures for the README
```

## packages/openfilm: the format, the CLI and Studio

`pnpm dev` runs Studio on port 4848, with its state and exports in `packages/openfilm/.dev/` (git-ignored), beside an
OpenFilm you have installed; its projects are in the library every OpenFilm shares. It opens a sample film in your browser, rebuilds the editor
when `studio/ui` changes (reload the page), and restarts Studio when `studio/server` or `src` change. Ctrl+C stops it.

`pnpm --filter openfilm test` runs its tests and `pnpm --filter openfilm typecheck` checks the server's and the
editor's types. One file, or one test in it, from `packages/openfilm`:

```sh
node --test src/film-doc.test.mjs
node --test --test-name-pattern="split" studio/server/film.test.mjs
```

### Trying a change with a coding agent

While `pnpm dev` runs, `packages/openfilm/.dev/bin/openfilm` (`openfilm.cmd` on Windows) is your checkout's command
on that Studio. Ask Codex, Claude Code or any coding agent for a film and tell it to run that command instead of the
skill's `npx -y openfilm@latest` (the release); the manual names the same command, so it keeps using it. Your films
appear in the Studio `pnpm dev` opened. Its state is in `packages/openfilm/.dev/` and its port is its own, so an
installed OpenFilm, its Studio on port 4747 and `~/.openfilm` are left alone; projects are the one thing they share:
every OpenFilm uses the same library, the one Studio's Settings chose (kept in `~/.openfilm/prefs.json`, which
`OPENFILM_SHARED_HOME` points it at), by default `~/Movies/OpenFilm/Projects` on macOS. A test that must stay apart
sets `OPENFILM_LIBRARY` and leaves `OPENFILM_SHARED_HOME` unset.

To make your checkout the `openfilm` your agents use everywhere, `npm link` in `packages/openfilm` (`npm unlink -g
openfilm` undoes it). That one shares `~/.openfilm` and port 4747 with an installed OpenFilm; of two Studios, the
newer version replaces the older.

## packages/shared: what the clients share

`@openfilm/shared` holds what the desktop app's chat reads: a chat turn and its events, how an agent's activity
reads, prompt references, title limits and Markdown parsing.

`pnpm --filter @openfilm/shared test`, `pnpm --filter @openfilm/shared typecheck`. It is not published: the
workspace reads its TypeScript in `src/` as it is, and the desktop app bundles it.

## apps/desktop: the desktop app

```sh
pnpm dev:desktop                              # builds the window's page, then runs the app as "OpenFilm Dev"
pnpm --filter @openfilm/desktop test
pnpm --filter @openfilm/desktop typecheck
```

Run from source, the app is its own "OpenFilm Dev": its own name, data folder, Studio home and port, so it never
shares a window or a Studio with an installed OpenFilm. Its projects are in the same library as every OpenFilm's.
Its renamed copy of Electron lives in `apps/desktop/.dev/` (git-ignored), signed only for this machine: you need no
certificate to run or change it. Its window's page imports Studio's editor
from `packages/openfilm` as source, so a change to Studio shows in the app at its next start.

`pnpm --filter @openfilm/desktop release` builds an installable app into `apps/desktop/.release/` (git-ignored),
unsigned unless `OPENFILM_SIGN_IDENTITY` and `APPLE_TEAM_ID` are set. A build you make is yours to try; before you
distribute one, read [TRADEMARK.md](TRADEMARK.md): a fork published as its own needs its own name and icon.

## The update feed and product.json

`packages/openfilm/product.json` says where the desktop app looks for updates. It is empty in the repository, so a
desktop build of your own never looks for them. The official feed is in `product.official.json`; the package npm
publishes and the official desktop app carry it. Media services are connected with your own keys: in Studio,
Settings → Providers, or each service's variable in the environment (`ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, …).

## Releases

Every pull request that changes what a package's users get carries a **changeset**: run `pnpm changeset`, pick the
packages it changes (`openfilm`, `@openfilm/desktop`, `@openfilm/shared`) and how much (`patch` for a fix, `minor`
for something new; `major` only by agreement), and write a line for the changelog, as a user would read it. Commit the
file it writes in `.changeset/`. A change to tests, docs or CI alone needs none (`pnpm changeset --empty` says so).
Each line in the changelog links its pull request and thanks its author.

All the packages share one version. When changesets reach `main`, the release workflow opens a "Version packages"
pull request that bumps it and writes the changelogs; merging it publishes `openfilm` to npm (with provenance, from CI
only). Then a maintainer pushes the tag `v<version>`: the desktop workflow builds the app, signs and notarizes it, and
makes a draft GitHub release with the installers. Publishing that release makes it the latest, which the website's
download links and the apps' update checks follow.

## Where to start

Issues labeled `good first issue` are small and say what is needed; `help wanted` ones are bigger. Say on the issue
that you are taking it, and open one before starting a large change, so nobody does it twice. Questions go to
[Discussions](https://github.com/openfilm/openfilm/discussions).

## What we keep small

- **The manual** ([MANUAL.md](packages/openfilm/MANUAL.md)), what `openfilm` prints for agents, holds three things:
  what a film is, the one rule (the picture depends only on t), and how the tools are used. No style advice or
  methods. If an agent gets something wrong, a word is added only when the manual was ambiguous; if a tool behaved
  oddly, the tool is fixed.
- **The format** ([SPEC.md](packages/openfilm/SPEC.md)): a new attribute of `film.html` is read in one place,
  [src/film-doc.mjs](packages/openfilm/src/film-doc.mjs), and described in the spec in the same pull request.
- **No adapters.** Pages use the web as it is; libraries load from pinned public CDNs.

## Adding a media provider

A provider is one file in [studio/server/providers/](packages/openfilm/studio/server/providers/) that keeps the
contract in `contract.mjs`, listed in `OWN` in `index.mjs`; [groq.mjs](packages/openfilm/studio/server/providers/groq.mjs)
is a small one to start from. Its pull request comes with:

- **Tests against a fake service** on 127.0.0.1, as `groq.test.mjs` does: what is sent, what lands in the project, and
  what the person is told when it fails. CI runs them with no key.
- **What the real service did**, in the description: the commands you ran with your own key, what they printed, and
  a sample of what it made (an audio file, a picture). **Never a key**: not in the code, the tests, the description
  or a screenshot. We do not ask for one.
- **Its mark** in [lib/provider-marks.ts](packages/openfilm/studio/ui/src/lib/provider-marks.ts), from
  [Lobe Icons](https://github.com/lobehub/lobe-icons) or [Simple Icons](https://simpleicons.org) (a test holds every
  provider to having one).
- **Every word it shows in Studio** in all five languages: en, zh-CN, ja, ko and es. A key in a format of its own
  (a region with it, say) says so where it is pasted.
- **A changeset**.

Maintainers try a provider with their own key when they have one; otherwise it is merged on its tests and on what you
showed. When a service changes and its provider breaks, whoever added it is asked first.

## Pull requests

Keep each one to one change, with a test when it fixes a bug. `pnpm test` and `pnpm typecheck` must pass on macOS,
Windows and Linux (CI runs all three, and all three must pass), and `pnpm audit:public` must find nothing. A
maintainer reviews every pull request, and may ask for changes. It is squash-merged, so its title becomes the
commit's: name the part and the change, as the history does (`Studio: …`, `CLI: …`, `Desktop: …`). Add a changeset
when the change ships (above, Releases).

## License

What you contribute is under the [MIT license](LICENSE), like the rest of the code. There is no agreement to sign.

Be kind: see the [code of conduct](CODE_OF_CONDUCT.md). To report a security issue, see [SECURITY.md](SECURITY.md).
