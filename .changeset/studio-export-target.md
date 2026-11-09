---
"openfilm": patch
"@openfilm/desktop": patch
---

Studio: video exports can target an average video bitrate or an approximate file size, with an estimate before exporting. H.264, HEVC and VP9 targets use software encoding and longer parts so the rate can settle. Size includes sound and is calculated from the actual selected duration. Automatic quality remains the default; targets are not hard size or peak-bitrate limits.
