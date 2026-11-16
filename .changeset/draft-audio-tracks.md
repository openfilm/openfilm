---
"openfilm": patch
"@openfilm/desktop": patch
---

Keep separate source audio rows in editing-app drafts, including rows whose clips do not overlap. Fail with the audio source name when a sound file is missing, unreadable, or has no audio stream, instead of silently omitting its clips from an otherwise successful editing-project export.
