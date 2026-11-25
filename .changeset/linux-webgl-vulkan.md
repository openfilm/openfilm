---
"openfilm": patch
---

Linux: WebGL is no longer lost as a headless browser starts. On a machine with an NVIDIA GPU and a Vulkan driver, Chromium's own GPU setup could fail at start, and every WebGL context made in the first second was lost: `look` showed white canvases and a render had white frames. The browser now tries Vulkan first and keeps it when its renderer is a GPU, and otherwise asks for SwiftShader by name (no Vulkan driver, or a sandbox with no GPU device nodes).
