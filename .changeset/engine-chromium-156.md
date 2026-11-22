---
"openfilm": patch
"@openfilm/desktop": patch
---

Exports, `look` and thumbnails draw with Chromium 156 (Playwright 1.64.1's headless shell), the same version as the desktop preview, with the same switches from one place (`openfilm/engine`). On a Mac they keep Skia Graphite on, with a 2D canvas flushed in small batches as the preview does: from Chromium 156, turning Graphite off sends WebGL to the CPU and leaves no WebGPU.
