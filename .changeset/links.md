---
"openfilm": minor
"@openfilm/desktop": minor
---

Links name a thing of the project, and Studio opens one wherever it comes from: `film.html#<clip-id>` shows the edit with the clip selected and the playhead at its start, `film.html#t=12.5` a moment, `film.html#t=3,6` a stretch, `.film/canvas.json#<node-id>` the canvas on the node, and a file no workbench shows is pointed out in the library. A plugin sends the person to one with `open(link)` from `openfilm/studio`, and its workbench says which files it shows (`provide`'s `opens`, patterns of paths in the project) and shows what a link to one names (`show`). A clip, a moment, a stretch or a node the app's chat points at now shows the workbench it is in, so a clip referenced while the canvas is shown brings the edit back. In the desktop app, a link to the project in an agent's reply opens it in Studio instead of a browser tab.
