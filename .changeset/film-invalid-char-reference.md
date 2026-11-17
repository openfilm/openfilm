---
"openfilm": patch
---

Film: a numeric character reference outside Unicode (`&#x110000;`, `&#0;`, a surrogate such as `&#xD800;`) reads as U+FFFD, as a browser reads it, instead of throwing `RangeError: Invalid code point`. One such reference anywhere in a `film.html` made the whole film unopenable: Studio answered 500, and `openfilm look` and `openfilm render` stopped with the stack trace.