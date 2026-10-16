---
name: whiteboard
description: Make an explainer drawn by hand on a whiteboard while a voice explains — boxes, arrows, icons and words drawn and written out in step with the narration. Use for lessons, micro-lectures, training, how-it-works and concept explainers, or when the person turns a document, slides or notes into an explainer, or asks for a whiteboard, hand-drawn or doodle style (白板, 手绘, 讲解, 微课, 课件).
---

# Whiteboard explainer

A voice explains; a hand draws exactly what it is saying, as it says it. Nothing appears that was not drawn.

## The look

- **The board**: off-white, a faint sheen; nothing else. One dark marker for most marks, one or two accent colors
  (blue, red, green) for what matters. Never gradients, shadows on drawings, or clip art.
- **Drawings first**: each board draws the thing itself (the experiment, the object, the process, the people) big
  enough to fill the board, labeled with a few words. A box of text is not a drawing.
- **Hand-drawn**: lines that wobble and overshoot, drawn twice; boxes that do not quite close; arrows, brackets,
  underlines, circles around a word; icons drawn in a few strokes (a leaf, a sun, a cup), never pasted pictures. A
  photo, when the topic needs one, is taped on the board.
- **Handwriting** for words: an open font such as Patrick Hand or Caveat, for Chinese LXGW WenKai or ZCOOL KuaiLe. Big:
  a board holds a few words, not sentences.
- **Drawn on**: every mark draws itself in the order a person would draw it, the pen at its tip; words write out
  character by character. A mark takes about as long as the words that name it.

`whiteboard.js` in this skill's folder draws hand-made strokes (`shapes`, `board().sketch`), writes out text
(`board().text`) and moves the pen, all as functions of t. Copy it into the project and build on it.

## The film

1. **The source**: from a document or slides, take every fact, term, number and example exactly as written; the order
   of ideas is the source's. Read slides with their speaker notes (python-pptx, or unzip the .pptx and read its XML).
   Anything you add (a bridge, an example) is a sentence of your own, never a new fact; anything you correct, say so in
   your reply.
2. **The script**: what a teacher would say over the board, spoken and short, one idea per board. Write it to a file
   beside the film (`script.md`), board by board, so the person can read and change it.
3. **The voice**: `npx openfilm get tts` when a voice service is connected, one file per board. Without one, make a
   placeholder with the system's own speech, say so, and say which services make a real voice. The person's own
   recording replaces it later: keep the timing driven by the voice files, never by hand-set seconds.
4. **Draw to the words**: each voice file's transcript has the time of every word. Start each mark when its word is
   spoken and finish it before the next idea; hold a moment when a board is complete. Speak at a pace for learning, a
   little slower than conversation.
5. **Boards**: one page per board. Between boards the camera pans across one big board, or the board is wiped clean
   with a sweep. Open with the question the lesson answers; end with a summary board that redraws the key marks small,
   side by side.
