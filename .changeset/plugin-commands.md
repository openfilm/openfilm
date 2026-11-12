---
"openfilm": minor
---

A skill or a plugin can bring commands. The `bin` of a `package.json` in its folder (npm's own field) names them, and `openfilm <name> <command> …` runs one, for your agent, for you in a terminal, and for plugins alike: this is how one does something for others that changing a file cannot do. A `bin` that is a single file is one command, run as `openfilm <name> …`. The command is given the words after its name, and `OPENFILM_PROJECT` (the project around the folder it was run in), `OPENFILM_PLUGIN` (its own folder) and `OPENFILM_RUN` (how `openfilm` is typed there); what it prints and its exit status are its own. Its page in the library shows its commands; while it is turned off they do not run. Bringing commands does not make a skill a plugin: a skill shows only in the conversation, and a plugin is one that also shows outside it, with a workbench of its own.
