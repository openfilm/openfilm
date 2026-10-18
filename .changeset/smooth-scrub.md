---
"openfilm": patch
"@openfilm/desktop": patch
---

Dragging the playhead along the timeline is smoother. The picture follows every frame instead of 25 times a second, and so does the timecode under it. The playhead line moves without making the editor lay its whole page out again, and the rest of the editor updates a few times a second until you let go. Zooming the timeline no longer redraws every waveform at each step: each one is redrawn once the zoom stops, a few per frame, so a film with hundreds of sounds doesn't freeze when you zoom.
