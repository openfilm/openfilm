---
"openfilm": minor
---

Words on the picture are one thing in Studio: caption tracks. The subtitles Studio drew over the picture from the voices' transcripts, with their own row, switch, style panel and line list, are gone; a project that showed them has them made its caption track as it opens, once, as they looked and where they sat, and is told so. The transcripts beside the media stay as they are.

- The timeline's captions button makes a caption track of what is said in the film, transcribing first the speech that has no transcript yet.
- A caption on the picture is selected with a click (⇧/⌘-click one more or one less) and moved with a drag: every caption of the track with "Apply to all captions" on, the selected ones alone with it off. Its middle snaps to the picture's middle.
- The Inspector of a caption track has the subtitle looks as samples, each a whole look at once; the words said so far lit, where the cues time their words; translation into another caption track at the same times, just above it; and every line of the track to read and correct, the one playing lit. ⌘L refers the selected captions.
- With linkage on, a caption track's cues ride on the main track as titles do: a cue that starts over a shot and crosses at most one cut goes where the shot takes it (a reorder, a ripple, a trim, a new speed) and is deleted with it; one under several shots stays. One undo takes the edit and the captions back together.
- A row holding only the library's texts (name cards, callouts, titles…) is drawn as a caption track is: narrow, each clip by its words. A text of the library dropped on a row of another kind gets a row of text of its own, just above it.
- Exports draw caption tracks as part of the picture: where a film has them, the "burn in" switch gives way to a note that a hidden track is left out. `openfilm render --subtitles` renders a film with caption tracks as it is, and still burns in the subtitles of a project not opened since.
