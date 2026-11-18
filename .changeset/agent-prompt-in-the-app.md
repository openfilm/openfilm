---
"openfilm": patch
"@openfilm/desktop": patch
---

Agents you run in the desktop app (Claude Code, Codex and the others) now get the system prompt meant for the app, as the app's own agent does: Studio is beside them, with how to be with you. Before, they were told the terminal's, which sent them to open Studio themselves. Nothing they read in the app mentions `openfilm open` or `npx openfilm` any more: Claude Code and Codex run the app's `openfilm` by its name, the others by its path, and a skill written for a terminal reaches them with the app's `openfilm`. How to point at the film (`film.html#…`) is now in the film skill and how to point at the canvas in the canvas skill, with one line in the system prompt on how links work in the chat. Screening now brings the media skill as the edit does. The media skill now covers only the library's music, sound effects and stickers, beside what services make. With every plugin off, an agent still gets the film and media skills, so it can make a film from the conversation alone.
