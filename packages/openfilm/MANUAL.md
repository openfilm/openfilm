# OpenFilm

You make films. A film is a web page, `film.html`, that cuts pages, footage, pictures and sound together. A page is a web page that sets `window.film` and draws any moment t it is asked for.

## The project

A folder:
- `film.html`: the film. The person edits it in Studio at any moment: read it right before you change it, and change only what you mean to.
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
- A track the person `locked` is theirs: change nothing on it. A `hidden` track shows and plays nothing; a `muted` one plays no sound.
- A clip is an element: `<iframe>` a page, `<video>`, `<img>` a picture, `<audio>` a sound.
  - `src`: its file, relative to film.html. `#t=in,out` says which seconds of it play, `#t=in` to its end; without it, all of them. A picture, or a page without a `duration`, needs `#t=0,length`: how long it stays.
  - `at`: where it starts in the film, in seconds; without it, 0.
  - `left`, `top`, `width`, `height` in its `style` (px) and `rotate` (degrees, clockwise): where it sits. Without them, a video or picture is the stage, and a page is its own size, centered. With only `width` or `height`, the other keeps its proportions.
  - Its look is CSS, in `class` or `style`: a video or picture fits whole in its box unless you say otherwise (`object-fit: cover` crops it to the box). The film's CSS holds still; what moves is a page.
  - `speed` (video and sound): 0.25 to 4. The clip lasts `(out − in) / speed` seconds.
  - `volume` (video and sound): 1 is the file's own level; `muted` silences it.
  - `id`: a name, unique in the film; without it, the file's name.
  - `overrides`: the person's changes made in Studio. Keep them as they are.
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

## Tools

Run them in the film's folder. Each one's `--help` lists its options:
- `npx openfilm open <folder>`: first. A new film gets a folder of its own, named after it (`open launch-video`); an existing one opens, and a GitHub address of one (a repository, or `…/tree/main/<folder>`) is copied into the projects library and opened. It prints Studio's address: open it in your built-in browser before you write anything and keep it open, so the person watches every change land and edits too. Without a built-in browser, Studio opens in the person's default browser by itself. `open` alone shows the film you are in, else the last one: run it when the person only asks to open OpenFilm.
- `npx openfilm look`: a contact sheet of the whole film with its sound, and a check that the same t draws the same picture. `look 4.5` is one frame at full size, `look 3-6` a stretch, `look assets/a.mp4` a media file.
- `npx openfilm render`: the MP4, beside film.html (30 fps unless `--fps`). Only when the person asks for the file: you check with `look`, and the person exports from Studio.
- `npx openfilm get`: voice-over, music, sound effects, transcripts, images, image search, video and web search. Each kind works only once the person has connected a service that makes it, with their own key, in Studio (Settings → Providers); Studio's subtitle translation too. Run it alone to see what works now and which services make the rest. When a kind is not connected, tell the person which services make it and where they connect one. A video clip costs a lot: the person confirms it in Studio first.

The words of a sound or a video are a WebVTT beside it with the same name (`vo/1.wav` → `vo/1.vtt`): a cue per subtitle line, a timestamp tag at each word. Studio makes the film's subtitles from them; never draw subtitles in a page.

Media can come from `get`, any service the person uses (with its API docs and their key), or your own code. Save it under `assets/`.
