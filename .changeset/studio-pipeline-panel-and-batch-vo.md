---
'openfilm': minor
---

Studio shows the production line: a small gauge in the top bar of where the film is, opening to the stages, what each leaves, and what the check says is still missing — in the person's language, read again as the agent works. And the voice comes in one command: `openfilm get tts --storyboard` speaks every shot of the storyboard that says a vo, to `assets/audio/vo/shot-<n>` where the check expects it (the ones recorded already are left; `--force` says them again; one that fails does not stop the rest). `openfilm get` also ends with its own exit status again, instead of always 2.
