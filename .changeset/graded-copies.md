---
"openfilm": minor
---

A video clip can be graded by `.cube` LUTs: `style="--of-lut: url(looks/a.cube) url(looks/b.cube)"` applies them in order. The footage is graded at its own bit depth, before any browser cuts it to 8 bits, into a copy kept in the project's cache, so a dark gradient keeps the steps it would have at 10 bits; Studio's preview, `openfilm render`, `look` and exports all play that same copy. While a new copy is made, the preview shows the clip as it is for a few seconds. A clip without `--of-lut` plays exactly as before.
