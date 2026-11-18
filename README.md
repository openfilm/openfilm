<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
</p>
<p align="center">The open source AI video agent.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/openfilm"><img alt="npm" src="https://img.shields.io/npm/v/openfilm?style=flat-square" /></a>
  <a href="https://github.com/openfilm/openfilm/actions/workflows/ci.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/openfilm/openfilm/ci.yml?style=flat-square&branch=main&label=build" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/openfilm/openfilm?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.pt-BR.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.el.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://openfilm.dev"><img alt="Visit our website" src="docs/buttons/website.svg" /></a>
  <a href="https://discord.gg/a462Rs88hF"><img alt="Join our Discord" src="docs/buttons/discord.svg" /></a>
  <a href="https://www.youtube.com/@riverisbuilding"><img alt="Watch on YouTube" src="docs/buttons/youtube.svg" /></a>
</p>

[![OpenFilm: an agent makes a film while you watch, then you change it by hand](docs/openfilm.webp)](https://openfilm.dev)

---

### About

OpenFilm turns any coding agent into a video agent, with editors to change anything it makes.

You and the agent work on the same film, together and live. Whatever the agent changes, you see as it happens; whatever
you change, the agent sees too. The agent does most of the work; you point at anything and ask for a change, or make it
yourself.

- **The agent makes the film.** Use Claude Code, Codex, any other coding agent, or the one built into the desktop
  app. It finds footage, music and voices, writes each shot and cuts them together while you watch.
- **Point at anything.** A clip, a moment, a stretch of the timeline, a spot in the frame, a line of subtitles, a card
  on the canvas. Point at it, say what you want, and the agent knows exactly what you mean.
- **Change it by hand.** Inside any shot, move, scale and rotate any element, retype its text, restyle its color, font
  and size, and animate it, even word by word. On the timeline, trim, split and reorder clips, change their speed,
  volume and fades, crop, grade and cut out the background, and edit subtitles and voice-over. Your edits land in the
  same files, and the agent builds on them.

### Installation

**Desktop app.** [Download it for macOS or Windows](https://github.com/openfilm/openfilm/releases/latest). Everything
you need comes with it, down to a built-in agent, and it works with Claude Code or Codex if you already use them.

**Your own coding agent.** Add the skill (needs Node 22.2+ and ffmpeg), then ask for a film:

```bash
npx skills add openfilm/openfilm
```

> Make a 20-second launch video for my CLI, with music.

### Editors

Each editor is a different way to work on the same film, and in every one you and the agent work together. OpenFilm
comes with four, and more official editors are in development for different kinds of people: simple enough for anyone
to pick up, and professional workbenches for those who want them. Editors follow the Community's open standard, so
anyone can build one and share it.

- **Screening**: watch the film full size. Click a moment, drag across a stretch or circle part of the frame, and the
  agent knows what you are pointing at.
- **Edit**: a full timeline of clips, text, captions, voice-over and sound. Move, scale and restyle anything inside a
  shot. Export a video, or take the timeline to Final Cut Pro, Premiere Pro or DaVinci Resolve.
- **Canvas**: a board for planning, with notes, images, clips and voices side by side. Generate each with your
  services, then send them to the timeline in order.
- **Color**: grade every clip with scopes, color wheels and curves, from camera log footage or with `.cube` LUTs. What
  you preview is what you export.

All four share one library: your own footage in folders, linked rather than copied and found again when you move it,
alongside OpenFilm's free music, sound effects, voices and stickers.

### Community

The Community is an open standard for everything you can add to OpenFilm, and anyone can build for it.

- **Plugins** extend OpenFilm itself with new editors and connectors to outside services. OpenFilm's own editors are
  plugins, built the same way as anyone's.
- **Skills** teach the agent a way of making a kind of film.
- **Assets** are music, sound effects, transitions, effects, text styles, stickers and templates.
- **Examples** are complete projects to learn from and remix.

Each is a plain folder. Add one from the Community window in OpenFilm, or build your own:
[make a plugin](packages/openfilm/plugins/README.md), [write a skill](https://github.com/openfilm/community/blob/main/SPEC.md),
[share assets](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md), or share a finished film as an
example, then list it in [openfilm/community](https://github.com/openfilm/community).

### How it works

A film is a folder with a `film.html`: tracks of clips, styled with CSS.

```html
<meta name="viewport" content="width=1920, height=1080">
<section>
  <iframe src="title.html#t=0,4"
          overrides='[{"at":"h1","text":"Aura Pods","style":{"color":"#7fd4ff"}}]'></iframe>
</section>
<section>
  <video src="assets/footage.mp4#t=12,18" at="4" style="left: 160px; top: 90px; width: 1600px; height: 700px"></video>
</section>
<section>
  <audio src="assets/music.mp3" volume="0.6"></audio>
</section>
```

Each shot is a web page whose one function, `frame(t)`, draws any moment with anything a browser can draw (three.js,
WebGL, canvas, SVG, CSS, GSAP, video) and always the same picture for the same `t`, so it renders the same on any
machine, the agent can check every frame, and no framework such as Remotion or HyperFrames is needed.

```js
window.film = {
  frame(t) { /* draw the complete picture at t seconds */ },
};
```

**Your changes stay yours.** When you change something inside a shot by hand, such as its text, color, position or
size, OpenFilm saves it in the clip's `overrides` rather than in the page's code. The agent can rewrite the page and
your changes still apply. The full format is in [SPEC.md](packages/openfilm/SPEC.md).

### Contributing

To run OpenFilm from source or send a pull request, read [CONTRIBUTING.md](CONTRIBUTING.md). Report bugs in
[Issues](https://github.com/openfilm/openfilm/issues) with the report from Settings → Developer → Copy report, and
security issues as [SECURITY.md](SECURITY.md) describes.

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
