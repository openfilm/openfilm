---
"openfilm": patch
---

`look --full` watches every frame of the rendered film (or of a video given to `look`) for what a dozen frames miss: white flashes, frames unlike those on both sides, still pictures of 6 seconds or more, and black, each with its time. One ffmpeg decode at two small sizes; a 2-minute film takes a few seconds.
