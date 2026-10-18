---
"openfilm": patch
---

A file whose name has `#`, `?` or `%` in it now plays in a film. Before, `#` made film.html fail to read, and `?` or `%` stopped the preview with an error, or left the file out. film.html writes those three characters escaped (`%23`, `%3F`, `%25`); every other character, Chinese punctuation and spaces included, is written as it is. A src written with escapes, like `my%20file.png`, now names `my file.png` in Studio too. A film's versions also keep such files, and files with quotes in their names.
