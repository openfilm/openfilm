---
"openfilm": patch
---

Show Studio's current automatic render concurrency and allow an explicit browser limit for video, GIF and editing-project exports. Share the selected limit across all pages in an editing project, retain the conservative Auto recommendation, and report the selected browser limit and per-page workers alongside render timings. Preserve the original output dimensions, frame clock and lossless media paths.

Pipeline editing-project drawing with a CPU-sized postprocessing pool capped at four tasks. Keep waiting pages inside the browser budget, propagate cancellation through the bounded queue, and report postprocessing wait time separately.
