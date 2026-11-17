---
"openfilm": minor
"@openfilm/desktop": patch
---

Skills are resolved as dependencies. A plugin, and a skill, name the skills they build on in their openfilm.json (`"requires": ["film"]`), and an agent is given the skills of the plugins on and what these require, each once, a skill after those it builds on; the system prompt's list and `openfilm skill` say what each builds on. How a film is written is its own skill, `film`, no longer the edit's: given while a plugin that changes the film is on (the edit, Screening), and not with only the canvas. No skill is given to every agent; the system prompt says the rest once, among it that what the person did not ask for or point at is theirs as it is. The edit and Screening bring no skill of their own, and `openfilm skill edit` still finds the film's.
