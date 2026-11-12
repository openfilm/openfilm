---
"openfilm": minor
"@openfilm/desktop": minor
---

The assets drawer's Media has two places: This project (the media of the film you are editing) and Mine (everything
of yours beyond this film, for every film). Mine shows what you keep there and the folders you make in it, to organise
as you like; adding a clip or a file to Mine from the timeline puts it at its top. Upload imports files, taking no
extra room where the disk allows, or links files or a whole folder where they are kept (a NAS, another disk), copying
nothing; a linked folder opens with its own folders as it is on the disk, and taking away the link leaves it as it is.
Other projects' media is not mixed in anywhere; to use something again in the next film, keep it in Mine. The
projects window is back to My projects and Examples.

In the other categories, what you starred is under Mine too.

Your agent knows your media: `openfilm get my-media` searches Mine, through the folders you linked, by name, folder
and prompt, says which projects use each file, and `--take <id>` brings one into the film. It is told to look there
first, before OpenFilm's library and before making anything new.
