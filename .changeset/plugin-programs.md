---
"openfilm": minor
---

A plugin can bring a program. The `scripts.start` of a `package.json` in its folder (npm's own field) is a program that stays running while the plugin's workbench is used, and the workbench shows what that program serves: the page and its program talk however they like, so such a plugin can do anything a program on your computer can (read and write the project, run `openfilm` and other plugins' commands, call a model). Studio starts it in the plugin's folder when its workbench is first shown for a project, with `PORT` to serve on, `OPENFILM_PROJECT`, `OPENFILM_PLUGIN` and `OPENFILM_RUN`, and with `node` and `openfilm` on its PATH, so nothing has to be installed. It runs only once you allow it on the plugin's page (off until you do), and is stopped, with all it started, when you turn the plugin off or withdraw that, and whenever Studio closes.
