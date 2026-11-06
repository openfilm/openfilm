---
"openfilm": patch
---

Studio: when the canvas changes shape, a video or still that filled it without a box of its own gets a box in its picture's shape, where the picture already was. Its box used to stay the whole new canvas, bars and all, so on a 16:9 video made 9:16, fading its top and bottom edges faded the black bars and the picture showed no fade; a crop, a mask and round corners missed the picture the same way. A picture cropped or stretched to the canvas (`object-fit: cover` or `fill`) still fills it, without a box.
