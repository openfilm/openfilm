---
"openfilm": patch
---

Studio: in the desktop app, Install in Settings → Services → Local services downloads the model again. Studio runs there on the app's own runtime, and the download (and each local transcript or background removal) was started as the app instead of as Node, so it ended at once and nothing happened. It now starts as Node; the `openfilm` command on Node is unchanged.
