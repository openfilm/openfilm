---
"openfilm": minor
---

A workbench plugin tells an agent the film as its own dimension has it with a `look` command: `openfilm <plugin> look [what] [t | a-b]` prints plain text an agent reads (its numbers with their units, what is wrong, what is right) and the path of each picture it saved under the project's `.film/look/<plugin>/`, or one JSON object with `--json`, and exits as `openfilm look` does (0 done, 1 failed, 2 not a project or a wrong command). `openfilm edit look` is the first: it is `openfilm look` as it is. The convention is in `plugins/README.md`; OpenFilm's own plugins follow it with `src/plugin-look.mjs`.
