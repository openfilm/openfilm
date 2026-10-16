---
"openfilm": patch
"@openfilm/desktop": patch
---

`openfilm get asr` now keeps the transcript beside any recording in the project, not only those under `assets/`. A file at the top of the project, or a reference video in `references/`, gets its WebVTT too. Before, none was kept and the answer wrongly said the service does not time words. In Studio, making subtitles now works for a clip whose file is outside `assets/`: before, it was transcribed on every try and nothing was kept. Files and folders starting with a dot (`.git`) belong to the tools, so a recording there is refused before anything is sent.
