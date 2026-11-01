---
"openfilm": patch
---

Loudness: `render --loudness=<LUFS>` and a Loudness choice in Studio's video export bring the film's sound to a delivery target (-14 for streaming, -16 for podcasts, -23 for broadcast), its true peaks under -1 dBTP. The mix is measured, raised or lowered as a whole, and its few loudest peaks are caught by a limiter working at four times the sample rate, then measured again as encoded; the picture is not touched. `look --loudness=<LUFS>` says how far the mix is from a target. Without the option, nothing changes.
