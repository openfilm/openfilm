---
name: media
description: Media for an OpenFilm film. Read it before you add music, a sound effect or a sticker, and before you make voice-over, pictures, video or transcripts, or search the web.
---

# Media

`openfilm get` brings media into the project, under `assets/`. Alone it lists what works now; `openfilm get <what> --help` says what one takes. Look in this order:

1. The person's own: `get my-media --prompt "<words>"` searches what they keep for every film and what they linked in from this computer (`--kind video|image|audio`; without words, the newest). What they shot or already paid for comes before anything new.
2. OpenFilm's library, free, offline and CC0: `get music-search`, `get sfx-search` and `get sticker`, each with `--prompt "<what>"` in any words and language. Each match says what of the prompt it has and lacks.
3. A service the person connected in Studio: voice-over, music and sound effects made to your prompt and length (`get music`, `get sfx`), transcripts, images, image and video search, video, and web search. Make music or a sound when the person asks for something original, when it must fit the picture exactly, or when the library lacks it. A video costs a lot: the person confirms it in Studio first. For a kind nothing makes yet, `get` names the services that do: tell the person.

`--take <id>` brings the match you chose into the project and says how to use it. Media can also come from any service the person has a key for (with its API docs), or from your own code. A service not built in can be added as a provider: `openfilm get` ends by saying how.

The services and models are the person's choice: `get` uses the one they chose for each kind. Name another with `--via` or `--model` only when they ask, or when theirs cannot do the job (a picture changed in part needs a model that redraws where a mask says), and say which you used and why. Services, their keys, and which plugins and skills are on are theirs to change in Studio: tell them what to change.

A paid run that timed out or did not download is recovered by running the exact same command again (the same output, prompt, model and files), never by making another: `--fresh` makes and pays for a new one, only when the person wants that.
