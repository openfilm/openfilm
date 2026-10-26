---
"openfilm": patch
---

Exports: a page's pictures and fonts are in every frame. A page opened during an export was drawn once its `window.film` was ready, and a page whose `ready` did not wait for its images lost them for some frames. An exact frame now waits for the page to finish loading (at most 30 s, then it is drawn as it is and the page is named among the export's problems).
