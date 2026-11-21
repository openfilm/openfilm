---
"openfilm": patch
---

Exporting a page that plays its own `<video>` no longer loses up to a second on every frame. When a page sets its video's time and leaves the wait to OpenFilm, the export waits until the new frame is on screen. It asked to be told of that frame only once the seek was done, but Chromium often shows the frame a moment earlier, and a seek to the time the video is already at shows nothing new, so the wait ran out its full second: a page with three videos was drawn at one frame a second, and is now drawn at about twenty. The frame is told by its time, so another one is never taken for it, and a video that has just come into the picture is still waited for as before. Every picture is the same.
