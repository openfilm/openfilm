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

It connects to no account service: the `openfilm` package's `product.json` is empty in the repository, and Settings →
Agents and Settings → Providers show the OpenFilm account as not available in this build. Everything else works: Codex,
Claude Code, your own key, and Studio with your own media keys. To connect to an account service, set
`OPENFILM_ACCOUNT_URL`, `OPENFILM_ACCOUNT_ISSUER` and `OPENFILM_ACCOUNT_CLIENT_ID` before `npm start`.

## Builds

`npm run release` builds the app into `.release/` (git-ignored). Without `OPENFILM_SIGN_IDENTITY` and `APPLE_TEAM_ID`
it is unsigned. Like a run from source, it connects to no account service and never looks for updates: both come
from the `openfilm` package's `product.json`, empty in the repository. Official builds, signed, notarized and
published, are produced by the project's release pipeline; see TRADEMARK.md before distributing a build of your own.
