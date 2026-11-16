---
"openfilm": patch
---

Reduce editing draft size with exact PNG packet deduplication, cropped transparent layers, and verified lossless RGB runs on the tested macOS Jianying 11.8.0 decoder. Preserve the original frame clock, alpha, source audio and editable timeline placement. Reuse completed clip media through a content-checked cache without keeping a hidden media duplicate, and expose per-clip render and postprocessing timings.

Reuse original full-frame footage when its static CSS is proved neutral. Encode transparent graphics with lossless QuickTime Animation on the tested decoder, keep PNG when it is smaller, and verify the full RGBA stream and timestamps before replacing media. Remove only exact RLE no-op packets. Reuse static caption captures between cue boundaries, retaining every output frame and falling back for motion, highlighting, external styles and scripts.
