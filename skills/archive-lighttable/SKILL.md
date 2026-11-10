---
name: archive-lighttable
description: Push a loupe into real archive objects (negatives, letters, clippings) laid on a glowing light table, where each one comes alive with its catalogue facts. Use when the person asks for an archive documentary style, a museum/brand-history piece built from real photos and documents, an evidence-driven explainer, or says 档案影像, 实证纪录片, 历史档案风格.
---

# Archive Light Table

## The result

A short evidence film — a brand history, a museum piece, an archive story — good enough that a researcher or archivist would accept the facts on screen, because every one of them traces back to a named, checkable source.

## What defines it

Every object on screen is a real scan (public-domain, licensed, or the person's own), at true proportions, with its real damage and its real catalogue identifier, date and title; nothing is generated to stand in for an archive piece. A styled photo montage with invented captions, or stock images relabelled as artifacts, is not this.

## What has to be true

- Every reading, number and date shown comes from a traceable source, and that source (catalogue number, URL, or the person's own record) is kept in a `FACTS.md` delivered with the film.
- Image rights are checked before use: CC0, public domain, CC BY (credited), or the person's own material only; anything else (CC BY-SA, "no known restrictions") is named to the person and confirmed before use, never assumed.
- Light comes from one consistent source (the table, from below); objects are never redrawn, recoloured, or regraded into a style scheme.
- One signal colour marks readings and anchors; it never fills a background or decorates — it only ever points at something true.
- The loupe is the only way into an object's depth; nothing changes state (negative to positive, flat to dimensional) without passing through it.

## What you have

OpenFilm's canvas/WebGL `frame(t)` pipeline handles the loupe as a lens-mapped render region (magnification with pincushion distortion) over a shared 2D world of textured quads — one coordinate system drives the table, the lens and any photograph's parallax. Use the agent's own web fetch and research tools to source and verify each object and its catalogue record before building a shot; `look` catches any shot where a mark or reading has drifted from its anchor, or where sampling artefacts appear at the lens boundary (an explicit-gradient texture read fixes this).

## With the person

Ask what the archive or collection is, which objects matter most to the story, and whether they have rights to the images or need public-domain sources found for them. Ask for the one claim or number the film should prove. When done, deliver the film with its `FACTS.md`, naming every source, and flag anything whose licence needs the person's confirmation.
