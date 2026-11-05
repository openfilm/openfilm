---
"@openfilm/desktop": patch
---

Turn log: a long turn's log no longer freezes the computer. Pictures in a log are kept as files instead of inside its lines, very long texts are cut, and past its most a log stops keeping the agent's updates and says so. A running turn's log is read on from where the last read stopped, a long one as its prompt and its last events, and only the lines in view are drawn, so tens of thousands of events open at once and scroll smoothly.
