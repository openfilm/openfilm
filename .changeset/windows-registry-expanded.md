---
"@openfilm/desktop": patch
---

Desktop on Windows: agents start again. The variables read from the registry are expanded before they are handed on, so Codex finds `cmd.exe` through `ComSpec`.
