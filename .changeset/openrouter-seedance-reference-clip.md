---
"openfilm": patch
---

At OpenRouter, Seedance takes a clip as a reference (`openfilm get video --video`), alongside its pictures and voice. The clip must be 2 s up to the model's longest length. It is sent by a temporary web address, which OpenFilm's own service gives it; with your own key this can't be done, and the run says why. A first frame given with a reference clip is used as one of the reference pictures, and a last frame is left out. Gemini Omni still edits or continues a clip.
