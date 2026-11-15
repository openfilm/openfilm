---
"openfilm": minor
"@openfilm/desktop": minor
---

Add local video background removal and face retouching shared by preview and export. Bundle portrait/face models;
provide optional checksum-verified BiRefNet subject extraction, on-device ONNX GPU/CPU inference, chroma key,
image-guided edge softening, contraction/expansion and edge color cleanup. Retouching adds 17 skin, feature,
geometry and makeup controls, configurable pigment colors, natural/portrait/makeup presets, original comparison,
reset and undo. Small models work offline; the optional model downloads once with progress and retry. Quality
modes analyze the requested frame, including reverse seeks and parallel exports, with bounded source-time caching.
