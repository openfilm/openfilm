---
name: openfilm-canvas
description: The project's canvas in OpenFilm, the board beside the edit. Read it when the person asks for the canvas or points at a canvas node (`canvas node `ID``), or to lay out ideas, references and shots before they go into the film.
---

# The canvas

The canvas is the board beside the edit where the person lays out notes, files and nodes that make a picture, a clip or
a sound, wired into each other. Nothing on it is in the film. A node the person points at (`canvas node `ID``) is there.

`npx openfilm canvas` prints the board; `npx openfilm canvas apply '<steps>'` adds, changes, wires and removes nodes, and
the person sees it at once. Its `--help` lists the steps.
