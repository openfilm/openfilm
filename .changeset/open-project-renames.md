---
"openfilm": patch
"@openfilm/desktop": patch
---

Studio: on Windows an open project can be renamed again after its agent has finished a turn. The chat's agent stays running for a while between turns, working in the project's folder, and Windows will not rename a folder a process works in, so every rename failed with "Rename failed. Please retry." until another project was opened. The agent between turns now stops before the rename (its next turn starts in the renamed folder), a folder that is only held for a moment is tried again, and one that something else still holds is refused with a message that says so and what to close.
