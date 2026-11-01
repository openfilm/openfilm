---
"openfilm": minor
---

Clips move. A clip's style may carry a CSS animation, its `@keyframes` in film.html's `<style>`: it runs on the clip's own time, moves the picture with `translate`, `scale` and `rotate` on top of its box (about its middle), and `--clip-length` times a way out from the clip's end. Agents write motion the way they write any CSS animation.

In Studio, the inspector's Keyframes section keys a clip's position, scale, rotation and opacity at the playhead: change a value and a keyframe is set there, click the diamond to add or remove one, step between them, and give each its easing (linear, ease in, ease out, both, hold). The picked clip shows its keyframes along the bottom of its timeline block; a click goes to one. Cutting a clip keeps its motion going in the second half, a copy gets keyframes of its own, and every change undoes.

The library adds 27 clip animations (12 ways in, 8 ways out, 7 loops, such as pop, whip, spin, blur, shake, heartbeat and a slow push) on the picked clips, and 11 camera moves on a cut (zoom through, pull back, whips in four directions, spins, flash zoom, blur, shake), the clip before the cut going out as the one after it comes in.
