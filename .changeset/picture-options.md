---
"openfilm": patch
---

`openfilm get image` takes every quality GPT Image 2.5 has (`--quality low|medium|high|xhigh|max`, low by default), a size (`--size 1k|2k|4k`), 21:9, up to 16 pictures to make one from (`--ref`), and a mask that redraws part of the first (`--mask`, OpenAI's own). OpenAI and OpenRouter send all of it as each takes it; Gemini and FLUX take the size and say what they leave out. OpenRouter offers GPT Image 2.6 Flare and Sunburst first, then GPT Image 2.5 Flare and Sunburst, and Seedance 2.0 Mini, Wan 3.0, Wan 3.0 Prime, MiniMax Hailuo 3, MiniMax Hailuo 3 Max and HeyGen Video for video, each clip asked for the size its model makes; `get video --duration` goes down to 2 seconds, each model making its shortest at the least. A run of the OpenFilm service is asked about soon after it begins, and a picture's cost is worked out from the tokens OpenAI billed.
