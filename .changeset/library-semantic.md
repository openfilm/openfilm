---
"openfilm": minor
---

The library's search understands what is meant, not only its words: `get music-search --prompt "sad goodbye at a train station"` finds farewells on strings, in any language, on this computer. A small multilingual model (about 150 MB) is fetched in the background on the first search and kept for every OpenFilm here; until it is there, or offline, words are matched as before.
