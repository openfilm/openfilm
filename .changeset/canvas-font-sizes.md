---
"openfilm": patch
---

Canvas text whose size follows a camera is drawn the same every time. Chromium keeps one font for some neighbouring font sizes (9.72 and 9.73 px), so a label that grew or shrank frame by frame was set a fraction of a pixel wider or narrower depending on which frames were drawn before it, and the same frame rendered twice could differ in whole lines of small text. A px size given to a 2D canvas's `font` is now rounded to 1/32 px wherever OpenFilm draws a page (the preview, `look`, `render` and exports), a grid on which no two sizes share a font; `ctx.font` reads back the rounded size.
