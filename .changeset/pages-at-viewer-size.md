---
"openfilm": patch
"@openfilm/desktop": patch
---

Studio's preview draws web pages at the size the viewer shows them. A page that sizes its canvas or 3D by the device pixel ratio, as the protocol asks, now draws only the pixels you see instead of the film's full size scaled down, so heavy pages play more smoothly and look the same. Going fullscreen loads the film again behind the picture at the new size. Turn it off under Settings → Playback → Draw pages at the viewer's size. Exports always draw at full size.
