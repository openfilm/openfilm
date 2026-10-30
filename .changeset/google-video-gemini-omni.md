---
"openfilm": patch
---

Google makes video clips with Gemini Omni Flash, since Google shut down the Veo 3.1 previews on the Gemini API on 22 October 2026 and video with a Gemini key stopped working. Clips are 16:9 or 9:16 at 720p with sound; the model sets their length (3 to 10 seconds) from the prompt, so `--duration` is noted and the clip's real length is returned. A first frame, a last frame (only with a first) and reference pictures are each bound to their role.
