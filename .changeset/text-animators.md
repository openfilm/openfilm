---
"openfilm": minor
---

An element's words can animate part by part: an override's `split` (`{ "by": "char" | "word" | "line", "animation": …, "stagger": …, "start": …, "order": … }`) has the host wrap each character, word or line and give it the animation, the film's own `@keyframes`, at its turn (SPEC).

A shape's stroke can be drawn on: how much of it is drawn keyed from 0 to 100% (`--fx-trim`, which the host registers with the effects), its dash as long as its longest path. An element's keyed opacity or effect keeps no static value of its own, which would stand over its animation.
