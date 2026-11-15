---
name: color
description: The film's color in OpenFilm, clip by clip, with the color workbench. Read it when the person asks to grade, color-correct, white-balance, match shots, give the film a look, apply a LUT, or fix footage that looks flat, grey, too warm or too dark (camera log).
---

# Color

Each video clip's grade is a LUT of the project, `looks/color/<clip id>-<hash>.cube`, named first in the clip's
`--of-lut`; its amounts are kept inside that file. Studio's color workbench and `openfilm color` change the same grade,
and the film plays and exports through it with the plugin off. Never write these files or that `--of-lut` by hand:
`openfilm color set` writes both. Other LUTs in a clip's `--of-lut` (the person's) stay after it.

`openfilm color --help` lists every amount with its range. The commands:

- `openfilm color show [clip…]`: the video clips and what each grade changes.
- `openfilm color look [clip] [t]`: the picture as it plays, measured: exposure (median, shadows, highlights in IRE,
  clipped and crushed), white balance (kelvin and tint of what is nearly grey), saturation, skin-tone hues; `✗` and `!`
  say what is off. It saves a picture: the footage beside the graded picture, its waveform and vectorscope. Read it.
- `openfilm color set <clip…|all> exposure=0.3 white=5600 'lift={"b":0.02}' …`: change amounts; the rest are kept.
- `openfilm color auto <clip…|all>`: white balance from what is nearly grey, exposure to a usual middle.
- `openfilm color match <clip…> --to <clip>`: the same white, exposure and saturation as another clip.
- `openfilm color copy <from> <clip…|all>`, `openfilm color reset <clip…|all>`.

## Grading a film

1. `look` first, at every clip. A clip that reads flat and pale is camera log: ask the person which camera and log
   it was shot in, if the file does not say, and set its `input` (`slog3`, `logc4`, `applelog`…) before anything else.
   A camera maker's LUT the person has goes in as `inputLut` instead.
2. `auto` the clips that need balancing; `match` the clips of one scene to its best one, so a cut does not jump.
3. Then what the person asked for (a warmer evening, colder night, a look) with `set`, small steps, a `look` after
   each. A look LUT of the person's goes in as `look` with its `mix`.
4. Last, `look` again at every clip: nothing clipped or crushed that was not meant, skin where it should be.

Say what changed in each clip with its numbers, and link each clip you graded (`film.html#<clip id>`).
