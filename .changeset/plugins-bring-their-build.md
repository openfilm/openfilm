---
"openfilm": patch
---

OpenFilm's own plugins bring their workbench's build entry and their own words: the workbenches Studio's page and the desktop app's window build are read from each plugin's `browser` module (its source in `studio/ui/src/plugins/<id>/`), and a plugin's `i18n/<language>.json` words are looked up as `plugin.<id>.…`, in English where a language leaves one out. An official plugin's workbench other than the edit and the canvas now shows its element in the panes' place.
