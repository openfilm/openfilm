# OpenFilm for desktop

Studio, with a chat beside it for Claude Code, Codex and the other agents, as an Electron app.

## Run from source

```sh
npm start            # builds the window's page, then runs the app as "OpenFilm Dev"
npm test
npm run typecheck
```

`node bench/media-menu.test.mjs` builds and checks empty and populated media-pane menus in an isolated Electron app, with file pickers cancelled.

`node bench/browser.test.mjs` builds and checks the browser (src/browser.mjs) in an isolated Electron app: what a web
page is kept from (the app, Studio, this computer and its network), what it must ask the person for, and where it is drawn.

`node bench/browser-agent.test.mjs` builds and checks the agents' door to it (src/browser-door.mjs) the same way: an MCP
client opens a test page in its project's tabs, reads it, clicks a link, gets a screenshot, has a form held for the
person, and is refused another project's tab.

Run from source, the app is its own "OpenFilm Dev": its own name, data folder, Studio home and port, so it never
shares anything with an installed OpenFilm. Its renamed copy of Electron lives in `.dev/` (git-ignored).

Codex, Claude Code, the other agents, your own key, and Studio with your own media keys all work.

## Builds

`npm run release` builds the app into `.release/` (git-ignored). Without `OPENFILM_SIGN_IDENTITY` and `APPLE_TEAM_ID`
it is unsigned. Like a run from source, it never looks for updates: the feed comes from the `openfilm` package's
`product.json`, empty in the repository. Official builds, signed, notarized and
published, are produced by the project's release pipeline; see TRADEMARK.md before distributing a build of your own.
