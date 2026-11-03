---
"openfilm": minor
---

An element's words can animate part by part: an override's `split` (`{ "by": "char" | "word" | "line", "animation": …, "stagger": …, "start": …, "order": … }`) has the host wrap each character, word or line and give it the animation, the film's own `@keyframes`, at its turn (SPEC).

In Studio's Motion, a text layer of a composition has a Text group as an animation editor's text animator: a preset (fade in, rise, pop, blur in, typewriter, drop), by characters, words or lines, in order, reversed, from the middle or at random, when the first starts, how far apart, how long each.

A shape layer has a Shape group: its stroke drawn on (Trim paths), how much of it is drawn keyed from 0 to 100% (`--fx-trim`, which the host registers with the effects), its dash as long as its longest path. An element's keyed opacity or effect keeps no static value of its own, which would stand over its animation.
