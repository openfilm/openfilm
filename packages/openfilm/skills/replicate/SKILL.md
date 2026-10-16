---
name: replicate
description: Remake a reference video in OpenFilm, as close as the person wants it, from frame for frame to its structure, rhythm, look and motion carrying their own content. Use when the person gives a video, as a file or a link, and asks for an exact copy of it, one like it, its style or pacing, or a remake for their product or topic (复刻, 照着做, 做个同款, 一模一样, 仿这个视频).
---

# Replicate a video

Remake a video the person admires, as close as they want it: the same film frame for frame, or its form (the parts,
the rhythm, the look, the way things move) carrying their own content. When their words do not say which, ask. Either
way it is made again in OpenFilm, so every part of it can be changed.

## What has to be true

- **The same moments.** Where the reference cuts, a word appears, something moves or a sound hits, the film does too,
  scaled when the lengths differ; for an exact copy, each frame matches the reference's frame at the same time. Compare
  the two at the same times with `npx openfilm look`, and report honestly, in numbers, how close it is.
- **Made again.** The reference stays in `references/` and is never a clip of the film: what the film shows is made
  anew, and the reference's own music, footage or voice go in only when the person asks for them.
- **Their version is theirs**: when they want their own content, every part carries their topic, product, words and
  material, and a part they have nothing for takes a job that fits their film. A template with new words in it is not
  done.
- **It holds up next to the reference**, as well made at every moment. Watch the whole film as a viewer would, and keep
  refining until it does.

## What you have

`references/` sits beside the film but not in it: `assets/` holds only what the film uses. Anything you can make
pictures, motion and sound with: the web platform and any library on it, renderers whose output becomes a clip, the
person's footage and photos, any font whose license allows it, images, video, music and voice from `npx openfilm get`,
your own built-in tools, and services the person has keys for. OpenFilm's own rules still hold: the picture at t
depends on t alone, a page has no sound, and what you render elsewhere enters as a clip under `assets/` with the script
that made it. Ask before downloading anything large onto the person's computer.

## With the person

What they ask for comes before anything here. The reference (a file, or a link you can download), how close they want
it, what their version is about and the material they have (footage, product shots, a logo, their voice), and where it
will be posted. Ask without holding up the work. When done, tell them in a few lines what was kept, what changed and
why, how close it is, and, if they will post it, which parts belong to someone else (footage, music, voice, faces, a
logo, words, typefaces).
