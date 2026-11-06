---
"openfilm": minor
"@openfilm/desktop": minor
---

Every skill has a uid, whose it is and its name: `openfilm/keynote` for OpenFilm's, `river/keynote` for one added from River's GitHub (`gitlab-<group>/…` from GitLab), `local/…` for one made here or added from a folder, `project/…` for a project's own. The owner is read from where the skill came from, never from what it says of itself, so none can pass for OpenFilm's. Names can repeat: two skills of a name are had side by side, each turned on and off, opened and removed by its uid, and the same skill added again replaces only itself. An agent, which reads skills by name alone, is given the first of a name by it (the project's, then the person's, then the official one) and the others as `owner-name`. OpenFilm's own skills are `openfilm/edit`, `openfilm/media` and `openfilm/canvas`. `openfilm skills` lists skills by uid and `openfilm skill <owner/name>` prints one. In Studio's library each installed skill is a line with its uid under its title, in parts headed with their counts, Import beside the search; a search finds a skill by its uid too.
