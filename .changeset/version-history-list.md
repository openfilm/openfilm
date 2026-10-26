---
"openfilm": minor
---

Studio: Version history works like VS Code's Source Control. Write a message and Commit; the Changes list shows the files changed (A, M, D) and can discard them all; the Graph shows every version as a line, the one checked out with a hollow dot and Current, and a click lists what a version changed. Checking out a version makes no version of its own: the folder holds its files and the next commit goes from there (with uncommitted changes it asks first). A version keeps all the project's files except media the film doesn't use, so a font or data file a page loads by a path it builds is no longer missed. After a checkout the timeline's markers, the frame rate, track names and subtitles follow the version in every window. Version history no longer spins forever when it can't be read: it says so, with Try again. Settings › Advanced › Versions has Auto versions (off by default; a version only when the film changed) and Show auto versions (off by default).
