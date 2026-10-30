---
"openfilm": patch
---

Render: a render that stops (cancelled, an error, a crash, the computer asleep or out of power) is resumed by the next one of the same file with the same settings, which draws only what is left. The film is drawn in chunks of a second to ten that the browsers take in turn, and each chunk finished is kept with the files it was drawn from: a render that finds one of them changed, or other settings, starts clean. Studio's export resumes the same way. Chunks no one resumes are removed after two weeks, and so are the parts a crashed render left before.
