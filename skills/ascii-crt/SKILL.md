---
name: ascii-crt
description: Render the whole film as real glyphs on a monospace grid, glowing on an old monochrome CRT terminal — every image including faces and landscapes made of text density, not a filter. Use when the person asks for an ASCII art video, a retro terminal/hacker look, an old computer screen style, or says 终端风, 字符画, ASCII风格, 老式电脑屏幕.
---

# ASCII / CRT Terminal

## The result

A film that plays entirely inside one glowing monochrome terminal screen — a developer tool demo, a sci-fi piece, or a tech brand film good enough that a viewer believes they're watching a real old computer compute the picture, not a video with a text overlay.

## What defines it

Every image on screen, title, face, landscape or chart, is built from real monospace characters chosen for their ink density, drawn on a fixed character grid; the only camera move is changing the size of that grid. A video run through an "ASCII filter" so the characters sit on top of a picture, rather than being the picture, is not this.

## What has to be true

- Every visible shape resolves to recognisable glyphs on a strict character grid — no free pixels, no vector lines escaping the grid.
- The screen has exactly one phosphor colour (amber, green or white) carrying all brightness; at most one second colour is introduced once, on purpose, for one meaning, and never casually dropped after.
- Characters move only in two ways: jumping cell to cell (typing, scrolling, counters) or as the camera's grid-scale changing continuously — nothing drifts off-grid outside a declared transformation moment.
- Subtitles are terminal output: typed word by word in sync with the voice in a reserved log strip, never a floating caption box.
- CRT physics (scanlines, glow, slight curvature, flicker) are present on every frame, consistently, not applied as a one-time filter pass.

## What you have

OpenFilm's `frame(t)` canvas model suits this directly: pre-render a glyph atlas once, draw the grid each frame with `drawImage` so zooms (grid-scale changes) stay sharp and continuous, and apply the CRT post-pass (phosphor ramp, bloom, scanlines, curvature) as a final WebGL step over the whole frame. `look` catches any shot where a shape reads as a picture instead of resolving into legible characters, or where the LOG strip overlaps picture content. Build the density-to-glyph lookup once and reuse it for every shot's grayscale source.

## With the person

Ask what phosphor colour fits the subject (amber for warmth/age, green for classic hacker, white/P4 for clinical or memory) and what the one moment is that earns the single second colour, if any. Ask whether any on-screen text is story content (shown as `[SCREEN]` in the subtitle file, not spoken) versus narration. When done, say which moment carries the second colour and why, and offer to adjust typing speed or grid density.
