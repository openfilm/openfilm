---
"openfilm": patch
"@openfilm/desktop": patch
---

Studio's preview plays smoothly and in sync. The film now draws its own frames while it plays, once per frame of the film's frame rate and timed to when each frame reaches the screen, from a clock that follows the sound as you hear it, output latency included. It no longer waits on a message from the editor for every frame, so a busy editor or a slower computer no longer stutters the picture. Videos play by themselves and are eased back into step instead of being paused and sought again and again. Footage inside a web page that seeks its video frame by frame now plays at its full frame rate while the film plays, and still lands on the exact frame when you stop. The editor does far less work while playing: the playhead moves on its own, and the timecode and subtitles update only when they change. Changing speed, soloing a track or editing during playback no longer stalls the picture. Exports are unchanged.
