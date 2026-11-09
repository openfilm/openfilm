---
"openfilm": patch
"@openfilm/desktop": patch
---

Open projects pick up changes to the timeline even if the system misses a file notification. The editor retries a failed refresh, keeps newer edits over older responses, and continues to refresh after a save and its recovery read both fail.
