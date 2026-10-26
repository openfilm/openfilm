---
"openfilm": patch
---

Exports no longer come out black where a video can't be played. A video larger than 4096 on a side that the export's browser does not decode (ProRes from a camera larger than 4K, say) gets a copy scaled down to fit, as smaller ones get a copy at their size. A copy that could not be made is said in the render's log, and a video the browser still can't decode now fails the export, naming its clip and file, instead of drawing black frames and saying it is done. Studio's preview is unchanged.
