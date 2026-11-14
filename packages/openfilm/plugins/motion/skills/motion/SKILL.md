---
name: motion
description: Keyframes in an OpenFilm film as Motion, the workbench of layers and keyframes, writes them. Read it when the person points at a layer or keyframes in Motion, asks for something to move, come in or go out in a way they will adjust by hand, or asks for an effect, a mask, a text animation, 3D or a stroke drawn on.
---

# Motion

Motion is Studio's workbench for how things move: every clip, and every element of a page, is a layer, and each of
its properties has keyframes the person drags in time and in value. What it writes is plain CSS in film.html (SPEC §1),
so write keyframes the way it does: then the person sees each one in Motion and can adjust it, and a moment of the film
is never changed in two places.

## A clip's keyframes

One animation per property, named `<clip id>--<property>`, its keyframes at seconds of the clip, written as percentages
of the animation's length (the last keyframe's second). The animation runs `linear`; a keyframe's
`animation-timing-function` is how it goes on to the next one:

    @keyframes logo--scale { 0% { scale: 0.6; animation-timing-function: cubic-bezier(0, 0, 0.58, 1) } 100% { scale: 1 } }
    @keyframes logo--opacity { 0% { opacity: 0 } 100% { opacity: 1 } }
    <img id="logo" src="assets/logo.png#t=0,4" style="…; animation: logo--scale 0.6s linear both, logo--opacity 0.4s linear both">

- The properties: `translate` (stage px, `x y`), `scale`, `rotate` (deg), `opacity` (0–1). They move the clip on top
  of its box, about its center (or its anchor point, below); its box (`left`, `top`, `width`, `height`) does not move.
- Easings Motion names: `linear` (none written), ease-in `cubic-bezier(0.42, 0, 1, 1)`, ease-out
  `cubic-bezier(0, 0, 0.58, 1)`, ease-in-out `cubic-bezier(0.42, 0, 0.58, 1)`, hold `steps(1, end)`. Any other bezier
  is kept as written.
- A first keyframe after the clip's start: a `0%` stop holding its value comes first.
- Animations of other names (a preset of OpenFilm's library, one timed from the clip's end with `--clip-length`) are
  the clip's too: Motion keeps them as they are and shows them, but drags only its own. To let the person adjust a
  move, write it as the clip's own keyframes; to leave it whole, a named animation of its own is fine.

## Effects, 3D and the anchor point

An effect is a `filter` reading a custom property, and its keyframes move that property (`--fx-<name>`), in an
animation `<clip id>--<name>` of its own:

    style="filter: blur(var(--fx-blur, 0px)); --fx-blur: 6px"                      a still value
    @keyframes title--blur { 0% { --fx-blur: 12px } 100% { --fx-blur: 0px } }      or keyframes

Effects: `blur` and `glow` (px), `brightness`, `contrast`, `saturate`, `grayscale`, `invert` (%), `hue` (deg); `glow`'s
filter is `drop-shadow(0 0 var(--fx-glow, 0px) rgb(255 255 255 / 0.85))`. `--fx-trim` (0–100) is how much of a
shape's stroke is drawn. `--fx-z` (px toward the viewer), `--fx-rx` and `--fx-ry` (deg) put a clip in 3D under the
film's one camera; `--fx-ax` and `--fx-ay` (stage px from the box's middle) are its anchor point, what it turns and
scales about. Keyframe any of them as above.

## An element of a page

A page clip's elements are layers too, tweaked by the clip's `overrides` (SPEC §1) without touching the page. An
element's keyframes are its entry's `style.animation`, playing the film's `@keyframes` inside the page on the page's
own seconds; they are the element's translate, scale, rotate and opacity themselves:

    @keyframes card--e1x9k2--translate { 0% { translate: 0px 40px } 100% { translate: 0px 0px } }
    overrides='[{"at":".headline","style":{"animation":"card--e1x9k2--translate 0.5s linear both"}}]'

The name is the clip's id, `--e` and a mark Studio derives from the element's selector, then the property: change the
keyframes of names you find, and give a new move a name of your own (it plays as written; Motion adjusts what it wrote). A page's own CSS variables are keyed on the `:root`
entry, by `@keyframes <clip>--var-<name>`, and only ease when the page registers them (`@property`).

## Text animations and masks

- Words coming in part by part: the element's entry gets `split`, `{ "by": "char" | "word" | "line", "animation":
  "motion-text-rise .5s ease-out both", "stagger": 0.04, "start": 0, "order": "forward" }`, with
  `@keyframes motion-text-rise` in the film's style. Motion's presets are `fade`, `rise`, `pop`, `blur`, `typewriter`,
  `drop` (`motion-text-<preset>`).
- A mask is `mask-image` in the clip's (or the element's) style, gradients or an inline SVG; a crop is
  `clip-path: inset()`. Both stand together.

## Doing it

- Keep keyframes few: a way in, a way out, a move where something happens. Time them to the sound (a voice-over's
  words are timed in the `.vtt` beside it) and look at every move at its start, middle and end.
- A move the person points at in Motion is the layer's keyframes: change those, not the clip's box, so the rest of the
  move stays as it was.
