---
"openfilm": patch
---

Retry media imports while Windows temporarily holds their staging files. Reusing an identical imported file now succeeds even if redundant staging cleanup stays locked, and cleanup failures preserve the original import error.
