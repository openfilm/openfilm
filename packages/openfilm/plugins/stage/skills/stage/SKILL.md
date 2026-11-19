---
name: stage
description: Shots blocked out in 3D on OpenFilm's stage, a set with figures that move and a camera move, written as a three.js page and rendered as a white-box video. Read it when the person asks for previs, blocking, a white box, a 3D layout of a scene, a camera move to try out, a shot planned before it is generated, or points at a file in stage/.
---

# The stage

A shot is a page of the project: `stage/<name>/index.html`, and `shot.js` beside it with the set, the figures and the
camera. It is a page of a film like any other (`window.film`), so it plays and renders with nothing else.

- `openfilm stage new <name>`: a new shot, with a working `shot.js` to rewrite; the first one copies `stage/lib/` in
  (three.js, `stage.js`, `mannequin.js`), which is then the project's own to extend.
- `openfilm stage look [shot] [t | a-b]`: after every change; read its pictures. Facing: 0° toward +z, 90° toward +x.
  Not done while it says ✗; each ! is fixed or meant.
- `openfilm stage render <shot> [a-b] [--depth] [--pose] [--still]`: into `assets/stage/<shot>/` (`whitebox.mp4`,
  `depth.mp4`, `pose.mp4` OpenPose, `still.png` the first frame). `--engine blender [--cycles]` draws it with Blender
  when it is installed: same files, slower (say so first). `openfilm stage blend <shot> [--open]`: the scene as the
  person's own `stage/<shot>/blender/shot.blend`.
- `openfilm stage models [name…]`: the models that come with the stage (an `actor`, a rigged mannequin with
  animations, and furniture in meters facing +z), copied into `assets/models/` by name.

Links: `[the shot](stage/s1/index.html)`, `[at 2.5 s](stage/s1/index.html#t=2.5)`.

## shot.js

`shot({ pass })` returns `{ frame, duration, scene, camera, ready: loaded() }`. `frame(t)` is a pure function of t
that ends with `draw()`. Every object has a `name`: references, look and the workbench find things by it. Keep to
standard materials and lights, no custom shaders or post effects, so Blender draws it the same.

`stage.js`, beyond what three.js gives:
- `createStage({ pass, fov, sun: { from, to, area } })` → `{ scene, camera, draw }`, with sky light and a sun.
- `room(scene, { width, depth, height, back, left, right, front, ceiling })`: back is −z; the front is open and there is
  no ceiling unless asked. A side is `true`, `false` or `{ openings: [{ at, width, bottom, top }] }`, `at` the
  opening's middle from the side's left end seen from inside, `bottom: 0` a door. `wall(scene, { from, to, height,
  openings })`, `ground(scene)` outdoors, `box(scene, { name, size, at, turn })` with `at` the middle of its bottom.
- `model(scene, 'assets/models/x.glb', { name, at, turn, height })` and `character(scene, path, { name, height })`
  for a rigged one: in `frame`, `kim.act([{ clip, time, weight }])`; `kim.clips` lists its animations once loaded.
- `progress(t, a, b)` eased 0–1, `lerp`.

`mannequin.js`: `const ana = mannequin({ name, height })`, then in `frame`: `move(ana, [[x, z], …], distance)` (also
for a character), `apply(ana, pose)` with `stand()`, `walk(d, { from, stopAt })`, `run(d, { from, stopAt })`,
`sit(amount, { seat })`, `turn(angle)` or `mix(a, b, k)`, then `lookAt(ana, [x, y, z], amount)` and `point(ana,
[x, y, z], { side, amount })`. `stopAt` (the path's length) lets the steps settle; `from: null` when already walking at
the start. For `sit`, the root goes at the middle of the seat, facing away from its back.

Models are files the person gave, the stage's own, or other CC0 (never Mixamo); ask before downloading.

## A drag from the workbench

The person's message may hold "In the stage, at 3 s, ana was dragged from x … z … to x … z …" (or the camera, x y z).
Make the shot put it there at that moment, the rest of its move kept continuous; look; answer with a link to the moment.

## From the white box to video

With the canvas plugin on: `openfilm stage render <shot> --still`, then one `openfilm canvas apply` in a group named
after the shot: a note of what is seen, `file` nodes for `assets/stage/<shot>/whitebox.mp4` and `still.png`, an
`image` node from the note and the still (the same framing, as a photograph filling the whole frame; it sets the look),
and a `video` node with `opts: { mode: "omni", sec }` from the note, the image and the white box, in that order. The
white box alone already carries the camera and the movement. The person picks the model and presses Make, unless they
ask you to (it costs money).
