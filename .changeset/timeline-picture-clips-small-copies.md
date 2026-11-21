---
"openfilm": patch
---

A picture clip's thumbnails on the timeline are there as the film opens. Each cell drew the picture's file itself: a film of photographs had every one fetched and decoded whole by the editor, twelve million pixels for a cell a few dozen wide, each time the project was opened, and its clips stood empty for seconds. They are now drawn from a small copy of the file, made once and kept (the file itself where no copy can be made, and for an SVG).

A JPEG's poster is no longer an empty file. With ffmpeg 8 a seek into a still picture gives no frame, so the poster kept for a JPEG was zero bytes and the media pane fell back to the whole file. A picture's poster is now read without a seek, and a photograph is turned upright as its Exif says, whatever the ffmpeg.
