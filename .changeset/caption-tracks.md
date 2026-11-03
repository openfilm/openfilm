---
"openfilm": patch
---

Caption tracks: a track in film.html can hold one `<track kind="captions" src="captions/….vtt">`, a standard WebVTT file on the film's time, and the film draws its cues over the tracks below it. The look is the CSS of the file's STYLE blocks: `::cue` for the whole track, `::cue(#c3)` for one cue, `<c.em>` spans, voices, and word timestamps with `:past` / `:future`. Any CSS property works there, animations included. Cue settings and REGION place the cues. Preview, `look` and exports all draw them, and SRT/VTT files are written from them.

In Studio, on the timeline, a caption track is a narrow row of its own, each cue a block with its words: click, ⇧/⌘-click, drag a box or press ⌘A to select; drag the selection together; drag an edge; split with ⌘B; merge; double-click to add or edit (not past the film's end); ⌫ to delete. The inspector changes the look of all captions, or with "Apply to all captions" unticked only the selected ones: size, weight, color, outline, background and height on the picture. It says when a selected cue has a look of its own, and puts it back to the track's. Every edit is one undo step, and a file the agent changes shows at once.
