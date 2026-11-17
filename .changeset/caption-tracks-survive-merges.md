---
"openfilm": patch
---

Caption tracks no longer go missing when the agent writes film.html while you edit in Studio. Merging the agent's write with your edits used to drop every caption track (its `<track>`), whoever had added it; Studio then took the track as one you removed and never put it back. Each caption track is now merged by its file like a clip: one you added, hid or removed stays as you left it over an older copy, and one the agent adds, renames or removes from the latest copy is taken.
