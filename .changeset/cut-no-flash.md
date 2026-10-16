---
"openfilm": patch
"@openfilm/desktop": patch
---

Studio's preview no longer flashes at a cut. A page coming on used to show before its frame was drawn, so for a moment it showed how it looked before: its first state, or the frame it drew the last time it was on. Now it shows once that frame is drawn, and the picture before it stays until then. Exports were never affected.
