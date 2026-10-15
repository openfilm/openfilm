---
name: replicate
description: Make a film like a reference video (its structure, rhythm, look and motion) with the person's own content. Use when the person gives a video, as a file or a link, and asks for one like it, to learn its style or pacing, or to remake it for their product or topic (复刻, 照着做, 做个同款).
---

# Replicate a video

## What a good replica keeps

- **Structure**: the same parts in the same order, each doing the same job for the viewer (the hook, the setup, the
  turn, the payoff, the call to action).
- **Rhythm**: each part about as long; the picture changes at the same moments; cuts and hits land on the same beats.
  A longer or shorter film scales them.
- **Look**: layout and framing, type (family, weight, how sizes relate), palette, background, the elements that recur
  (captions, labels, counters, a frame around everything).
- **Motion**: how things enter, move and leave: direction, distance, speed, ease, overshoot; the transitions between
  parts.

## What it changes

- The content is the person's: their topic, product, words, footage. Change what a part shows; keep what it does. A
  part with nothing to stand for in their film gives its job to something that fits.
- Never the reference's own footage, music, voice, likeness, logo or words: they are someone else's, and platforms hold
  back near copies.

## How

1. **The reference** goes in `references/`. Given a link, `yt-dlp -o references/<name>.mp4 <link>` when yt-dlp is
   installed; otherwise ask for the file. When it has speech, transcribe it with `npx openfilm get` (a `.vtt` beside
   it).
2. **Watch all of it**: `npx openfilm look references/<name>.mp4` for the whole, then stretches
   (`look references/<name>.mp4 4-8 --count 24`) and single frames at full size (`look references/<name>.mp4 5.2`)
   to read type and layout. Where something moves, look at a short stretch densely to see its path, speed and ease.
3. **Reuse before building**: when an OpenFilm example or one of the person's projects already does something like a
   part, read its source and start from it.
4. **Write the plan** in `references/<name>.md`: the reference part by part (its times, what it shows, how it looks
   and moves, what it does) and what takes each part's place in the person's film.
5. **Make the film** from the plan.
6. **Compare** the film with the reference at the same moments: `look` the same stretch of each and set the sheets
   side by side. Fix what differs in timing, size, position, color and motion; then check the whole film.

When done, tell the person in a few lines what was kept, what changed and why, and what of theirs (footage, a logo,
their voice) would bring it closer.
