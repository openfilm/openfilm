---
name: canvas
description: The project's canvas in OpenFilm, the board beside the edit. Read it when the person asks for the canvas or points at a canvas node (`canvas node `ID``), asks for a storyboard, shots, a character, or to lay out ideas, references and shots before they go into the film.
---

# The canvas

The canvas is the board beside the edit where the person lays out notes, files and nodes that make a picture, a clip or
a sound, wired into each other. Nothing on it is in the film until it is put on the timeline. A node the person points
at (`canvas node `ID``) is there. A project can have several canvases; your steps go to the one the person has open.

`openfilm canvas` prints the board; `openfilm canvas apply '<steps>'` adds, changes, wires and removes nodes, all at
once, and the person sees it at once. Its `--help` lists the steps.

## Laying out what the person asks for

- **A storyboard or shots**: one row per shot, left to right: a note (what happens, in the person's words), a picture
  node wired from it, a video node wired from the picture with `opts.mode: "first"`, and every video wired into one
  `cut` in order: the cut's "Put on the timeline" sends the clips in that order. Keep each shot in a group named after
  it (`around`) when there are many.
- **A character who looks the same in every shot**: a note of who they are, a picture node with `preset: "portrait"`
  wired from it, then `fullBody`, `expressions` and `turnaround16` picture nodes each wired from the note and the
  portrait, in a group named after them. Wire the portrait into every shot's picture and video (`opts.mode: "refs"`
  or as a reference) so they stay the same person.
- **A voice-over**: a `tts` node whose prompt is the line to speak, with `opts.voice` a voiceId from
  `openfilm get voice` that suits the speaker (none: the service's first voice in the person's language).
- **Words for a node**: write the prompt in English unless the person writes otherwise; describe what is seen, the
  light and the camera, not the story's meaning.

Lay things out and leave the making to the person (they press Make, or a group's Make all) unless they ask you to make
them: then make each with `openfilm get` and add it as the node's version. Say what you laid out and what to press.
