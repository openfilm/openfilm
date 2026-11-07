---
"openfilm": patch
"@openfilm/desktop": patch
---

Undoing a chat turn restores its canvas boards along with its files. A turn that only changes the canvas can be undone too. Open boards refresh after the restore and forget undo steps that could bring back references to files the turn's undo removed.
