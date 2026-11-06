---
"openfilm": minor
---

The library's search understands what is meant, not only its words: `get music-search --prompt "sad goodbye at a train station"` finds farewells on strings, in any language. OpenFilm's service searches the library by meaning with a small multilingual model (free, no account, only the words of the search sent, nothing kept), so this computer keeps only the library's catalog and keyword index and downloads no model; offline, words are matched as before.
