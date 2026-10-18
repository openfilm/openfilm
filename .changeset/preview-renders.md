---
"openfilm": patch
"@openfilm/desktop": patch
---

Studio renders what plays late. While the film plays, Studio notes where the viewer can't keep up, such as a page heavy with 3D or many videos at once. Once you stop, it renders those stretches in the background at low priority, and from then on they play smoothly from the render. Paused, scrubbed or edited, the viewer still shows the live film, and any change to the film or its files renders them again. A line under the timeline's ruler marks each stretch: red plays late, yellow is rendering, green is rendered. Turn it off under Settings → Playback → Render what plays late. Exports always draw the film itself.
