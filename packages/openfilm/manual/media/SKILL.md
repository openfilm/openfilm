---
name: media
description: Media for an OpenFilm film. Read it before you add music, a sound effect, a transition, an effect, a filter, a sticker, a text animation or a template, and before you make voice-over, pictures, video or transcripts, or search the web.
---

# Media

`openfilm get`: media for the film. First OpenFilm's own library, free, offline and CC0: `get music-search`, `get sfx-search`, `get transition`, `get effect`, `get filter`, `get sticker`, `get text` and `get template`, each `--prompt "<what>"` in any words and language; each match says what of your prompt it has and lacks, and `--take <id>` copies the one you choose into the project and prints what to put in film.html. Look there before writing a transition, an effect, a text or a template yourself. The rest is made by a service the person connected in Studio (Settings → Services): voice-over, music and sound effects to your prompt and length (`get music`, `get sfx`, at a cost), transcripts, images, image search, video and web search. Make music or a sound when the person asks for something original, when it must fit the picture exactly, or when the matches lack what was asked; when the person says which they want, do that. `get` alone lists what works now; for a kind not connected, tell the person which services make it and where they connect one. A video clip costs a lot: the person confirms it in Studio first. Its `--help` lists the verbs and their options.

Media can come from `get` (OpenFilm's library, or a service that makes it), any service the person uses (with its API docs and their key), or your own code. Save it under `assets/`.

When the person wants a service that is not built in to make pictures, clips or sounds (on the canvas too), add it as a provider: `openfilm get` ends by naming its folder, the contract it follows and a built-in one to read. Write it from the service's API docs, then try it with `get <verb> --via <id>` once the person has added its key in Settings → Services.
