---
"openfilm": patch
---

A page clip's `src` may carry a query, `<iframe src="step.html?n=2&title=Sign in">`: the page is opened with it and reads it in `location.search`, so one page can be several clips, each with its own words. film.html with one was refused before ("is no clip a film plays"), and Studio could not save edits to it. Studio's thumbnails and posters draw each clip with its own query; replacing the clip's file drops it. A `?` on a video, a picture or a sound now says that only a page reads a query.
