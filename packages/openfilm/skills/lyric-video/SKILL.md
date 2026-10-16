---
name: lyric-video
description: Make a lyric video for a song at the level of the best official ones — a visual world designed for this one song, the lyrics as the picture, every word landing exactly on the voice. Use when the person gives a song (with its lyrics or an .lrc file) and asks for a lyric video, a music video with words, karaoke-style lyrics or a song post (歌词视频, 动态歌词, 歌词 MV, 卡拉OK).
---

# Lyric video

## The standard

Make the lyric video this song deserves: one a label would release as the official video, that people share because
of how it looks, and that a top motion designer would be proud to sign. Not a draft, not a template with the words
swapped in. Every frame is designed.

Aim past the first idea that comes to mind. The look that fits any song — flat vector scenery, cartoon skylines and
moons, a gradient sunset, a line of text at the bottom — is the look to avoid unless this song truly calls for it, and
then only executed at a professional level.

## Find this song's look first

Before building anything, listen to what the song is, and design from it:
- **The song**: genre, era, tempo and groove, the arrangement (sparse or dense, acoustic or electronic), where it
  builds and releases, the singer's voice.
- **The words**: their images (places, weather, objects, colors), their feeling, who speaks to whom, the language and
  how its characters look.
- **The person's world**: their cover, photos, footage, the band's identity.

From these, choose one direction that could only belong to this song, and push it further than safe. Consider the
whole range — for example:
- **Typography as the art**: kinetic type, Swiss or editorial grids, oversized type cropped by the frame, words that
  build, break, stretch or collide; variable fonts that breathe; calligraphy and brush lettering; vertical Chinese or
  Japanese set like a poem.
- **Space**: 3D letters in a world the camera flies through, depth of field, words as architecture, light and fog.
- **Cinema**: photographic or filmed images (the person's, or generated), color grading, anamorphic light, grain,
  slow motion, the words placed in the scene like part of it.
- **Craft and print**: ink wash and rice paper, risograph, screen print, cut-paper collage, halftone, stop motion,
  hand-drawn frames.
- **Eras and media**: film, VHS and CRT, 80s neon, city pop, Y2K chrome, glitch and datamosh, old signage.
- **Generative**: particles that become words, flow fields, shaders of liquid, smoke, light; visuals that react to the
  music's beats, energy and spectrum.
- **Restraint**: one color, one typeface, perfect timing and spacing, silence used as much as motion.

Write the direction down in a few lines at the top of the plan (`direction.md`): the idea in one sentence, the
references in the person's words, palette, typefaces, how type and camera move, what each section does. Then build
it.

## The means

Everything you know how to make pictures with is allowed, and the best results usually combine several. What follows
is a reminder of the range, not a limit:
- **In the page, on the web platform**: HTML and CSS (masks, clip paths, blend modes, filters, backdrop filters, 3D
  transforms, perspective, variable fonts, text strokes and shadows); SVG (paths, morphing, stroke drawing, gradients,
  turbulence, displacement and lighting filters); Canvas 2D (particles, pixel and text-to-pixel effects, offscreen
  buffers); WebGL, WebGL 2 and WebGPU with GLSL or WGSL shaders (noise, signed distance fields, raymarching,
  feedback, fluid and reaction-diffusion simulations, post-processing chains).
- **Libraries in the page**: 3D engines (three.js with its post-processing, Babylon.js, PlayCanvas, OGL, regl); 2D
  engines (PixiJS, p5.js, Paper.js, Two.js); type tools (opentype.js or fontkit to turn glyphs into paths, SDF/MSDF
  text for crisp 3D type, splitting text into characters and strokes); animation (GSAP and its plugins, anime.js,
  Motion, Theatre.js, Lottie, Rive); physics (Matter.js, Rapier, cannon-es — simulated ahead so each t has one state);
  generative tools (noise, flow fields, L-systems, D3 for data and layout).
- **Outside the page, made into clips**: Blender driven by Python (3D type with extrusion and bevel, geometry nodes,
  particles, cloth, fluid, smoke and rigid-body simulations, Grease Pencil drawing, shader nodes and the compositor,
  EEVEE for speed and Cycles for the final); any other renderer or tool that runs from a script (Manim, Processing,
  POV-Ray, Godot, Inkscape, ImageMagick, Pillow, OpenCV for tracking, masks and optical flow); ffmpeg filters
  (LUT color grading, blends, displacement, glitch, time remapping, frame interpolation) and image sequences encoded
  once into a clip.
- **Generated media**: images, video, music, sound effects and voice from `npx openfilm get` when those services are
  connected, or from any service the person uses with their own key.
- **The person's own**: their cover, photos, footage, logo, handwriting.
- **Type**: any font whose license allows it (for Chinese, for example Noto Serif SC, Noto Sans SC, LXGW WenKai, ZCOOL
  XiaoWei, Ma Shan Zheng, Zhi Mang Xing, Long Cang), lettering drawn as paths, brush strokes animated along a glyph.
- **The audio itself**: beats, onsets, energy and spectrum (ffmpeg, numpy and scipy, or any analysis library you
  have), transcripts with word times, forced alignment — to time the words and to drive the picture.

The rules are only OpenFilm's: the picture at t depends on t alone, and a page has no sound. What you make outside a
page enters the film as a clip under `assets/`; keep the script that made it in the project, so a change can be made
again. Ask before downloading or installing anything large (hundreds of megabytes) onto the person's computer.

## The bar

The film is done when all of this is true:
- **The type is the picture**: the lyrics are drawn in the pages, big and composed for their words — never a subtitle
  line, and never the film's subtitles (leave no transcript beside the song, or Studio shows the words twice).
- **Sync**: every character (or word, in spaced languages) appears or takes its accent on its sung onset, within two
  frames, measured against the audio, never estimated. An LRC gives only where lines start. Use the most accurate
  source you can get: see what `npx openfilm get` can do here first (a connected transcript service gives word
  times), then check every time against the voice in the audio itself and fix the ones that are off. The check must be
  independent of whatever produced the times: a tool agreeing with itself proves nothing. Held notes stay held; pauses
  stay empty. Report the result as numbers: how many words are within two frames, and the largest gap.
- **The words**: exactly the person's lyrics, order, line breaks and language; nothing retyped, translated or added
  (title and artist cards aside).
- **Readable**: every line legible at phone size for its whole time on screen; the line being sung unmistakable.
- **One idea, developed**: verse, chorus and bridge each with their own treatment; the chorus recognizable each time
  and biggest the last time; key words staged for what they mean.
- **Professional craft**: light, depth, texture, color and motion that would stand next to the best work of its kind;
  motion with weight and intent, never a default fade on everything, never jittery, never a long still. Text laid over
  a gradient or a flat illustration does not meet it: the picture needs real depth, material and light, from whichever
  means above get there.
- **Open and close**: title and artist before the first line; an ending that resolves with the music.
- **Editable**: a word or a time fixable in one place. Type drawn in pages stays adjustable in Studio; type rendered
  elsewhere (in Blender, say) is made again by its script.

Then judge it honestly: look at the whole film and at each section's entrance, chorus and key words at full size.
Ask whether it would hold up next to the best lyric videos you know. Where it would not, push it further and look
again — at least one full pass of refinement after the first complete version.

## From the person

The song, and the lyrics as given; title and artist from the LRC tags or the file name, or ask. Ask, without holding
up the work, for a cover, photos, footage or a mood they have in mind, and use what they give.

When done, tell them in a few lines: the direction and why it fits the song, how the timing was measured and how
close it is, and what of theirs would make it better.
