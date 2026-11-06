---
'openfilm': patch
---

Studio: a master-quality export keeps a dark, smooth gradient smooth (#366). Its frames are taken as PNG instead of JPEG, and footage the browser needs a copy of is copied near the file (x264 at a high quality, its grain kept) instead of on the graphics chip at a bitrate, in a copy of its own beside the preview's; HEVC at master is written in 10 bits (Main 10). A Blender render's dithered glow came out in hard bands and now keeps its grain. A master export takes a little longer: about a tenth more at 1080p, a fifth at 4K.
