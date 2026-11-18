---
"@openfilm/desktop": patch
---

The requests an agent made in a turn are read from its own record in a worker thread, so a very long record no longer freezes the app, and a request too long to write is cut from the turn's model log instead of losing the whole log.
