---
"@openfilm/desktop": patch
"openfilm": patch
---

Footage is decoded on the graphics chip on every system: VideoToolbox on a Mac, Direct3D 11 (then NVIDIA's decoder) on Windows, and VA-API (then NVIDIA's) on Linux. This covers the fast-seeking copies, the preview's proxies and the files an editing project converts. Each decoder is tried once on a moment of H.264 and used only when its frames match the processor's pixel for pixel. If it fails partway, the work is done again without it.

Footage the render's browser can't decode no longer stalls an export: ProRes, which no browser plays, and HEVC on a computer without a chip for it. Before rendering, such footage is converted to a copy the browser plays, keeping its transparency when it has one. A film with ProRes footage used to take about thirty seconds a frame and showed none of it.

`openfilm doctor` says which encoders and decoders ffmpeg uses on the chip, and which video codecs the browser decodes there.
