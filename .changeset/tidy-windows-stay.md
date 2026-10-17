---
"@openfilm/desktop": patch
---

Keep the app running when its window is closed on macOS, so the Dock can reopen it without losing tabs or stopping agents. Close Tab also closes the window when no project tab is open; Quit still exits the app.

Keep the outgoing project visible until its replacement is ready, and prepare the neighboring tab and projects page so closing a tab avoids an empty-window flash.
