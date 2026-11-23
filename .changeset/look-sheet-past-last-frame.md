---
"openfilm": patch
---

`look` on a media file no longer dies when the sheet's last time lands past the picture. A container's duration can run longer than its video track (an audio tail, an edit list), so `duration - 2/fps` sometimes had no frame to find: ffmpeg exited 0 having written nothing, and the next line threw a bare ENOENT naming a file nobody could open. The sheet now stops inside the video track's own duration, steps back a frame if a seek still finds nothing, and reports a plain message if there is genuinely no frame there.
