---
"openfilm": patch
---

`look`: a contact sheet now draws both ends of the film or range, so a page that changes only near its end is no longer left out of the check that draws each frame twice. A sheet of a media file stops two frames short of the file's end, where ffmpeg can still take a picture.
