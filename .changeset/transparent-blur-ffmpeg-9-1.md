---
"openfilm": patch
---

A transparent video with motion blur (ProRes 4444 or WebM, two or more samples) exports again with ffmpeg 9.1. When the picture turned fully opaque partway through, ffmpeg 9.1 stopped the export with "Frame size or format changed without filter graph reinitialization" and wrote nothing.
