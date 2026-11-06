---
"openfilm": patch
---

Exports and Studio never fail with `ERR_UNSAFE_PORT`: a local server is no longer given a port browsers refuse to open (such as 3659, which some Windows computers hand out). When it gets one, it asks for another.
