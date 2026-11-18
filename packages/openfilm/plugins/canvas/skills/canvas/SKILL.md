---
name: canvas
description: The project's canvas in OpenFilm, the board beside the edit. Read it when the person asks for the canvas or points at a canvas node, asks for a storyboard, shots, a character, or to lay out ideas, references and shots before they go into the film.
---

# The canvas

The canvas is a board beside the edit: notes, the project's files, and nodes that make a picture, a clip or a sound,
wired into each other. Nothing on it is in the film until it is put on the timeline. A node is pointed at, by the
person and by you, with a link to its board's file and its id: `.film/canvas.json#n7`. A project can have several
canvases; your steps go to the one the person has open.

`openfilm canvas` prints the board. `openfilm canvas apply '<steps>'` adds, changes, wires and removes nodes, all at
once, and the person sees it at once; `openfilm canvas --help` lists the steps. `openfilm canvas add <file…>` puts
files of the project on it in a row.

## Laying out what the person asks for

- **A storyboard or shots**: one row per shot, left to right: a note (what happens, in the person's words), a picture
  node wired from it, and a video node wired from the picture with `opts.mode: "first"`. Wire every video into one
  `cut`, in order: its "Put on the timeline" sends the clips in that order. With many shots, keep each in a group
  named after it (`around`).
- **A character who looks the same in every shot**: a note of who they are, a picture node with `preset: "portrait"`
  wired from it, then `fullBody`, `expressions` and `turnaround16` pictures each wired from the note and the portrait,
  in a group named after them. Wire the portrait into every shot's picture and video (`opts.mode: "refs"`).
- **A voice-over**: a `tts` node whose prompt is the line to speak, with `opts.voice` a voiceId from
  `openfilm get voice` that suits the speaker.
- **A node's prompt**: in English unless the person writes otherwise; what is seen, the light and the camera, not
  the story's meaning.

Lay things out and leave the making to the person: they press Make, or a group's Make all. Make a node only when
they ask: with `openfilm get`, then add the file as its version (`"op": "version"`). Say what you laid out and what to
press.

A making node says what it makes with (`--via`, `--model` and its options): what the person picked. Make it anew with
the same, at the same ratio, quality and size, unless the person names another model, and say which you used.
