---
name: vintage-film
description: Make photos and clips into a film that looks shot on old film or laid out as instant photos — grain, warm faded color, light leaks, date stamps, white photo frames. Use for memories and recaps (a trip, a birthday, a graduation, a wedding, a year, a child growing up) or when the person asks for a retro, film, analog, Polaroid or instant-photo look (复古, 胶片, 拍立得, 回忆, 相册).
---

# Vintage film

A memory film: the person's own photos and clips, shown as if they were found in a box of prints or on an old reel.
Their pictures are the film; the look is the frame around them.

## The look

What makes it read as film, not as a filter:
- **Grain that moves**: new every frame, 24 times a second, strongest in the mid tones. Never a still texture.
- **The gate**: the picture drifts by a pixel or two and its brightness breathes a little.
- **Color**: blacks lifted and warm, highlights soft, greens and blues muted, skin warm. Never pure black or white.
- **Light**: now and then a warm leak sweeps across a corner; a burst of light can carry a cut.
- **Marks**: specks of dust for a frame, rarely a hair or scratch, a camera's orange date in the corner.
- **Objects**: instant photos with a wide bottom margin and a handwritten line; a strip of 35 mm frames; prints laid
  on paper, slightly turned, overlapping.

`film-look.js` in this skill's folder does the moving parts (grain, weave, flicker, dust, leaks, `burn` for a flash on
a cut) as functions of t; `film-look.css` has the photo frame, the film strip, the date stamp and the paper. Copy them
into the project and build on them. Handwriting: an open font such as Caveat or Patrick Hand, for Chinese LXGW WenKai or
Long Cang.

## The film

1. **Look at every picture** (`npx openfilm look <file>`, or several at once). Read when each was taken from its
   metadata (exiftool, or Python's PIL) and keep the real order and dates; never invent a date or a place. What a
   picture shows you may name; a place you cannot see for sure, ask about or leave unnamed.
2. **Where it is watched sets the length.** A post for phones (Moments, Douyin, Reels, Stories) is 30 to 60 seconds;
   a film for a screen at a party or a wedding can run the whole song. Unless the person says otherwise, a post.
3. **Choose the pictures that carry the story** (people, firsts, the best of each place) for that length, about two
   seconds each; group near-duplicates into one beat (a quick flip through three, a fan of prints). Never alter a
   picture's content. In your reply, say how many you used and that any left out can come back.
4. **The music**: the part of the song that fits the length and ends cleanly (often its strongest stretch). Look at its
   sound (`look` shows it) for the sections: quieter stretches get longer holds and slow drifts, louder ones faster
   changes and the strongest pictures. Change pictures on the beat. Without a song, ask for one, or make one with
   `get music` when a service is connected.
5. **Chapters**: by day, place or person, each opened by a title card or a handwritten line. Open on the best picture,
   close on a wide one or the people together, then a last card (the place, the date, a line of theirs).
6. **Each picture moves**: a slow push or drift (a few percent over its hold), prints that slide in and settle, an
   instant photo that develops from pale to full. One move per picture; never all at once.
7. **Format**: ask where it will be watched, or decide and say so: 9:16 for phones (Moments, Douyin, Reels), 16:9 for a
   screen or a TV. Keep faces and captions out of the edges that apps cover.

One page per beat, as the manual says; the film look sits in each page (or in one page on the top track over the
whole film, when every picture underneath is a plain clip).
