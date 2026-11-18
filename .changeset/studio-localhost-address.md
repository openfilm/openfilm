---
"openfilm": patch
---

Studio: opened at `localhost` or `[::1]`, the editor goes to Studio's own `127.0.0.1` address. The page used to load and sign in on the alias, but every write was refused ("not from Studio") because a write's Origin had to be exactly `http://127.0.0.1:<port>`, and the film origin's CORS header named that origin too, so previews' media was blocked. The key the caller showed travels along; one it did not show is not added.
