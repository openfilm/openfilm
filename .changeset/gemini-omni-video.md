---
"openfilm": minor
---

Google's video model is Gemini Omni 1.2 Flash, with a Google key or through OpenRouter. It makes clips with their own sound, 3 to 15 seconds long (10 at most between a first and a last frame), wide or tall, 360p to 4K. A clip starts from a prompt, a first frame (and optionally a last one), or up to 6 reference pictures. Veo is no longer offered.

Gemini Omni also takes a clip from the project (`openfilm get video --video`), with a Google key or through OpenRouter. It edits the clip as the prompt says, or continues it when the prompt asks. `--duration` gives the 3 to 10 seconds a continuation adds; without it, the clip keeps its own length. A clip can be at most 15 s long to edit, and at most 30 s in all once continued. A made clip's length and size are read from the file that comes back.
