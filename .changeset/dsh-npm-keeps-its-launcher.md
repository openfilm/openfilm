---
"@openfilm/desktop": patch
---

Desktop: DeepSeek Harness installed with npm on Windows starts again. From 0.2.2 it loads an addon that runs only on the Electron builds it names, and the app started its script on its own Electron, which is not one of them, so it stopped as it started with "unsupported Electron runtime fingerprint". Its npm launcher is used now, which starts it on the Node that installed it.
