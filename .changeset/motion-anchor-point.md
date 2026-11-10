---
"openfilm": patch
---

A picture's anchor point: `--fx-ax` and `--fx-ay` (stage px from its box's middle) are where it turns and scales
about, its box's turn too, keyed as its effects are (SPEC §1). Motion lists Anchor X and Y first in a layer's
Transform, and the picture's frame turns with it. Motion's layers stack down from the top of the timeline, each with
an eye and a lock (its track's). Shapes trim like an animation editor's paths: a start, an end and an offset round
the outline.
