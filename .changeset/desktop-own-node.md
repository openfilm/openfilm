---
"@openfilm/desktop": patch
"openfilm": patch
---

Desktop: the agents' adapters, OpenFilm's own agent, the `openfilm` command the agents run and the programs Studio starts now run on a Node the app brings (Node 24, signed to run JavaScript and nothing more), not on the app itself run as Node. The app can no longer be run as Node at all (Electron's RunAsNode fuse is off, as in Claude's app), so no other program on your computer can run code as OpenFilm and use the microphone or camera you let OpenFilm use.
