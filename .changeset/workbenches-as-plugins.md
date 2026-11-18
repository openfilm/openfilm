---
"openfilm": minor
---

The edit and the canvas are now plugins like anyone's: each comes as the element its plugin brings (`plugins/edit`, `plugins/canvas`), and Studio's page puts in only the workbenches of the plugins that are on. With the Edit plugin turned off from the start, its code is not loaded at all; one turned off while in use stays as it was left, and comes back with its selection, playhead and undo steps when turned on again. The project's page itself (the top bar, the library, the layout, opening and reading the project, the app's chat commands) no longer depends on any workbench, so a page with only the canvas on, or with every plugin off, is complete.
