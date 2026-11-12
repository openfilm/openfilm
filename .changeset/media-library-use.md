---
"openfilm": minor
"@openfilm/desktop": minor
---

The assets drawer's Media has two places: This project (the media of the film you are editing) and Mine (everything
of yours beyond this film, your own library). Mine opens to Favorites, where a clip or file you add to Favorites goes,
then the folders you make beside it: "New folder", named at once, renamed or deleted (to the Trash, after asking) from
its menu. In any of them, Upload imports files, taking no extra room where the disk allows, or links files or a whole
folder where they are kept (a NAS, another disk), copying nothing; a linked folder opens with its own folders as it
is on the disk, and taking away the link leaves it as it is. A file moves between your folders from its menu (Move
to). What lay loose at the top of Saved moves into Favorites, and a folder added to your media before is linked at
the top of Mine. Other projects' media is not mixed in anywhere; to use something again in the next film, keep it in
Mine.

The other categories put what is yours first the same way: Mine, with Favorites (what you starred) under it.

Your agent knows your media: `openfilm get my-media` searches Mine, through the folders you linked, by name, folder
and prompt, says which projects use each file, and `--take <id>` brings one into the film. It is told to look there
first, before OpenFilm's library and before making anything new.
