---
"openfilm": patch
---

Cancelling a render or an export in the moment it starts copying a video now stops that copy at once. Before, a cancel that arrived just before the encoder started was missed, and the copy went on to its end in the background.
