---
name: replicate
description: Make a film that follows a reference video's structure (its rhythm, look and motion) with the person's own content. Use when the person gives a video, as a file or a link, and asks for one like it, to learn its style or pacing, or to remake it for their product or topic (复刻, 照着做, 做个同款).
---

# Replicate

Two videos feel alike when they share a rhythm (when the picture changes), a look (layout, type, color), a motion
language (how it changes) and what each part does for the viewer. The content is the person's. Never reuse the
reference's footage, music, voice, likeness or words: they are someone else's, and platforms hold back near copies.

A video, as a viewer follows it, is a run of **states** (a picture at rest) and **changes** between them (a cut, a
fade, a move). You read a state well from one frame; a change you cannot judge from frames, so it is measured.

1. **The reference** goes in the project's `references/`. Given a link, `yt-dlp -o references/<name>.mp4 <link>`
   when yt-dlp is installed; otherwise ask for the file. When it has speech, transcribe it first with
   `npx openfilm get` (a `.vtt` beside the video).
2. **Measure it**: `node <this folder>/scripts/measure.mjs references/<name>.mp4`. It prints every state and every
   change in order (when, how long, where on screen, how it eases, on which beat or hit, with the words said), and
   draws the storyboard: one picture per state, numbered as printed.
3. **Read the storyboard** for what each state shows and how it is laid out. Where a change matters and its numbers
   are not enough, look at it: `npx openfilm look references/<name>.mp4 <a-b> --count 24`.
4. **Write the plan** in `references/<name>.plan.md`: each state and change of the reference, what it is for, and what
   takes its place in the person's film. Keep its timing (how long each state holds, each change's length and ease,
   which changes land on beats); scale it when the film is longer or shorter. When the person's words set the pace,
   their sentences take the place of the reference's.
5. **Make the film** from the plan.
6. **Compare**: render a small copy (`npx openfilm render --scale 0.5 --out .film/cache/replicate/film.mp4`), then
   `node <this folder>/scripts/compare.mjs references/<name>.mp4 .film/cache/replicate/film.mp4`. It measures the film
   the same way and lists the changes that are late, early or missing, the two rhythms' correlation, how many states
   each has, and draws them side by side. Fix what is off; one or two rounds are usually enough.
