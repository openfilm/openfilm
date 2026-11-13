---
"openfilm": minor
---

Studio's video export can meet a delivery's bitrate or file size (#367). Beside Standard, High and Master, the quality has Bitrate (the picture's average in Mb/s, peaks up to a fifth over) and File size (in MB, the sound included: the file stays under it, its picture's peaks held to the rate the size leaves). The dialog shows the rate a size leaves and refuses a size too small for the film's length.

For H.264, HEVC and VP9, encoded on the processor (x264, x265, libvpx), never the graphics chip, whose encoders may run far over a rate asked, and in parts of five seconds at least, long enough for the rate to settle. HEVC needs an ffmpeg with libx265. Without a target nothing changes. Exports asked through Studio's API take `bitrate` (and `maxrate`, its peaks) in place of `quality`.
