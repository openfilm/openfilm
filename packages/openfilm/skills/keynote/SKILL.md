---
name: keynote
description: Make a product film in the style of a big tech launch keynote — a black stage, huge confident type, the real product shown in device frames under slow, smooth camera moves, one idea per shot. Use for app, website, software and gadget launches, feature announcements and product intros, or when the person asks for a keynote, launch event, premium or minimal tech style (发布会, 产品发布, 新品, 高级感).
---

# Keynote

A launch on a stage: dark, quiet, certain. Few words, set huge; the real product, lit and moving slowly; each shot says
one thing and leaves room.

## The real product, never a drawing of it

The film shows the product as it is. Before designing, get it:
- **Screens**: the person's screenshots or screen recordings first. Else capture the live product:
  `node <this skill's folder>/capture.mjs <url> assets/ui/<name>.png` (`--full` for the whole page to scroll through,
  `--click <selector>` to open a view first, `--hide <selector>` for banners, `--dark` for the dark theme, `--size`
  for a phone: `--size 390x844`). Capture each view the film will show.
- **The words**: features and claims from the product's own site, docs or the person; never invent a number, a
  customer, a price or a date. Missing facts are questions, or left out.
- **The name and logo**: theirs, from their site (an SVG or a high-resolution PNG).
Never redraw an interface. When a screen must be simplified, crop and zoom into the real one.

## The look

- **Stage**: black or near-black; one soft light behind the product; nothing decorative.
- **Type**: one sans family (Inter, or the brand's), heavy and tight for headlines, set very large; short lines (two to
  six words). Grey for the setup, white for the point, a gradient on one word at most.
- **Devices**: a laptop, phone, tablet or browser window holding the real screenshots, floating in the dark, turning a
  few degrees; a full-page capture scrolls slowly inside its screen.
- **Motion**: slow and continuous (eased in and out over the whole shot), never bouncing. Words rise out of a mask;
  devices arrive from below or out of focus and settle; cuts land on the music's downbeats; one hard-cut black beat
  before the name.
- **Rhythm**: a cold open with the problem or the promise in a few words; then the product revealed; then one shot per
  feature (the claim in words, then the screen proving it, zoomed to where it happens); then the name, the line, the
  call (the address, "available today").

`keynote.js` in this skill's folder has the camera (`camera`), the masked reveal (`reveal`), the device frames
(`device`, `scroll`) and `loaded()` for `window.film.ready`; `keynote.css` the stage, the type sizes and the devices.
Copy them into the project and build on them. Music: something with a clear pulse, from `get music` when a service is
connected; the cuts follow it.
