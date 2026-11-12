---
"openfilm": minor
---

A plugin can bring commands. The `bin` of a `package.json` in its folder (npm's own field) names them, and `openfilm <plugin> <command> …` runs one, for your agent, for you in a terminal, and for other plugins alike: this is how a plugin does something for others that changing a file cannot do. A `bin` that is a single file is one command, run as `openfilm <plugin> …`. The command is given the words after its name, and `OPENFILM_PROJECT` (the project around the folder it was run in), `OPENFILM_PLUGIN` (its own folder) and `OPENFILM_RUN` (how `openfilm` is typed there); what it prints and its exit status are its own. A skill with commands is listed in the library's Plugins tab, with or without a page, and its page there shows its commands; while it is turned off they do not run.
