---
"@openfilm/desktop": patch
"openfilm": patch
---

A turn's log (Settings → Developer) now shows everything the agent and its model got. A new "Sent to the agent" tab shows how the app started the agent, every word it adds to the agent's own instructions, and each message exactly as the agent got it, with its pictures. Model requests are no longer only your own key's: for Claude Code, Codex and Kimi they are read from each agent's own record. Each request shows its full system prompt, its tools, every message (including what the agent added by itself: project instructions, environment, skill lists, reminders), the answer and its tokens. Subagents' requests are included. Turns from before this change show their requests too, as long as the agent's record is still there.
