Local portrait effects model inventory

The application includes MODNet portrait alpha matting (12,984,781 bytes), MediaPipe Face Landmarker
(3,758,596 bytes), and MediaPipe Selfie Segmenter landscape (250,177 bytes). The bundled weights total
16,993,554 bytes (about 17 MB); runtime libraries are additional. Model SHA-256 hashes, source
URLs, licenses, and download limits are declared in ../../src/vision-models.mjs.

Optional BiRefNet Lite subject extraction is 98,484,532 bytes (about 99 MB), downloaded only when selected.
The verified file is cached at <OpenFilm home>/cache/vision/1/subject.onnx. It may also be placed there manually
from the exact source in the manifest; a different or corrupt file is rejected. Failed downloads never replace a
valid cached model. Models work offline once available. Video frames never go to the model hosting sites.

Optional person edge refinement uses ViTMatte Small Composition-1k (103,885,865 bytes, about 104 MB).
It builds a trimap from MODNet, retains components seeded by detected faces (large components when no face is
detected), and predicts fractional alpha in an expanded uncertain band. This reduces isolated subtitle/graphic
noise without asking a general object model to identify the person inside an embedded interview frame.
Its analysis resolution is at most 512 px during playback and 1024 px when paused/exporting. It is considerably
slower than bundled portrait matting and is not advertised as real-time processing. Definite trimap regions
remain exact; an incorrect coarse mask can still limit the result. Tiny disconnected body parts may be lost.

Optional semantic beauty uses BiSeNet ResNet18 (53,205,364 bytes, about 54 MB) on an expanded square crop of
each detected face. RGB ImageNet normalization, the first output head and the model's 19-class labels are used.
Skin retouching excludes hair, glasses, brows, eyes and lips; lip/eye/mouth masks follow semantic regions.
Glasses protection attenuates eye/nose geometry and excludes spectacle pixels from smoothing. Face warps
use an aspect-correct basis aligned to the eyes, with reduced frontal shaping on turned faces.
Landmark regions remain the built-in default, with semantic processing explicitly selected in the inspector.
Texture retention restores fine residual detail after bilateral smoothing; blemish reduction targets darker local
deviations; highlight reduction lowers skin highlights without hallucinating lost overexposed texture.
These features do not implement a trained commercial beauty-camera pipeline or promise equivalent results.

Portrait mode uses MODNet's fractional alpha directly. Detailed subject mode uses BiRefNet and can better handle
objects and complex scenes, at substantially higher processing cost. Neither mode is presented as guaranteed
30fps processing on every computer. GPU inference explicitly uses NCHW layout: the runtime's default NHWC graph
transformation produced visibly incorrect MODNet alpha on Apple Metal, despite accepting the model. Verification
compares real portrait CPU/GPU output and inspects foreground coverage, not merely successful model execution.

The browser-safe BiRefNet export is pinned to the conversion publisher's revision, not automatically updated.
The application uses the upstream 512x512 normalization and sigmoid output. MODNet uses RGB normalized to
[-1,1] and multiples of 32. Playback uses smaller portrait analysis and feature masks; pauses and export use
full analysis. Every quality-mode frame is analyzed at its own source time; there is no recurrent state to leak
across cuts or backward seeks. This does not implement learned video temporal matting or object tracking.

Researched alternatives included RVM (GPL-3.0) and MatAnyone/MatAnyone2 (NTU S-Lab terms), plus GPUPixel and
OpenMakeupSDK. The integrated inference/model dependencies are Apache-2.0 or MIT. No commercial SDK, paid
API, Python daemon or separately installed local service is needed. Rendering, landmarks, masks, geometric
warps and pigment blending are integrated directly into OpenFilm's preview/export worker.

Upstream sources:
https://github.com/ZHKKKe/MODNet
https://huggingface.co/Xenova/modnet/tree/fa2fa546052fba4c08921230a26cc69a333fca12
https://github.com/ZhengPeng7/BiRefNet
https://huggingface.co/studioludens/birefnet-lite-512/tree/962e67969ec6acec9c19fab76acee4f5e22e990c
https://github.com/google-ai-edge/mediapipe
https://github.com/microsoft/onnxruntime
https://github.com/hustvl/ViTMatte
https://huggingface.co/hustvl/vitmatte-small-composition-1k
https://huggingface.co/Xenova/vitmatte-small-composition-1k/tree/6bc1297f6140f055a227b6d2cfe8c093281f35d2
https://github.com/yakhyo/face-parsing
