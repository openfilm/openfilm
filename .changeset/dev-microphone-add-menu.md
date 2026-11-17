---
"@openfilm/desktop": patch
---

The chat's "+" menu lines up with the "+" button again. OpenFilm Dev (`pnpm dev:desktop`) on macOS is opened by the system instead of started as a child of the terminal or agent that ran it, so it asks for the microphone itself; before, recording was refused without asking wherever that terminal or agent had been refused the microphone.
