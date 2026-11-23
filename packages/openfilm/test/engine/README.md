# The engine suite

Films are web pages drawn frame by frame by Chromium: the desktop app previews them in Electron's, and `openfilm render`,
`look` and thumbnails draw them in Playwright's headless shell. Both are the same Chromium version, started with the
same switches (`src/engine.mjs`). This suite checks what that engine can do, and that each technique a film may use
draws the same picture for the same t in it, with how long each takes.

- `pages/`: one page per technique (three.js on WebGL2 and WebGPU, a WebGPU compute shader, path tracing, p5.js, GSAP,
  Lottie, PixiJS, Matter.js, CSS and Web Animations, SVG SMIL, HTML-in-Canvas in 2D and WebGL, an adjustment layer
  reading a `<video>`, an `<iframe>` and DOM as pixels), and `env.html`, the capability report.
- `alpha/`: a film of five transparent clip formats over a color; the clips are made with ffmpeg when the suite runs.
- `vendor/`: the libraries the pages load, copied byte for byte from their npm packages, with their licenses;
  `vendor.json` names each package, version and file with its sha256 (a test checks them). GSAP is not here: its
  license is not an open-source one, so the suite copies it from the `gsap` package npm installs.
- `suite.mjs`: serves the pages as the host does, draws each one with `FilmPage` at four times, then again in another
  order, then in a page opened anew after the two frames a render throws away, and compares the pictures exactly.

Run it:

```bash
node --test src/engine.test.mjs
node scripts/engine-report.mjs --out <folder>
node scripts/engine-report.mjs --compare <before folder> <after folder>
```

The test is skipped without a GPU (SwiftShader, or a CI runner's virtual GPU). The report writes `report.json`,
`report.md` and every picture drawn; `--compare` says which capabilities changed between two reports, how far apart
each technique's pictures are between the two engines, and the timings.

When Electron or Playwright is upgraded, move both to the same Chromium (Playwright's `browsers.json` names its headless
shell's), set `ENGINE_CHROMIUM` in `src/engine.mjs`, and run the report on the old and the new engine.
