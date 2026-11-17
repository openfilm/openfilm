---
"@openfilm/desktop": patch
---

On Windows the built-in agent runs its commands in PowerShell. It ran them in bash, which Windows does not have without Git for Windows, so every command it ran failed there.
