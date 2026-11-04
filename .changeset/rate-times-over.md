---
"openfilm": patch
---

Render: a frame rate taken times over (motion blur's samples) is written to ffmpeg without a floating point tail, so a decimal rate such as 1.1 fps is no longer given as `3.3000000000000003`.
