---
"openfilm": patch
"@openfilm/desktop": patch
---

A web page picked in the media pane now plays as smoothly as the film in the viewer. The page draws its own frames, one per frame of the project's frame rate, instead of waiting on a message from the editor for each one, so a busy editor no longer makes it stutter. Pausing stops on the frame on screen, and the timecode and the position bar match it.
