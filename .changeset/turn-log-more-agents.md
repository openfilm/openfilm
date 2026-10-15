---
"@openfilm/desktop": patch
"openfilm": patch
---

A turn's log (Settings → Developer) now shows model requests for Gemini CLI, GitHub Copilot, Qwen Code, CodeBuddy and OpenCode too: each request's system prompt, tools, every message (including what the agent added by itself), the answer and its tokens. With Developer mode on, Gemini CLI, Qwen Code, CodeBuddy and OpenCode are started with their own local logging switch, written into a folder of the app's and kept for a week. The app leaves any telemetry you set yourself as it is. CodeBuddy is logged only when its own telemetry is off (`DISABLE_TELEMETRY=1`), since otherwise its traces would name each logged file. Copilot's requests are rebuilt from its own record, which has no tool definitions. Where a log lacks something, the viewer says so, and it explains a turn that has no requests (Cursor makes its prompt on its servers).
