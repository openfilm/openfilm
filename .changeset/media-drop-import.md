---
"openfilm": patch
"@openfilm/desktop": patch
---

Make the empty import card and media pane reliably accept multiple dropped files, including drag stores exposing
files through data items. Show the import target during dragover and prevent the project-wide drop handler from
also inserting or importing the files. Preserve folder-target drops and internal tile moves.
