---
"openfilm": minor
---

A workbench can be laid out among the page's panels as the Edit is: its plugin's `openfilm.json` declares its `blocks` (with the Edit's viewer and timeline among them if it wants), Studio arranges them with the chat and the library, and the element draws each into its place (`openfilm/studio` `blocks`, `useBlock`). Each workbench keeps an arrangement of its own, shown, hidden, sized and moved from the layout's menu; the Edit's viewer, layers, inspector and timeline and the Canvas's board are blocks too, and the arrangements and named layouts kept by earlier versions are read as they were.
