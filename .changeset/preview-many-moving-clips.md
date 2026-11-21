---
"openfilm": patch
---

A film of hundreds of clips that move (a way in, a float, a Ken Burns) plays in the preview at its own rate again. Every frame asked each moving clip for its animations, on screen or not, and each answer worked the page's styles out again and looked through every animation of the film: a film of a thousand clips, four hundred of them moving, played at four or five frames a second, and now plays at thirty. Only the clips on at a frame are held at their own time, and a frame takes up only the clips that have a part in it. A clip's animation without a fill (`animation: slide 1s`) also plays again when the playhead goes back before its end: once past it, the preview and a render drew the clip still from then on, the same moment two ways. A caption's animations are kept the same way.
