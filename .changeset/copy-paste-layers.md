---
"openfilm": patch
---

Studio: layers inside a page can be copied and pasted, as in a design tool. Select one or more on the picture or in the Layers panel, then press ⌘C / Ctrl+C or choose Copy in the layer's menu (a Layers row now has a right-click menu with Copy, Paste and Delete). Paste with ⌘V / Ctrl+V or Paste in a menu.

The copy is a new, independent element written into the page's HTML right after the original, or last in its parent when the page's CSS would restyle what is next to it. It gets new ids (`<id>-copy`). The page's CSS for the old ids is repeated for the new ones in the page's head, and the clip's changes to the original (styles, moves, words) are written into it. Scripts and `on…` handlers inside it are left out, so the page's code runs once. It is placed 24 px lower and to the right, each paste at the same spot on top of the one before, and selected so it can be moved at once. From then on it is an ordinary layer: it shows in the Layers panel, moves, exports and is deleted like any other. When other clips also show that page, this clip first gets its own copy of the page (`<name> 2.html`), so the other clips stay as they were.

Pasted while another page is in hand or under the playhead (also from another project), the layer is written into that page as it looks now, with its look written in. Files it uses from another project are copied into `pasted/<project name>/`. With no page under the playhead, it goes back into its own page. One undo removes a paste, the page and film.html together, even after the agent edited the page meanwhile. A page that is not UTF-8 keeps its encoding. A paste pastes whatever was copied last: layers, or clips on the timeline. The Layers panel also reads the page again when a page file changes.
