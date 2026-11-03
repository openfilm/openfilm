---
name: openfilm
description: Make videos as web pages with OpenFilm. Use when the user asks for a video, motion graphics, an animation, a launch film, an explainer, a music video, to edit, cut, check or render a film (film.html and pages with window.film), or to open OpenFilm or its Studio.
---

# OpenFilm

Run `npx -y openfilm@latest` and follow the manual it prints: it is the whole of OpenFilm, about a thousand words. Run it
again whenever you need it.

For a film made step by step, run `npx -y openfilm@latest pipeline` after the manual: it is the production line, the
stages a film goes through, what each one leaves behind, and how each is worked (`openfilm pipeline <stage>`). When
the storyboard is written, `openfilm pipeline check` holds it against the project — pages, media, voices, seconds —
and names what is missing under the stage that fills it.
