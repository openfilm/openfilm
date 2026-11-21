---
"openfilm": patch
---

A project's cache no longer keeps every copy of your footage for good. The copies a render seeks in and the proxies the preview plays are removed once nothing has used them for 30 days, and a day after the footage or LUT they were made from has changed. Studio checks every listed project once a day, whether it is open or not, and a render or `look` from the terminal checks its own project. Whatever is removed is made again the next time it is needed. Footage on a disk that is not connected keeps its copies for the full 30 days.
