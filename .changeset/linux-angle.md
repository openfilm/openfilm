---
"openfilm": patch
---

Linux: WebGL is no longer lost at the start of a headless browser. Chromium's default GPU setup can fail on a machine with an NVIDIA GPU and a Vulkan driver, so every WebGL context made in the first second was lost: `look` showed white canvases and a render had white frames. The browser now tries Vulkan first and keeps it when its renderer is a GPU, and otherwise asks for SwiftShader by name (a sandbox with no GPU device nodes, a machine with no Vulkan driver).
