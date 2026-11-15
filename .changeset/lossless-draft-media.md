---
"openfilm": patch
---

Reduce editing draft size with exact PNG packet deduplication, cropped transparent layers, and verified lossless RGB runs on the tested macOS Jianying 11.8.0 decoder. Preserve the original frame clock, alpha, source audio and editable timeline placement. Reuse completed clip media through a content-checked cache without keeping a hidden media duplicate, and expose per-clip render and postprocessing timings.
