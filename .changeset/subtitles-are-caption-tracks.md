---
"openfilm": minor
---

Words on the picture are one thing in Studio: caption tracks. The subtitles Studio drew over the picture from the voices' transcripts, with their own row, switch, style panel and line list, are gone; a project that showed them has them made its caption track as it opens, once, as they looked and where they sat, and is told so. The transcripts beside the media stay as they are.

- The timeline's captions button makes a caption track of what is said in the film, transcribing first the speech that has no transcript yet.
- A caption on the picture is selected with a click (⇧/⌘-click one more or one less) and moved with a drag: every caption of the track with "Apply to all captions" on, the selected ones alone with it off. Its middle snaps to the picture's middle.
- A caption track is a CC track: its head says CC, its row is narrow and each caption shows its words. Its Inspector has three tabs, Style, Motion and Captions, under a choice of what they change, All captions or The ones picked. Style: the picked caption's words, the looks as samples (each a whole look at once), size, weight, color, outline, background, and its place (top, middle, bottom, a height, or a drag on the picture, its frame following the drag). Motion: how a caption comes in (fade, rise, pop) and, where words are timed, how they are said (lit, or shown one by one). Captions: every line to read and correct, the one playing lit, translation into another caption track at the same times just above it, and deleting the picked. ⌘L refers the selected captions.
- A row holding only the library's texts (name cards, callouts, titles…) is drawn as a caption track is: narrow, each clip by its words. A text of the library dropped on a row of another kind gets a row of text of its own, just above it, and a text put in without a box of its own gets its shape's box rather than covering the whole picture.
- Track heads show what their row holds as a plain icon (text, pictures, footage, voice, sound effects, music) instead of a P1 / V1 / A1 badge, and tracks have no names.
- The editing skill says what Studio makes of a voice's words: a caption track, when the person asks for captions.
- Exports draw caption tracks as part of the picture: where a film has them, the "burn in" switch gives way to a note that a hidden track is left out. `openfilm render --subtitles` renders a film with caption tracks as it is, and still burns in the subtitles of a project not opened since.
