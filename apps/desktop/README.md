# OpenFilm for desktop

Studio, with a chat beside it for Claude Code, Codex and the other agents, as an Electron app.

## Run from source

```sh
npm start            # builds the window's page, then runs the app as "OpenFilm Dev"
npm test
npm run typecheck
```

Run from source, the app is its own "OpenFilm Dev": its own name, data folder, Studio home and port, so it never
shares anything with an installed OpenFilm. Its renamed copy of Electron lives in `.dev/` (git-ignored).

Codex, Claude Code, the other agents, your own key, and Studio with your own media keys all work.

## Builds

`npm run release` builds the app into `.release/` (git-ignored). Without `OPENFILM_SIGN_IDENTITY` and `APPLE_TEAM_ID`
it is unsigned. Like a run from source, it never looks for updates: the feed comes from the `openfilm` package's
`product.json`, empty in the repository. Official builds, signed, notarized and
published, are produced by the project's release pipeline; see TRADEMARK.md before distributing a build of your own.
