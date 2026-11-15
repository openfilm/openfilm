---
"openfilm": patch
---

Separate interactive video effects from full-quality rendering. Add adaptive local playback drafts, debounced precise
stills, latest-frame scheduling, independent analysis caches, identical-input inference reuse, and reusable GPU textures.
Keep the selected cutout/beauty settings and export resolution independent of preview strategy.

Expose automatic, smooth and quality-priority previews and detailed-preview rendering with progress, pause, cancellation
and cache clearing. Yield background rendering to playback and editing, persist completed previews, and invalidate
changed caption pictures while preserving renders when edits are outside their interval.

Constrain detected face interiors as foreground before edge refinement so blown highlights in skin do not become
transparent holes, and retain the face constraint and connected-person cleanup in interactive refined-person drafts.
