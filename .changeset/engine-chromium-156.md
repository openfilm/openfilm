---
"openfilm": patch
"@openfilm/desktop": patch
---

Exports, `look` and thumbnails draw with Chromium 156 (Playwright 1.64.1's headless shell), the same version as the desktop preview, started with the same switches from one place (`openfilm/engine`). A page using the newer HTML-in-Canvas (`content="drawable"`, `texElementImage2D(target, internalformat, element)`) now exports as it previews, a `<video>` drawn with `drawElementImage` is no longer black, and a 2D canvas such as p5.js draws the same picture for the same t whatever was drawn before. On a Mac, Skia Graphite stays on with a 2D canvas flushed in small batches, as in the preview: from Chromium 156, turning it off sends WebGL to the CPU and leaves no WebGPU. A new engine suite (`src/engine.test.mjs`, `scripts/engine-report.mjs`) checks what the engine can do and that each technique draws the same picture for the same t.
