---
"openfilm": minor
"@openfilm/desktop": minor
---

The assets drawer's Media has two places: This project (the media of the film you are editing) and My media
(everything of yours beyond this film). My media is your own library: Favorites first, where a clip or file you add to
Favorites goes, then the folders you make beside it ("New folder", named at once; renamed or deleted from its menu,
the Trash keeping it), and folders of this computer you link ("Link a folder"), which stay where they are and are not
copied. In each folder, upload files or drop them in. What lay loose at the top of Saved before moves into Favorites.
Other projects' media is not mixed in anywhere; to use something again in the next film, keep it in My media.

A linked folder shows as it is on your disk, with its own folders to open, at once however large it is; one on a disk
that is not plugged in says so. Nothing is copied or moved by looking: click a file to watch it, drag it onto the
timeline or double-click it to put it in the film, and only then does it come into the project, taking no extra room
where the disk allows. Move the pointer across a video to look through it. Its search looks through all of My media by
a file's name, its folders and, for media a service made, its prompt. A file's menu moves it to any other folder of My
media, renames it where it is, or moves it to the Trash (you are told first which projects link to it); what Favorites
keeps of the timeline (a clip, a group, a component) stays in My media's own folders.

The other categories put what is yours first the same way: Mine, with Favorites (what you starred) under it.

Your agent knows your media: `openfilm get my-media` searches Saved and your folders by name, folder and prompt, says
which projects use each file, and `--take <id>` brings one into the film. It is told to look there first, before
OpenFilm's library and before making anything new.
