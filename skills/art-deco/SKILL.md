---
name: art-deco
description: Build a 1930s poster that moves — gold keylines on warm black lacquer, airbrushed geometric volumes, everything unfolding from one central axis. Use when the person asks for an art deco style video, a 1930s glamour/luxury look, a gold-and-black geometric animation, or says 装饰艺术, 复古奢华风格, 哥谭风格.
---

# Art Deco

## The result

A glamorous, ticking-clock short film — a luxury brand piece, a gala invitation, a launch film — built entirely from gold keylines on black lacquer, good enough to sit next to a real 1930s Cassandre poster brought to life.

## What defines it

Every composition is organised around one vertical axis, and ornament (sunbursts, stepped arches, dials, bulb marquees) is structural, not decorative — it is the background, the frame, or the progress bar. A gold-foil-coloured slideshow of flat vector shapes, or any object without airbrushed volume and a gold rim, is not this.

## What has to be true

- Every shape is built from the signature gold keyline (dark engraved underline, metal gradient, hairline highlight) plus airbrushed volume with a hard edge — no flat vector fills, no cartoon black outlines.
- Every composition holds a single centre axis; transitions open, close, or unfold from that centre and symmetry never drifts off it.
- Exactly one saturated accent colour is reserved for the protagonist or the object the story follows; it is the only large saturated area in any shot.
- Motion is mechanical and symmetrical: doors split along a seam, lights switch on in counted order with an ignition overshoot, dials move with firm ease-in-out like real machinery — nothing floats or drifts loosely.
- Numbers carry the plot visually (a dial, a clock face, a floor medallion) rather than through spoken narration alone.

## What you have

OpenFilm's `frame(t)` canvas model handles the gold-line system directly: draw the dark underline, the metal gradient, and the hairline highlight as one reusable stroke function, then composite airbrushed volumes with a single consistent light direction. True one- and two-point perspective through a pinhole camera means dolly and tilt change the perspective naturally. `look` catches any shot where the centre axis has drifted, or where a volume reads flat instead of airbrushed.

## With the person

Ask what the event, launch or deadline is — this style wants a clock ticking toward something. Ask which one object or person should carry the reserved accent colour. When done, say which element carries the accent and why, and offer to adjust the jewel-tone palette or the ignition timing on lit elements.
