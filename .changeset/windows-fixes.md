---
"openfilm": patch
---

Windows: an ffmpeg that is stopped (a cancelled render or export, a mix that runs too long) ends with the real ffmpeg
behind a Chocolatey or Scoop shim; a name with a `:` is cleaned on import, rename and new folders as on macOS and
Linux, not refused; Studio's supervisor opens the null device by its Windows name.
