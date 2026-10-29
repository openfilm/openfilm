---
"openfilm": patch
---

Studio: when a page changes under the selection (an undo or redo, the agent's write, the page loaded again), layers that are gone are taken out of what is selected and no box is drawn where they were, while the layers still there stay selected. Undoing a paste no longer leaves boxes where the copies were, including the outline under a pointer resting on one. When the page of a clip is opened again, as an undo of a paste that gave the clip a page of its own does, the selection waits a moment for it instead of letting go of everything.
