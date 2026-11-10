---
name: blueprint
description: Draw an engineering blueprint that comes alive — white technical linework on Prussian blue cyanotype paper, drawn in real drafting order with annotations that move. Use when the person asks for a blueprint style video, an engineering/technical drawing animation, a patent-drawing look, or says 蓝图, 工程制图, 图纸风.
---

# Blueprint

## The result

A precise, dry 30–60 second film about one designed thing — a hardware launch, an engineering explainer, a patent story — drawn live on one sheet of cyanotype paper, good enough that an engineer would believe the drawing is correct and a designer would want it framed.

## What defines it

The whole film happens on a single sheet of blueprint paper, and everything is drawn in real drafting order (centre lines → outlines → detail → hatching → dimensions → balloons → labels) with white linework on Prussian blue. Hologram HUD (glowing wireframe, 3D orbit), Whiteboard (marker on white), or a 3D render pretending to be a drawing is not this.

## What has to be true

- Only two colours exist (blue paper, white lines) plus one non-blue colour used exactly once for a verdict stamp — anything else breaks the medium.
- Lines are drawn progressively by arc length with a glowing nib at the head, and follow drafting order, never popping in fully formed.
- Line weight stays constant on paper regardless of camera zoom (scale with zoom^0.65), so close-ups never become fat sausages and wides never disappear.
- Projection stays strictly 2D drafting (orthographic or oblique isometric); the camera moves but nothing ever renders in true 3D perspective.
- Subtitles are lettered into the drawing as notes (a "NOTE / n" box in empty sheet space, never a fixed bottom bar), and every subtitle also appears in the sheet's GENERAL NOTES column so the final wide shows the whole script as part of the drawing.

## What you have

OpenFilm's `frame(t)` canvas pipeline renders the cyanotype sheet procedurally in sheet coordinates (crisp at any zoom) and strokes the linework with truncated arc-length paths so draw-on is exact. Painter's-order occlusion — fill each solid with paper before stroking its outline — keeps the drawing readable at every depth step. `look` catches any shot where a line pops in instead of drawing on, or where a subtitle sits outside the sheet's note areas.

## With the person

Ask what machine, object or plan the film is about, and what the one verdict or status should be (that's the single stamped colour). Ask whether any notes should carry wit or feeling — the drawing stays dry, the annotations are where warmth lives. When done, report the drafting order used and offer to adjust the stamp wording or the sheet's aging (fold creases, stains, bleach).
