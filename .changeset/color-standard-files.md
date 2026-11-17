---
"openfilm": minor
---

A clip's grade is now standard color files: `--of-lut` takes OpenColorIO `.ctf`, Academy/ASC `.clf` and `.cube` files in order, evaluated as OpenColorIO 2.6 evaluates them. OpenFilm brings input transforms for sixteen kinds of footage (ordinary video, HLG, PQ and thirteen cameras' log) into ACEScct and the ACES 2.0 output to the screen, so a grade is written in one working space whatever the camera. While a graded copy is made, the preview draws the grade live; a copy holds only the stretch of the file the clip plays, and a clip graded and otherwise plain is exported straight from it.

A video clip's color in the inspector is these files too: temperature, tint, exposure, contrast, highlights, shadows and saturation are written into the clip's own layer, and a filter of the library is a file made for the screen at the end of its chain, with its strength. Dragging shows the grade on the picture as it goes; letting go writes it, one step of the undo with the film. An agent's change to a color file shows at once, without drawing the whole picture again. ⇧D shows every video as its file is, and again graded.

`openfilm color` is five commands for what an agent cannot do by writing a file: `look` measures each clip as it plays and its jump from the clip before, `input` says and sets what footage is, `balance` makes a clip's greys grey at a usual exposure, `match` brings shots of one scene to another's color, and `filter` lists the library's filters and puts one on. `show`, `set`, `auto`, `copy` and `reset` are gone: grades are files an agent reads and writes.
