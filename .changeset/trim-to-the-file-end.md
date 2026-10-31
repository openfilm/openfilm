---
'openfilm': patch
---

A clip that plays its file to the end, its `#t=` written to the millisecond, renders and exports again: a file 8.063991 s long ends at `#t=0,8.064`, which was refused as past the file's length ("ends past the file's length of 8.063991 s"), so the export failed. A time up to a millisecond past the file's length is its end.
