---
"openfilm": minor
"@openfilm/desktop": minor
---

The assets drawer's Media has three places, each with one job: This project (the media of the film you are editing),
Saved (what you keep to use in every film: your logo, an intro, a watermark, music you always use) and This computer
(the folders you keep footage, pictures and sound in). Other projects' media is not mixed in anywhere; to use
something again in the next film, keep it in Saved.

This computer shows the folders you add as they are on your disk, with their own folders to open, at once however
large they are; a folder on a disk that is not plugged in says so. Nothing is copied or moved by looking: click a file
to watch it, drag it onto the timeline or double-click it to put it in the film, and only then does it come into the
project, taking no extra room where the disk allows. Move the pointer across a video to look through it. The search
looks through all your folders by a file's name, its folders and, for media a service made, its prompt. A file's
menu shows it in the file manager, renames it where it is, or moves it to the Trash (you are told first which projects
link to it). The projects window is back to My projects and Examples.

Your agent knows your media: `openfilm get my-media` searches what you kept in Saved and your folders on this computer
by name, folder and prompt, says which projects use each file, and `--take <id>` brings one into the film. It is told
to look there first, before OpenFilm's library and before making anything new.
