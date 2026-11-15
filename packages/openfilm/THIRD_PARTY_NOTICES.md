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
- **Tiptap** (`@tiptap/*`), the editor of the canvas's text: MIT License, © Tiptap GmbH; with **ProseMirror**
  (`prosemirror-*`), **orderedmap**, **rope-sequence** and **w3c-keyname** (MIT License, © Marijn Haverbeke and others),
  **marked** (MIT License, © MarkedJS, © Christopher Jeffrey), **linkifyjs** (MIT License, © Nick Frasser),
  **fast-deep-equal** (MIT License, © Evgeny Poberezkin) and **use-sync-external-store** (MIT License, © Meta Platforms,
  Inc. and affiliates).

The CLI depends on **playwright-core** (Apache License 2.0), which downloads a headless Chromium on first use.

Video background removal and face retouching use **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`, Apache
License 2.0, © Google LLC). The Selfie Segmenter (landscape, float16, version 1) and Face Landmarker (float16,
version 1) models are included in `models/vision`, with their Apache-2.0 license. Upstream distribution:
https://ai.google.dev/edge/mediapipe/solutions/vision. The code includes its own landmark masks, image-guided alpha
composition, retouching and geometric/pigment rendering; it does not include a proprietary beauty SDK.

Portrait alpha matting includes **MODNet** by Zhanghan Ke and contributors (Apache License 2.0), as the fp16 ONNX
conversion from **Xenova/modnet**, revision `fa2fa546052fba4c08921230a26cc69a333fca12`. Code, models and
demos are licensed Apache-2.0 by the authors: https://github.com/ZHKKKe/MODNet.

Optional general subject extraction downloads **BiRefNet Lite** by Peng Zheng and contributors (MIT License),
as the fixed-512 fp16 ONNX conversion from **studioludens/birefnet-lite-512**, revision
`962e67969ec6acec9c19fab76acee4f5e22e990c`. Upstream: https://github.com/ZhengPeng7/BiRefNet; conversion:
https://huggingface.co/studioludens/birefnet-lite-512. This model is not bundled. The upstream MIT license ships
in `models/vision/licenses`, and exact download hashes/sizes are recorded in `src/vision-models.mjs`.

Local video matting uses **ONNX Runtime Web** (`onnxruntime-web`, MIT License, © Microsoft Corporation),
bundled as a package dependency, with its runtime files served locally. Small bundled model weights total about
17 MB; optional BiRefNet weights are about 99 MB. Runtime binaries are additional to the model sizes.

Optional person edge refinement downloads **ViTMatte Small Composition-1k** (103,885,865 bytes), using the
Xenova ONNX conversion at revision `6bc1297f6140f055a227b6d2cfe8c093281f35d2`. The model distribution declares
Apache-2.0: https://huggingface.co/hustvl/vitmatte-small-composition-1k. The original implementation by HUST
Vision Lab is MIT: https://github.com/hustvl/ViTMatte; its license is retained in `models/vision/licenses`.
The application constructs its own trimap from MODNet and refines only the uncertain region.

Optional semantic face regions use **face-parsing / BiSeNet ResNet18** by Yakhyokhuja Valikhujaev
(MIT License, © 2025), with ONNX weights from the project's `weights` release (53,205,364 bytes).
Source and model distribution: https://github.com/yakhyo/face-parsing. Its full MIT notice is retained in
`models/vision/licenses/face-parsing-MIT.txt`. These two models are downloaded only when selected, hash-verified
against `src/vision-models.mjs`, cached locally, and do not receive remote video frames.

The library's semantic search (`src/library-semantic.mjs`) fetches on first use, and its vectors (`library/vectors.i8`)
are made with, **multilingual-e5-small** by Liang Wang et al., Microsoft (MIT License), as the int8 ONNX export of
Xenova/multilingual-e5-small; it runs it in **ONNX Runtime Web** (`onnxruntime-web`, MIT License, © Microsoft
Corporation), fetched likewise.

The offline Discover snapshot (`skill-catalog-seed.json`) includes OpenFilm's Replicate skill at its pinned commit
from `openfilm/skill-replicate` (MIT License, © 2026 OpenFilm contributors). The snapshot retains the full license
and source commit. It is a discovery fallback, not an automatically installed skill.
