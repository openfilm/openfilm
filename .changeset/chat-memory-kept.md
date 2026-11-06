---
"@openfilm/desktop": patch
---

Chat: a conversation whose agent can't reopen its earlier session no longer goes on with a blank memory. The agent gets the conversation so far with the next message, and the chat says so. And a conversation list that couldn't be read when the project opened (Studio still starting) is read again before it is written, so it is never replaced by an empty one.
