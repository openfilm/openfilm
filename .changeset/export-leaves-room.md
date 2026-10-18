---
"@openfilm/desktop": patch
"openfilm": patch
---

Exports leave the computer usable, and do less work twice:

- **Fewer browsers.** A render opens one browser per performance core minus one, as many as the memory free right now can hold with 2 GB to spare, and at most four. Before, a Mac with 16 GB opened five and could run out of memory. A short render opens one.
- **Lower priority.** Exports and `openfilm render` run below the apps you're using, along with every browser and encoder they start. This now holds in the desktop app too.
- **Your film's frame rate.** A platform preset exports at the film's own rate, up to the most the platform shows. A 30 fps film is no longer drawn at 60 for 哔哩哔哩 or YouTube.
- **One render for same-size presets.** Platforms that take the same picture, such as 抖音, 快手 and 视频号, are drawn once and their files cloned.
- **Faster PNG frames.** Alpha videos and editing-project exports take their PNG frames with fast compression. The pixels are the same, and the frames come two to four times sooner.
