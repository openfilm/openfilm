---
"openfilm": patch
"@openfilm/desktop": patch
---

In the app, the person's service keys are kept sealed in `~/.openfilm/providers.json` with a key only the system's keychain opens for the app (macOS Keychain, Windows DPAPI), so an agent, skill or plugin command reading the file gets nothing usable. Keys kept plain by an older OpenFilm or `npx openfilm` are sealed when the app starts; those builds still read and write the file, but do not see the sealed keys. Each sealed key opens only for the service it was saved for. Studio's own key stays in the app's memory: `run.json` names only the agents' key, which the `openfilm` command sends as it is, and `openfilm open` gives an agent an address with its own key. The app's own agent gets its models' keys over a private pipe, not its environment, so no command it runs sees them, and Claude Code is told not to read Studio's key files. `npx openfilm` on its own still keeps keys plain, readable by this user only.
