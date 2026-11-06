---
name: edit
description: How an OpenFilm film is made, and how to see it. Read it whole before you make or change a film, its film.html or its pages, and before you look at one.
---

# Making a film

## The project

A folder:
- `film.html`: the film. The person edits it in Studio at any moment: read it right before you change it, and change only what you mean to. Take a file out of it before you delete the file, so the film never points at one that is gone.
- Pages (`*.html`): pictures written as code, with the files they load by relative path.
- `assets/`: media files (video, pictures, sound). The person sees every one in Studio: keep only what the film can use, and delete the pieces you made them from.
- Files and folders starting with a dot (`.film`, `.git`) belong to the tools: leave them.

## film.html

    <!doctype html>
    <html>
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=1920, height=1080">
    <style>
      .card { object-fit: cover; border-radius: 24px; }
    </style>
    </head>
    <body>
    <section>
      <iframe src="title.html"></iframe>
      <img src="assets/logo.png#t=0,3" at="6" style="left: 1640px; top: 60px; width: 200px">
    </section>
    <section>
      <video src="assets/a.mp4#t=2,8" at="2" class="card" style="left: 160px; top: 90px; width: 1600px; height: 700px"></video>
    </section>
    <section>
      <audio src="assets/bed.mp3" volume="0.6"></audio>
    </section>
    </body>
    </html>

- The viewport is the film's frame, in CSS pixels; without it, 1920×1080.
- Each `<section>` is a track of clips that do not overlap; any clip goes on any track. The sections are the tracks as Studio's timeline shows them, top first: the first one's pictures are on top, so titles go before the footage they cover, and the background last. What a page does not paint is transparent; a moment with no clip is black.
- Put a new clip on a track that is free at its time and holds clips like it: titles with titles, footage with footage, sound with sound. Add a track only for a clip that must be over or under one already there at that time, and leave no track empty.
- A track the person `locked` is theirs: change nothing on it. A `hidden` track shows and plays nothing; a `muted` one plays no sound.
- A clip is an element: `<iframe>` a page, `<video>`, `<img>` a picture, `<audio>` a sound.
  - `src`: its file, relative to film.html. `#t=in,out` says which seconds of it play, `#t=in` to its end; without it, all of them. A picture, or a page without a `duration`, needs `#t=0,length`: how long it stays.
  - `at`: where it starts in the film, in seconds; without it, 0.
  - `left`, `top`, `width`, `height` in its `style` (px) and `rotate` (degrees, clockwise): where it sits. Without them, a video or picture is the stage, and a page is its own size, centered. With only `width` or `height`, the other keeps its proportions.
  - Its look is CSS, in `class` or `style`: a video or picture fits whole in its box unless you say otherwise (`object-fit: cover` crops it to the box).
  - It moves by CSS animation: `animation` in its `style`, its `@keyframes` in film.html's `<style>`. Its time starts at the clip's `at`. Move it with `translate` (px, or `vw`/`vh` of the stage), `scale` and `rotate`, never `transform`, `left` or `top`: these go on top of its box, about its center. `--clip-length` is how long the clip is (`4.2s`): time a way out from its end with it. For example a slow push in and a push out to the left:
    `<style>@keyframes push { from { scale: 1 } to { scale: 1.1 } } @keyframes out { to { translate: -100vw 0 } }</style>` … `style="animation: push var(--clip-length) linear both, out .5s ease-in calc(var(--clip-length) - .5s) both"`. Shots that follow one another go end to end on one track. A transition at a cut is one of the library's (`openfilm get transition`, see media), put over the cut as its `--take` says; one of your own is each shot's way in and out on that same track. Only two clips that must show at once, one fading over the other, overlap on two tracks.
  - `speed` (video and sound): 0.1 to 100. The clip lasts `(out − in) / speed` seconds. To make it faster or slower, change `speed` only: never make the file again at another speed, nor move its `.vtt`'s times. Its words (the `.vtt` beside it) follow `speed` on their own.
  - `volume` (video and sound): 1 is the file's own level; `muted` silences it.
  - `id`: a name, unique in the film; without it, the file's name.
  - `overrides`: the person's changes made in Studio. Keep them as they are.
  - `size` (page): the px a page without its own `width` and `height` is laid out at; without it, the stage's. Studio sets it when the frame changes shape. Keep it as it is; remove it only when you lay the page out again for the new frame.
- Cut a long recording by trimming it: every clip of it is the same file with its own `#t=`. Never cut, crop or re-encode media into new files; CSS crops.

## A page

    <script type="module">
    window.film = {
      frame(t) { /* draw the whole picture at t seconds */ },
      duration: 6,                  // optional: the page's own length, in seconds
      ready: loadEverything(),      // optional: a Promise; drawing starts once it settles
      width: 480, height: 320,      // optional: a page that is only a part of the picture
    };
    </script>

**The one rule: the picture depends only on t.** The same t always draws the same picture, whatever was drawn before and in whatever order.

- One shot per page: a film of five shots is five pages cut together in film.html, so the person can trim, reorder and replace each one. What the pages share (fonts, colors, a logo) goes in a file they load.
- Studio edits elements, not pixels: make what the person may change a DOM element.
- Without `width` and `height`, a page is the size of the stage: lay it out for it. With them (a chart in a corner), it is that size, and its clip's style puts it in place.
- A page's t is its own time, starting at 0. Where it sits in the film, and for how long, is film.html's.
- The host calls `frame(t)`; a page never animates by itself (no animation loop, no autoplay).
- The picture is captured once `frame` returns, or once the Promise it returns resolves. Create a WebGL context with `preserveDrawingBuffer: true`.
- A page has no sound: every sound is a clip in film.html. A shot's sound effect goes at the film second it plays: the page clip's `at`, plus the page's t, less the clip's in point (a hit at t = 2 in a clip at 5 goes at 7). When you move the page clip, move its sounds with it.

The words of a sound or a video are a WebVTT beside it with the same name (`vo/1.wav` → `vo/1.vtt`): a cue per subtitle line, a timestamp tag at each word. When the person asks for captions, Studio makes a caption track of them (SPEC: Captions); never draw subtitles in a page.

## Seeing it

`openfilm look`, in the film's folder: a contact sheet of the whole film with its sound, and a check that the same t draws the same picture. `look 4.5` is one frame at full size, `look 3-6` a stretch, `look assets/a.mp4` a media file. After a render, `look --full` watches every frame of the rendered film for white flashes, jumping frames, still pictures and black, and `look --loudness=-14` says how far the mix is from a delivery loudness. Reading a frame it saves shows it to you: check every shot with it after you change the film, and never say it works or looks right before you have.
