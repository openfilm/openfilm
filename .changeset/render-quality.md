---
"openfilm": patch
---

Render: `render --crf <n>` and `render --bitrate <rate>` set the picture's quality when a delivery asks for one. `--crf` encodes an MP4 with x264 at that CRF (1 to 51; 16 unless asked) and a WebM with VP9 (0 to 63; 20). `--bitrate 8M` (or `2500k`) holds the picture near that rate on average, and each browser then draws 5 s of the film at least, as a shorter part lands over its rate. Either is encoded by the processor, never the graphics chip: the chip's encoders take no CRF, and the Mac's lets a busy picture run far over a bitrate. A .mov is ProRes, so it takes neither, and the two together are refused. The summary line says which. Without either, nothing changes.
