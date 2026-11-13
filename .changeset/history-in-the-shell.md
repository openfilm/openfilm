---
"openfilm": minor
---

Version history is the project's, not the Edit's: its button stays on the top bar with the Canvas shown, with only the Canvas on, and with every plugin off, and saves, restores, copies and deletes versions there as it does beside the Edit. A plugin's workbench takes part through `provide`: `settle()` as the history opens and before it saves or puts files back, `restored()` once a version's files were put back.
