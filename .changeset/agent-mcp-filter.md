---
"@openfilm/desktop": patch
"openfilm": patch
---

In OpenFilm an agent keeps its maker's own MCP servers, but the ones you added to it yourself stay off until you turn each on. The switches are in Settings → Agents, under the agent; this covers Claude Code (its claude.ai connectors stay), Codex, OpenCode, Qwen Code, Gemini CLI and Copilot. Your own skills now stay off in Qwen Code and Gemini CLI too, and Copilot and Qwen Code get OpenFilm's skills. Claude Code's skill filter no longer waits for a first session to learn its skills.
