---
name: backrooms
description: Make a first-person camcorder recording of an empty, repeating, fluorescent-lit interior where dread comes from rules and the tape failing, not monsters. Use when the person asks for a liminal space video, a found-footage horror style, a creepy empty office/hallway piece, or says 后室, 阈限空间, 伪纪录片恐怖, 监控录像风.
---

# Liminal Found Footage

## The result

A short, unsettling first-person tape — good enough that a viewer believes they found a camcorder recording, and that the fear comes from everything being too empty and too familiar, not from anything jumping out.

## What defines it

One continuous handheld 4:3 camcorder recording inside an empty, wrong interior that repeats — dread built from emptiness, bureaucratic rules on the wall, and the camera itself failing at the wrong moment. A monster reveal, gore, a jump scare, or a score sting breaks this style completely; so does a clean, modern, gimbal-smooth camera move.

## What has to be true

- One continuous handheld take: cuts happen only where the tape breaks (power roll-in, tracking tear, REC off) — never an editorial cut.
- Handheld motion is a walking gait plus breathing plus a tremor whose amplitude follows a fear curve; at a held breath, all of it freezes.
- Lighting is thousands of flat panels with no shadows — where lights are dead the haze is dark, so a silhouette there reads as a hole in the light, not a monster.
- Exactly one saturated colour exists in the whole film (an alarm lamp, an exit sign); it is the only thing bright enough to bloom.
- Closed captions sit inside the 4:3 frame as CEA-608 style white-on-black boxes, including bracketed SDH descriptions like `[LIGHTS FLICKER]` — never a clean modern subtitle bar.

## What you have

OpenFilm's `frame(t)` canvas pipeline suits a low-resolution 3D render (e.g. 720×540) upscaled through a VHS pass — low resolution hides CG cleanliness and the upscale adds the tape character for free. Store light-panel colours in a float texture and sum nearby emitters per pixel for the flat lighting. `look` catches any shot where a cut appears without a tape break, or where the OSD/captions get damaged by the tape noise (they must stay crisp — the TV decodes them).

## With the person

Ask what kind of interior it is (office floor, hotel corridor, school, mall, parking level, hospital wing) and what the rules on the wall should say — the rules carry the story. Ask how long the walk should be; this style thins out once nothing new goes wrong, so shorter is usually stronger. When done, report the runtime and where the tape breaks fall, and offer to adjust the rule text or the level of print wear.
