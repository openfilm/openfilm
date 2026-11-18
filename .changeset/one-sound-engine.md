---
"openfilm": patch
---

The film's sound has one engine: the limiter that keeps every film under -2 dBFS (and the loudness gain before it) is now one JavaScript function that the preview runs in an AudioWorklet and the export runs in Node, so what Studio plays of a mix is what the export delivers of it, sample for sample. Played from the middle, the preview first feeds it the second before, as the export has it there. The limiter catches the peaks between samples too, leaves everything under the ceiling exactly as mixed (a quiet film is exported bit for bit as its mix; before, it went through a resampler), and holds its gain through low notes, so loud bass distorts far less. Studio's preview now plays at 48 kHz, the export's rate.
