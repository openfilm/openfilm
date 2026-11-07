---
"openfilm": patch
---

A page is loaded again when Windows briefly has no network buffer for a module needed to initialize the film. Previously only a failed page navigation was retried, so a transient failure of captions or overrides could stop an export. Permanent errors are still reported without retrying.
