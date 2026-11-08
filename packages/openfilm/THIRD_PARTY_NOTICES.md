# Third-party notices

Studio's editor (`studio/ui/dist`) bundles:

- **Inter** by Rasmus Andersson, via `@fontsource-variable/inter`: SIL Open Font License 1.1
  (https://openfontlicense.org).
- **React** and **React DOM**: MIT License, © Meta Platforms, Inc. and affiliates.
- **Lucide** icons (`lucide-react`): ISC License, © Lucide Contributors.
- **Simple Icons** social brand marks: CC0 1.0 Universal (https://github.com/simple-icons/simple-icons).
- **React Flow** (`@xyflow/react`, `@xyflow/system`), the canvas: MIT License, © webkid GmbH; with **zustand** (MIT License,
  © Paul Henschel), **classcat** (MIT License, © Jorge Bucaran) and the **d3** modules it uses (d3-drag, d3-selection,
  d3-zoom, d3-transition, d3-interpolate, d3-dispatch, d3-color, d3-ease, d3-timer: ISC License, © Mike Bostock; the
  easing of d3-ease also BSD 3-Clause License, © Robert Penner).

The CLI depends on **playwright-core** (Apache License 2.0), which downloads a headless Chromium on first use.

The library's semantic search (`src/library-semantic.mjs`) fetches on first use, and its vectors (`library/vectors.i8`)
are made with, **multilingual-e5-small** by Liang Wang et al., Microsoft (MIT License), as the int8 ONNX export of
Xenova/multilingual-e5-small; it runs it in **ONNX Runtime Web** (`onnxruntime-web`, MIT License, © Microsoft
Corporation), fetched likewise.

The offline Discover snapshot (`skill-catalog-seed.json`) includes OpenFilm's Replicate skill at its pinned commit
from `openfilm/skill-replicate` (MIT License, © 2026 OpenFilm contributors). The snapshot retains the full license
and source commit. It is a discovery fallback, not an automatically installed skill.
