---
"openfilm": patch
"@openfilm/desktop": patch
---

Connectors: your agent can reach the services you work in. Six come with OpenFilm, in the Community's Plugins under Connectors, each off until you get it: Dropbox (find and fetch your files), Frame.io (review comments, upload versions, fetch media), Notion (scripts and shot lists from your pages, and back), Adobe (Express, Firefly, Photoshop and Adobe Stock tools), Canva (find and make designs, such as covers) and Vimeo (upload films, edit their details, read their analytics; beta). Each is the service's own remote MCP server; the first time your agent uses one it asks you to sign in to that service, as it would in its terminal, and nothing of your account passes through OpenFilm. A plugin is a connector when its folder has a `.mcp.json` as Claude Code plugins have (`{ "mcpServers": { "<name>": { "type": "http", "url": "https://…" } } }`, or a program to run); while it is on, the desktop app gives its servers to the agent's session (an agent that takes no remote servers is given none).
