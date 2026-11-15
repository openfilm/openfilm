---
name: stage
description: Shots blocked out in 3D on OpenFilm's stage, a white-box set with figures that walk, run, sit, turn, look and point, and a camera move, written as a three.js page and rendered as a white-box video. Read it when the person asks for previs, blocking, a white box, a 3D layout of a scene, a camera move to try out, a shot planned before it is generated, or points at a file in stage/.
---

# The stage

A shot is a page of the project, `stage/<name>/index.html`, drawn with three.js: `shot.js` beside it holds the set,
the figures and the camera, each a function of t in seconds. It plays live wherever it is opened, is a page of a film
like any other (`window.film`: `frame(t)`, `duration`), and renders to a video. The person directs in words; you build
and change the shot. They see no coordinates, so never ask them for numbers: say what you did in film words.

- `openfilm stage new <name>`: a new shot (`s1`, `door-entrance`) with a working example to rewrite. The first one
  copies `stage/lib/` in: three.js, `stage.js` (the stage and set pieces) and `mannequin.js` (the figures). Those are the
  project's own copies: add a pose or a piece there when a shot needs one.
- `openfilm stage look [shot] [t | a-b]`: your eyes. Frames from the camera, a view from above with every path, where
  each figure and the camera are (meters; facing 0° = toward +z, 90° = toward +x), and what is wrong. Run it after
  every change and read its pictures; a shot is not done while it says ✗, and each ! is fixed or meant.
- `openfilm stage render <shot> [a-b]`: the white-box video, `stage/<shot>/whitebox.mp4` (a stretch:
  `whitebox-<a>-<b>.mp4`). It is what a video model is given as its reference for the camera and the movement.

Point at what you made with links: `[the shot](stage/s1/index.html)`, `[at 2.5 s](stage/s1/index.html#t=2.5)`,
`[the white box](stage/s1/whitebox.mp4)`.

## shot.js

`shot({ pass })` returns `{ frame, duration, scene, camera }`. Build everything once in `shot`; `frame(t)` only moves
what is there, ends with `draw()`, and gives the same picture for the same t whatever was drawn before (no state carried
from frame to frame, no unseeded randomness). Meters, y up; the room's open side is +z, where the camera usually is.

```js
import * as THREE from 'three';
import { createStage, room, wall, box, lerp, progress } from '../lib/stage.js';
import { mannequin, apply, stand, walk, run, sit, turn, mix, move, lookAt, point } from '../lib/mannequin.js';
```

- `createStage({ pass })`: renderer, scene, `camera`, a sky and a sun; options `background`, `sky`, `ground`,
  `skyIntensity`, `sun: { from, to, intensity, area }`, `fov`.
- `room(scene, { width, depth, height, back, left, right, front })`: a floor and walls; each side `true`, `false` or
  `{ openings: [{ at, width, bottom, top }] }` (`at` meters from the side's left end seen from inside; `bottom: 0` is a
  door, 2.1 m high unless `top` says). `wall(scene, { from: [x, z], to: [x, z], height, openings })` for any other wall.
- `box(scene, { name, size: [w, h, d], at: [x, y, z], turn })`: `at` is the middle of its bottom. Other shapes are three.js
  meshes with `MeshStandardMaterial`; give every object a `name`, `castShadow` and `receiveShadow`.
- Real sizes: a door 0.9–1.1 × 2.1 m, a ceiling 2.6–3 m, a table 0.75 m high, a chair seat 0.45 m, a counter 0.9 m,
  a bed 0.5 m, a car 4.5 × 1.5 × 1.8 m, a person 1.6–1.9 m.
- White box: grey sets, one strong color per figure (each new figure takes the next), plain light. It is for reading
  where people are, how they move and how the camera sees them, not for looks.

## Figures

`const ana = mannequin({ name: 'ana', height: 1.68 }); scene.add(ana.root);` Then in `frame(t)`, in this order:

1. Where: `move(ana, path, distance)` puts it `distance` meters along `path` (`[[x, z], …]`), facing where it goes and
   turning smoothly at corners; it returns `{ length, done }`. Or set `ana.root.position` and `ana.root.rotation.y`.
2. The pose: `apply(ana, pose)`, a pose from `stand()`, `walk(distance, { stopAt })`, `run(distance, { stopAt })`,
   `sit(amount, { seat })`, `turn(angle)`, or `mix(a, b, k)` of two. `apply` keeps the lower foot on the floor.
3. Then `lookAt(ana, [x, y, z], amount)` (the head, a little of the chest) and `point(ana, [x, y, z], { side, amount })`.

- Walking is about 1.2 m/s, strolling 0.8, running 3–4: `distance = speed * (t - start)`. Give `walk` and `run` the
  path's length as `stopAt`, so the steps settle into standing at the end instead of freezing mid-step.
- Change one action into the next with `mix` over half a second or more, the amount from `progress(t, a, b)`: nothing
  snaps. Turning on the spot: turn `root.rotation.y` and apply `turn(angle turned so far)`.
- Sitting: the root goes at the middle of the seat, facing away from the chair's back; `sit(progress(t, a, a + 1))`.
- Names stay the same from frame to frame: the person's references and `look` find figures by them.

## The camera

- One continuous move per shot, eased (`progress`): a push in, a pull out, a pan that follows, a slow arc, a crane up.
  Speed it up or hold it on the beats of the action, but never back and forth. A cut is a new shot.
- Eye height is 1.5–1.7 m; low is 0.4–0.8, high 2.5 or more. A field of view of 30–50°: lower is longer lens, flatter
  and closer. Move the camera rather than change `fov` for a push in.
- The camera stays in the open: never inside or just behind a wall (look says ✗ inside, or ! in front of the lens).
- Frame on what matters: aim with `camera.lookAt` at the figure's chest or head, eased, and keep the figure in frame
  (look's ! out of frame and hidden). Look gives each figure's size head to feet against the frame's height: about 85 %
  is a full shot, 170 % a medium shot (to the waist), 400 % or more a close-up.

## Changes the person asks for

"Lower", "slower", "she stops at the window", "another shot from outside": change the numbers in shot.js that do it,
look, and say what changed with a link to the moment (`[at 3 s](stage/s1/index.html#t=3)`). Another shot of the same
place: move the set into `stage/<place>.js` exported as a function both shots call, rather than copying it.

## What renders the same everywhere

Keep to `MeshStandardMaterial` or `MeshPhysicalMaterial`, the stage's sky and sun plus point and spot lights, and no
custom shaders or post effects: then the shot looks the same in every renderer that may draw it later.
