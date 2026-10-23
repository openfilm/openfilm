---
"openfilm": patch
---

`openfilm get call --path` also takes the path without its leading slash (`--path speech` is `/speech`), so it works from Git Bash on Windows, which turns an argument starting with `/` into a folder path. A path Git Bash turned that way now gets its own message: drop the leading slash or put `MSYS_NO_PATHCONV=1` in front of the command.
