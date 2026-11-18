---
"openfilm": minor
---

Anyone can make a plugin: a skill with a web page at its folder's root (`index.html`) is one. It is added as a skill is (a folder, a link, a project's own `skills/`), listed in the library's Plugins tab instead of among your Skills, and turned by one switch: on, your agent is given the skill and its page is a workbench you can switch to from the top bar, shown beside the library. The page runs on an origin of the plugins' own: it is told where the project's files are (`?project=`), reads them with GET, and writes them with PUT once you allow it on the plugin's page (off until you do). It cannot reach the editor, and a film's own pages still cannot write anything. Studio also remembers which plugin's workbench each project was left on.
