<p align="center">
  <br>
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="72">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="72">
</p>

<h3 align="center">The open source AI video agent.</h3>

<p align="center">One HTML file, one function, one real editor.</p>

## About

OpenFilm lets your coding agent make videos, and lets you edit them.

Ask Codex, Claude Code or any coding agent to make a film. It writes the film as web pages, and Studio, a local
editor that runs in your browser, shows it taking shape. Then change anything you like, by hand or by asking.

- **One HTML file.** `film.html` cuts animated web pages, footage, pictures and sound together on tracks, styled
  with CSS. Nothing new to learn: your agent already knows the web.
- **One function.** Each shot is a web page that draws any moment with `frame(t)`, using anything a browser can
  draw: three.js, WebGL, canvas, SVG, CSS, GSAP, video and more. No framework (like Remotion or HyperFrames): one
  function is enough.
- **One real editor.** Move, scale and rotate any element inside a page, change its text, color and style; place,
  crop and restyle every clip, trim and cut them on the timeline.

<p align="center"><img src="docs/openfilm.webp" alt="An agent makes a film with OpenFilm; it is then changed by hand in Studio" width="900"></p>

## Install

Requires Node 22.2+ and ffmpeg, on macOS, Windows or Linux (git too, for Studio's saved versions); the first run
downloads a headless Chromium (about 100 MB).

```sh
npx skills add openfilm/openfilm
```

Then ask your agent for a film:

> Make a 20-second launch video for my CLI, with music.

It opens the film in Studio and you watch it take shape. If your agent has no skills, tell it: "Run
`npx -y openfilm@latest` and follow the manual it prints."

Or download the desktop app for macOS or Windows from [openfilm.dev](https://openfilm.dev) or
[Releases](https://github.com/openfilm/openfilm/releases): Studio with a chat beside it for the agents you have.

Making, editing and rendering films needs no account. For generated voice, music, images and video, connect the
services you use (ElevenLabs, OpenAI, Google, fal and others) with your own keys in Studio's Settings → Providers.

To start from a finished film, open one of the [examples](https://github.com/openfilm/examples):

```sh
npx -y openfilm@latest open https://github.com/openfilm/examples/tree/main/one-prompt
```

## Commands

Your agent runs them; so can you, with `npx -y openfilm@latest <command>` or `npm i -g openfilm`.

```sh
openfilm                          # the manual: all an agent needs to know
openfilm open   [folder | url]    # show a film in Studio: a new one, an existing one, one from GitHub, else this one or the last
openfilm look   [what] [t | a-b]  # check the film, a page or a media file: a contact sheet, one frame, or a range
openfilm render [a-b]             # the MP4; --4k, --blur (motion blur), --alpha (.webm / .mov)
openfilm get    [what]            # voice-over, music, sound effects, transcripts, images, video, from your services
```

`openfilm <command> --help` lists a command's options; `openfilm get` alone lists what can be made and how to
connect a service in Studio with your own key.

## Studio

Studio runs on your machine, in your browser. Everything in the film can be changed: text and layers in the
picture, clips on the timeline, their place, look, volume and speed, and the subtitles. Your edits are saved to the
film's files, so the agent sees and keeps them, and you can save named versions to go back to. Export a video, a GIF,
the sound or its stems, subtitles, stills, slides, a transparent video, or the timeline itself for Premiere Pro and
DaVinci Resolve.

The desktop app ([apps/desktop](apps/desktop)) is Studio with a chat beside it, for Claude Code, Codex and the other
agents, or its own agent with your own key.

## How it works

A film is a folder with a `film.html`: tracks of clips cut together.

```html
<meta name="viewport" content="width=1920, height=1080">
<style>
  .card { object-fit: cover; border-radius: 24px; }
</style>
<section>
  <iframe src="title.html#t=0,4"></iframe>
</section>
<section>
  <video src="assets/footage.mp4#t=12,18" at="4" speed="0.5" class="card" style="left: 160px; top: 90px; width: 1600px; height: 700px"></video>
</section>
<section>
  <audio src="assets/music.mp3" volume="0.6"></audio>
</section>
```

Each `<section>` is a track, in the order the timeline shows them: the first on top. A clip is an element: a page,
a video, a still picture or a sound. Which part of its file plays is a media fragment (`#t=12,18`), where it starts
is `at`, where it sits is its style's `left`, `top`, `width` and `height`, and how it looks is CSS. Every sound is a
clip of its own. `overrides` hold your changes to elements of a page, and agents keep them when they edit.

A page is a web page that draws any moment of itself, and that is the whole contract:

```html
<script type="module">
window.film = {
  frame(t) { /* draw the complete picture at t seconds, with anything */ },
  duration: 4,               // optional: its own length, in seconds
  ready: loadFonts(),        // optional: a Promise for fonts, images, models, data
  width: 480, height: 320,   // optional: a page that is only a part of the picture
};
</script>
```

**The one rule:** the same `t` always draws the same picture, whatever was drawn before. Frames are asked for out of
order, in parallel and between frames (for motion blur), so a page that keeps the rule renders the same at any size,
on any machine. Anything else that makes pictures (Python, Blender, a video model) comes in as video or images.

OpenFilm spends its effort where models fail: checking the film. `look` draws every frame of its sheet twice, in two
shuffled orders, and names any that changed, along with page errors, fonts that failed to load, missing sound files,
and text cut off by the frame.

[MANUAL.md](packages/openfilm/MANUAL.md) is what `openfilm` tells your agent; [SPEC.md](packages/openfilm/SPEC.md)
is for anyone building a player, renderer or editor.

## From source

You need Node 22.18 or later, pnpm 9 (`corepack enable` gives you the version this repository names), ffmpeg on the
PATH, and git.

```sh
git clone https://github.com/openfilm/openfilm && cd openfilm
pnpm install
pnpm dev            # Studio from this checkout, with a sample film, apart from an installed OpenFilm
pnpm test
```

`pnpm dev` also prints a command your coding agent can run to make films with your checkout, in that Studio.

`pnpm dev:desktop` runs the desktop app from source, and `pnpm typecheck`, `pnpm build` and `pnpm audit:public` do
what they say.
[CONTRIBUTING.md](CONTRIBUTING.md) has the details of each package.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, see [SECURITY.md](SECURITY.md).

## License

The format, the CLI, Studio and the desktop app are [MIT](LICENSE). The OpenFilm name and logo are trademarks: see
[TRADEMARK.md](TRADEMARK.md).
