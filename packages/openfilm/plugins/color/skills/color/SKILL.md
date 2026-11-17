---
name: color
description: The film's color in OpenFilm, clip by clip. Read it when the person asks to grade, color-correct, white-balance, match shots, give the film a look, apply a LUT, or fix footage that looks flat, grey, too warm or too dark (camera log).
---

# Color

A clip's grade is the color transform files its style's `--of-lut` names, in order (SPEC.md). OpenFilm's grades
are in three parts, the part a file plays said by its name:

```html
<video id="s7" src="beach.mov" style="--of-lut: url(looks/in-sony-slog3.ctf) url(looks/beach.ctf) url(looks/shot-s7.ctf) url(looks/out-rec709.ctf)">
```

- `looks/in-<footage>.ctf`: the footage into the working space, ACEScct. Ordinary video's (`in-rec709.ctf`) is the
  exact inverse of the output, so input and output alone change nothing.
- Layers, any other name: what the grade does, each in ACEScct. Clips that name the same file are graded by it
  together (`looks/beach.ctf`, the scene); a clip's own changes go in `looks/shot-<clip id>.ctf`.
- `looks/out-rec709.ctf`: ACEScct to the screen, the same for every clip. A `.cube` look the person has, made for
  ordinary video, goes after it, last; so does a library filter, `looks/filter-<name>-<strength>.ctf`, which alone is
  the whole chain of ordinary video with nothing else graded.

The input and output files are OpenFilm's: never edit them. `openfilm color input` sets an input and puts the files in
`looks/`. Layers are yours to write and change, as `.ctf` files: `<ProcessList version="2.5" id="…">`, each operation
with a `name` and `inBitDepth="32f" outBitDepth="32f"`. These are played and exported, and their numbers are in ACEScct
(0.4135 is mid grey; an offset of 0.057 is a stop):

- `ASC_CDL` with `style="FwdNoClamp"`
- `GradingPrimary`, `GradingTone`, `GradingRGBCurve`, `GradingHueCurve`, each with `style="log"`, made for this space:
  `GradingPrimary`'s contrast turns about 0.4, mid grey, as it is
- `Matrix`, `LUT1D`, `LUT3D`

A hue curve's x is the hue, 0 to 1 round from magenta: red 0.17, yellow 0.33, green 0.5, cyan 0.67, blue 0.83.
`HueSat`'s y is a gain (1 changes nothing), `HueHue`'s the hue it becomes. Skies a little richer:

```xml
<GradingHueCurve name="sky" inBitDepth="32f" outBitDepth="32f" style="log">
    <HueSat><ControlPoints>0 1  0.6 1  0.76 1.25  0.9 1  1 1</ControlPoints></HueSat>
</GradingHueCurve>
```

Change one operation and leave the rest of a file as it was: others' operations and comments are theirs. Ungrading a
clip of ordinary footage takes its `--of-lut` away. Studio shows each change of a file a moment after it is written.

A page (`<iframe>`) or a still (`<img>`) is graded the same way, by the same files, its picture being what the screen
shows: its input and output are not applied, its layers work in ACEScct from its picture, and a filter or a `.cube`
after the output on the picture as shown. On a page or a still, `GradingHueCurve` and `LUT3D` are left out (the
browser draws the grade as an SVG filter, which cannot): grade it with the others, and say so when the person asks for
what only a hue curve does. A code-made picture is often dark or saturated on purpose: read `look`'s `!` against what
the film means before you balance it.

## Commands

- `openfilm color look [clip…] [t | a-b]`: each clip's picture as it plays, measured (every clip with a picture, a
  video, a page or a still, when none is named): exposure in IRE, what is clipped or crushed, white (kelvin and tint of what is nearly grey), saturation,
  skin-tone hues, and the jump from the clip before. `✗` and `!` say what is off. It saves a picture of each: the file
  as it is beside it graded, over its waveform and vectorscope. Read them.
- `openfilm color input [clip…|all] [kind]`: what each clip's footage is and what its file says, and the kinds there
  are; with a kind, set it. Log footage does not say which log it is: ask the person when `look` reads a clip flat
  and pale and you cannot tell.
- `openfilm color balance <clip…|all>`: its greys made grey (with little grey in it, its brightest made white) and its
  middle at a usual exposure, as an `ASC_CDL` named `balance` in the clip's own layer.
- `openfilm color match <clip…> --to <clip|picture>`: each color channel brought to the reference's, for shots of the
  same scene, as an `ASC_CDL` named `match` there.
- `openfilm color filter`: the library's filters, ready-made looks. `openfilm color filter <clip…|all> <id> [strength]`
  puts one on at a strength (0–100), `none` takes it off.

The person's sliders in Studio are a clip's own layer's `adjust` (a `GradingPrimary`) and `adjust-tone` (a
`GradingTone`): read them, and change them only when asked to.

## Grading a film

Look first. Footage gets its input before anything else. Then the clips of a scene are matched to its best one, so a
cut does not jump, and a clip with none like it is balanced. Then what the person asked for, in layers you write or
a library filter, in small steps, looking after each. What you hand back has nothing clipped or crushed that was not
meant, and skin where it should be.

Say what changed in each clip with its numbers, and link the clips (`film.html#s7`) and the layers you wrote
(`looks/beach.ctf`).
