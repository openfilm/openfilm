---
"openfilm": patch
"@openfilm/desktop": patch
---

Smaller exports from the graphics chip, with a better picture where it is hard. H.264 and HEVC at Standard and High
were given a fixed bitrate on the chip, so a film of slides, motion graphics or a screen recording came to two or three
times the file it needed, and detailed footage was starved. The chip is now held to the quality instead, as the
processor's encoders are: each frame gets what its picture needs. Measured on Apple silicon: the same picture in files
50 to 65% smaller for simple pictures, and detailed footage at about the size it was, without its worst frames. A film
busy in every frame (grain, static), which would come to twenty times its file, is held to once and a half of it.
`openfilm render` does the same for its MP4. A chip that cannot be held to a quality keeps its bitrate.

On Windows, a computer whose graphics driver has no Vulkan now draws through Direct3D on its graphics chip instead of
on the processor. When the frames are still drawn on the processor, the export says so while it runs.
