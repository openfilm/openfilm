---
"openfilm": patch
"@openfilm/desktop": patch
---

Desktop: stopping the agent while a command it ran was still going no longer starts a turn of its own a moment later, "A background task finished; the agent went on", that Stop could not end. The rest of a command from a turn that already ended (its last output, its exit) now stays out of the chat. Stop ends a turn the agent started by itself at once. Such a turn that ends with nothing in it leaves no line behind, including ones already saved.
