---
"@openfilm/desktop": patch
---

Chat: on macOS, every agent runs the app's own `openfilm` command, on the Studio beside it, even when its shell reads the person's shell profile again and finds another `openfilm` first (an older one installed globally, on their own Studio). Codex, Cursor and CodeBuddy did that. The app now names its command by its whole path, in what the agent is told and in all the command prints, and Codex keeps the app's PATH for each command.
