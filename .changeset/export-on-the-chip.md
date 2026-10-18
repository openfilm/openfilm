---
"@openfilm/desktop": patch
"openfilm": patch
---

Exports leave more of the work to the Mac's media engines, so the computer stays usable while they run. ProRes exports, and the pages an editing project carries, go through the ProRes engine, about three times as fast with a quarter of the processor. `openfilm render` writes H.264 on the graphics chip, as Studio's exports already do. The copies a render makes of slow-seeking footage, and the preview's proxies of heavy footage, are decoded and encoded on the chip too. H.264 and HEVC from the chip get a key frame every two seconds instead of every twelve frames, which looks better at the same size. Where the chip can't do something, the processor does it as before.
