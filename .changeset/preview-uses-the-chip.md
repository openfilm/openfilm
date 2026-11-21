---
"openfilm": patch
"@openfilm/desktop": patch
---

The preview and its thumbnails use more of the machine.

The desktop app asks for the stronger graphics chip on a computer with two (a laptop's own beside a stronger one), where Chromium by itself takes the one that saves power, and rasters its pages on the chip wherever one can. A film's graded and effect-laden videos ask for it too when Studio runs in a browser.

Proxies of H.264 footage are made about twice as fast on a Mac of ten cores or more: the processor decodes the footage at low priority and the chip writes the proxy, where the chip did both. The Mac's media engine decodes 4K H.264 at only a few times the speed it plays, and the preview decodes its own videos on the same engine, so dragging the playhead while a proxy was being made was slower than it is now. HEVC, which the chip decodes several times sooner than the processor, stays on the chip, and its thumbnails are now decoded there as well: a strip of a 4K HEVC file comes two to three times sooner.

A video's closer strip (the one of every frame, made behind the first) is made in about two thirds of the time: the option that leaves out the frames nothing is built on was misspelt, so every frame was always decoded. More of ffmpeg runs at once on a machine of many cores (up to six, from three).

A photograph taken upright (its pixels on their side, its Exif saying so) is given its size as it is shown, as a turned video is.
