---
"openfilm": patch
---

At OpenRouter, Seedance fetches a voice recording (`--voice`) or a reference clip only from a web address. A run that can make a temporary address sends the file by that address; OpenFilm's own service is one such run. With your own key OpenFilm has nowhere to put the file, so this can't be done there: the run says so before anything is sent and points to fal, which takes the file straight from the project. Studio's OpenRouter card says the same. Anyone who needs it with their own key can add their own storage in `providers/openrouter.mjs`, for themselves or in a pull request. Previously OpenRouter refused the request with "Only HTTPS URLs are allowed".
