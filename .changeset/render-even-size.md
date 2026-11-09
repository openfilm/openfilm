---
"openfilm": patch
---

Render: a `--scale` that lands between two pixels writes an even picture. `--scale .667` made the browser's surface 1281 wide for a 1920 film: the MP4 was written, and re-encoding it failed with `width not divisible by 2` in every strict H.264 encoder, so the file could not go on to an editor or a second pass. The picture is rounded down to even on the way in, a scale that already lands even is untouched, and the summary now names the size the file actually has.
