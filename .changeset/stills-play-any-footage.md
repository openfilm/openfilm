---
"@openfilm/desktop": patch
"openfilm": patch
---

Footage the browser can't decode now shows everywhere a film is drawn, not only in exports: `openfilm look`, posters, stills and slides, Studio's film cards, and page thumbnails. This covers ProRes, and HEVC on a computer without a chip for it. Each place draws it through the same copy an export makes. Studio's preview also plays that copy when no proxy is ready. A video exported with its subtitles burned in gets these copies too; before, its ProRes footage came out black.
