# Third-party notices

Studio's editor (`studio/ui/dist`) bundles:

- **Inter** by Rasmus Andersson, via `@fontsource-variable/inter`: SIL Open Font License 1.1
  (https://openfontlicense.org).
- **React** and **React DOM**: MIT License, © Meta Platforms, Inc. and affiliates.
- **Lucide** icons (`lucide-react`): ISC License, © Lucide Contributors.
- **React Flow** (`@xyflow/react`, `@xyflow/system`), the canvas: MIT License, © webkid GmbH; with **zustand** (MIT License,
  © Paul Henschel), **classcat** (MIT License, © Jorge Bucaran) and the **d3** modules it uses (d3-drag, d3-selection,
  d3-zoom, d3-transition, d3-interpolate, d3-dispatch, d3-color, d3-ease, d3-timer: ISC License, © Mike Bostock; the
  easing of d3-ease also BSD 3-Clause License, © Robert Penner).

The CLI depends on **playwright-core** (Apache License 2.0), which downloads a headless Chromium on first use.

The library's semantic search (`src/library-semantic.mjs`) fetches on first use, and its vectors (`library/vectors.i8`)
are made with, **multilingual-e5-small** by Liang Wang et al., Microsoft (MIT License), as the int8 ONNX export of
Xenova/multilingual-e5-small; it runs it in **ONNX Runtime Web** (`onnxruntime-web`, MIT License, © Microsoft
Corporation), fetched likewise.
