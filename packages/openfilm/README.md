# openfilm

The open source AI video agent: films as web pages, the manual that teaches your coding agent to make them, the
`openfilm` command, and Studio, the editor to change anything in them.

Ask Codex, Claude Code or any coding agent to make a film. It writes the film as web pages (`film.html` cuts them
together with footage, pictures and sound), and Studio, a local editor in your browser, shows it taking shape. Then
change anything you like, by hand or by asking.

## Install

Requires Node 22.2+ and ffmpeg, on macOS, Windows or Linux; the first run downloads a headless Chromium.

```sh
npx skills add openfilm/openfilm
```

Then ask your agent for a film. If your agent has no skills, tell it: "Run `npx -y openfilm@latest` and follow the
manual it prints."

## Commands

```sh
openfilm                          # the manual: all an agent needs to know
openfilm open   [folder | url]    # show a film in Studio (a GitHub address fetches it first)
openfilm look   [what] [t | a-b]  # check the film, a page or a media file
openfilm render [a-b]             # the MP4; --4k, --blur, --alpha
openfilm get    [what]            # voice-over, music, sound effects, transcripts, images, video, from your services
```

`MANUAL.md` (in this package) is what `openfilm` tells your agent, and `SPEC.md` is the film format, for anyone
building a player, renderer or editor. Settings, how it works and the source:
[github.com/openfilm/openfilm](https://github.com/openfilm/openfilm).

## License

[MIT](LICENSE). The OpenFilm name and logo are trademarks: see [TRADEMARK.md](TRADEMARK.md).
