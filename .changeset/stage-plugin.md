---
"openfilm": minor
---

A new plugin, Stage (off until turned on, in beta): shots blocked out in 3D. An agent writes a shot as a three.js page in `stage/<name>/` (a white-box set, figures that walk, run, sit, turn, look and point, and one camera move), checks it with `openfilm stage look` (frames, a view from above with every path, where each figure and the camera are, and what is wrong: the camera inside something, a figure walking through something, out of frame or hidden), and renders the white-box video with `openfilm stage render`. A shot is a page of the film like any other, so it plays and renders with the plugin off.
