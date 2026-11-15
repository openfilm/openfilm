---
"openfilm": patch
"@openfilm/desktop": patch
---

Send media files with spaces in their names when using OpenFilm's service, including video first and last frames, reference images and transcription recordings. Report an unreadable input locally before submitting the run.

Generated media names also accept spaces, punctuation, emoji and all languages, including combining characters. Reject names that cannot be saved across supported file systems before starting a paid request.

Keep these names when making another take, fit the numbered name within file system limits, and avoid collisions between equivalent Unicode spellings.
