---
"@openfilm/desktop": patch
---

Agents use your system's proxy. When a proxy app turns on the system proxy (on Windows or macOS) and you have not set HTTPS_PROXY yourself, OpenFilm gives the agents that proxy as HTTPS_PROXY, HTTP_PROXY and NO_PROXY. Codex no longer waits through five WebSocket timeouts before your first reply.
