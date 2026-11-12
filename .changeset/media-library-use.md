---
"openfilm": minor
"@openfilm/desktop": minor
---

The assets drawer's Media has two places: This project (the media of the film you are editing) and My media
(everything of yours beyond this film). My media opens to Saved, what you keep to use in every film (your logo, an
intro, a watermark, music you always use, and the clips you save from the timeline), and then the folders of this
computer you add. Other projects' media is not mixed in anywhere; to use something again in the next film, keep it in
My media.

A folder you add shows as it is on your disk, with its own folders to open, at once however large it is; one on a disk
that is not plugged in says so. Nothing is copied or moved by looking: click a file to watch it, drag it onto the
timeline or double-click it to put it in the film, and only then does it come into the project, taking no extra room
where the disk allows. Move the pointer across a video to look through it. The search looks through all of My media
by a file's name, its folders and, for media a service made, its prompt. A file's menu shows it in the file manager,
renames it where it is, moves it between Saved and your folders, or moves it to the Trash (you are told first which
projects link to it). A folder's menu in the side bar stops showing it; the folder itself stays as it is. The projects
window is back to My projects and Examples.

Your agent knows your media: `openfilm get my-media` searches Saved and your folders by name, folder and prompt, says
which projects use each file, and `--take <id>` brings one into the film. It is told to look there first, before
OpenFilm's library and before making anything new.
