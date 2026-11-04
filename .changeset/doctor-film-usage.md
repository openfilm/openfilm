---
"openfilm": patch
---

`openfilm doctor` now says how much the projects' hidden `.film` folders hold (render cache, version history and logs), so the gigabytes a long film's seek copies take are visible instead of unexplained. The folders are read asynchronously, so Studio's Settings → Developer → Copy report and its diagnostics file do not hold the app while a network drive or a cold disk is walked.
