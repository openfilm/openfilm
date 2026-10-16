---
name: presenter-pip
description: Make a talking-head video where the content fills the screen and the presenter speaks from a small window — slides, screens, pictures and motion graphics that follow what they say, their face always there. Use when the person gives a recording of themselves talking (with slides, a screen or notes) and asks for a lesson, a knowledge video, a commentary or a presentation with them in a corner (小窗人物口播, 画中画, 口播, 讲解视频).
---

# Presenter in a window

## The result

A video that keeps the person present and the content in charge: what they talk about fills the screen at the moment
they say it, and they speak from a window that never gets in the way.

## The bar

- **The person, well framed**: their own recording, in a window with a shape and place that suit the film (cut out
  from the background when it helps); face never cropped badly, never covering what matters. Full screen when the
  moment is about them.
- **Content on their words**: each slide, screen, picture, number or diagram appears when they say it (from the
  recording's transcript, `npx openfilm get asr`), and leaves when they move on.
- **Their words kept**: cuts only in pauses, ums and false starts removed when asked, meaning never changed; subtitles
  from the transcript, exact.
- **Finished**: a consistent layout system, readable type at the size it will be watched, motion that guides the eye,
  sound levels even.
- **Trimmed, not re-encoded**: the recording is cut by its in and out points, as the manual says.

## Freedom

Use any technique: CSS masks and shapes for the window, background removal, motion graphics from the web or a
renderer, the person's slides as pictures or rebuilt as pages, generated pictures when a service is connected.

## From the person

The recording, their slides or notes, where it will be watched, and whether they want ums and pauses removed.
