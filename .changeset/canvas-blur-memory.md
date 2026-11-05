---
"openfilm": patch
"@openfilm/desktop": patch
---

A film page that draws a 2D canvas stroke by stroke through `ctx.filter = 'blur(…)'` no longer freezes the computer. On a Mac, Chromium's newer GPU path (Skia Graphite) took 7 to 9 GB for one such frame, in Studio's thumbnails, in exports and in the app's own viewer; OpenFilm's browsers and the app now draw without it (about 400 MB for the same page, as fast for other pages). Each browser OpenFilm starts to draw pages is also watched, and ended when one of its processes holds more than a quarter of the machine's memory; such a page is not drawn again until it changes, and an export of it fails saying why instead of starting again. A thumbnail browser that crashed is replaced at once. When the app's Studio stops again and again right after starting, it is started again later each time, up to a minute apart, instead of every second.
