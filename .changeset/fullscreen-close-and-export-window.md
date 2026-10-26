---
"@openfilm/desktop": patch
"openfilm": patch
---

Desktop: closing a full-screen window on macOS first leaves full screen, then hides the window, so no empty black Space stays behind. Opening the app again during the transition keeps the window visible.

Studio: the export dialog grows with the window instead of stopping at 1120 × 800. Images and slides have a larger frame preview, with space kept for the controls on shorter displays.
