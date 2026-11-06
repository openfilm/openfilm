---
"openfilm": patch
---

A film's sound mix ended with its last sound at times, not at the film's end (ffmpeg 8 on Linux, about one mix in 25 when the sounds are files of their own): the mixed frames came without timestamps, and the padding to the film's length goes by them. The mix is given its timestamps, from its samples, before it is padded.
