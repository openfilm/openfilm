---
"openfilm": minor
---

A plugin's workbench can now be part of the app itself. The `browser` of a `package.json` in its folder (npm's own field for what a browser loads) names a JavaScript module whose default export is a custom element (a class that extends `HTMLElement`); Studio loads the module into its own page and puts the element where the workbench is, with `project-id`, `project` (where the project's files are read and written) and `folder` as attributes. Such a workbench is not in a frame, so nothing is out of its reach: its menus can open over the library, it reads what is dragged from the library, it inherits the app's colors as CSS variables, and it can call every request the editor itself makes. It runs with that much access, so only once you allow it on the plugin's page. A page (`index.html`) stays the way to make one that needs no such trust.
