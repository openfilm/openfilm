/** Landmark-defined feature masks. Each channel is independent; eyes, brows and lips stay out of skin smoothing. */
export function faceAnalysis(faces, width, height, preview = false, settings = {}) {
  const w = Math.min(preview ? 256 : 512, width),
    h = Math.max(1, Math.round((height * w) / width));
  const canvas = new OffscreenCanvas(w, h),
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  const mask = (draw) => {
    ctx.clearRect(0, 0, w, h);
    ctx.filter = 'blur(1px)';
    ctx.fillStyle = '#fff';
    ctx.globalCompositeOperation = 'source-over';
    draw();
    const pixels = ctx.getImageData(0, 0, w, h).data;
    return Uint8Array.from({ length: w * h }, (_, i) => pixels[i * 4 + 3]);
  };
  const polygon = (face, ids) => {
    ctx.beginPath();
    ids.forEach((id, i) => ctx[i ? 'lineTo' : 'moveTo'](face[id].x * w, face[id].y * h));
    ctx.closePath();
    ctx.fill();
  };
  const oval = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150,
    136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ];
  const left = [33, 160, 158, 133, 153, 144],
    right = [362, 385, 387, 263, 373, 380];
  const lips = [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91];
  const inner = [78, 81, 13, 311, 308, 402, 14, 178];
  const brows = [
    [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
    [336, 296, 334, 293, 300, 276, 283, 282, 295, 285],
  ];
  const ellipse = (x, y, rx, ry, angle = 0) => {
    ctx.beginPath();
    ctx.ellipse(x * w, y * h, Math.max(0.5, rx * w), Math.max(0.5, ry * h), angle, 0, Math.PI * 2);
    ctx.fill();
  };
  const center = (face, ids) => ({
    x: ids.reduce((s, id) => s + face[id].x, 0) / ids.length,
    y: ids.reduce((s, id) => s + face[id].y, 0) / ids.length,
  });
  const skin = mask(() => {
    for (const face of faces) {
      ctx.globalCompositeOperation = 'source-over';
      polygon(face, oval);
      ctx.globalCompositeOperation = 'destination-out';
      for (const ids of [left, right, lips, ...brows]) polygon(face, ids);
    }
  });
  const lip = settings.lip
    ? mask(() => {
        for (const face of faces) {
          ctx.globalCompositeOperation = 'source-over';
          polygon(face, lips);
          ctx.globalCompositeOperation = 'destination-out';
          polygon(face, inner);
        }
      })
    : null;
  const eye =
    settings.eyeBright || settings.shadow
      ? mask(() => {
          for (const face of faces) for (const ids of [left, right]) polygon(face, ids);
        })
      : null;
  const mouth = settings.teeth
    ? mask(() => {
        for (const face of faces) polygon(face, inner);
      })
    : null;
  const dark = settings.darkCircles
    ? mask(() => {
        for (const face of faces)
          for (const ids of [left, right]) {
            const p = center(face, ids),
              rx = Math.abs(face[ids[0]].x - face[ids[3]].x) * 0.58;
            ellipse(p.x, p.y + rx * 0.4, rx, rx * 0.23);
          }
      })
    : null;
  const cheek = settings.blush
    ? mask(() => {
        for (const face of faces)
          for (const side of [
            [50, 101, 205],
            [280, 330, 425],
          ]) {
            const p = center(face, side),
              fw = Math.abs(face[454].x - face[234].x);
            ellipse(p.x, p.y, fw * 0.14, fw * 0.065);
          }
      })
    : null;
  const shadow = settings.shadow
    ? mask(() => {
        for (const face of faces)
          for (const ids of [
            [33, 160, 158, 133, 107, 66, 105, 63, 70],
            [362, 385, 387, 263, 300, 293, 334, 296, 336],
          ])
            polygon(face, ids);
      })
    : null;
  const rgba = (...channels) => {
    if (channels.every((channel) => !channel)) return undefined;
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = channels[c]?.[i] ?? 0;
    return { w, h, data, rgba: true };
  };
  const anchors = new Float32Array(4 * 6 * 4);
  faces.slice(0, 4).forEach((face, i) => {
    const l = center(face, left),
      r = center(face, right),
      mouth = center(face, inner),
      cx = (face[10].x + face[152].x) / 2,
      cy = (face[10].y + face[152].y) / 2;
    anchors.set(
      [
        cx,
        cy,
        Math.hypot((face[454].x - face[234].x) * width, (face[454].y - face[234].y) * height) / width,
        Math.hypot((face[152].x - face[10].x) * width, (face[152].y - face[10].y) * height) / height,
        l.x,
        l.y,
        r.x,
        r.y,
        face[1].x,
        face[1].y,
        mouth.x,
        mouth.y,
        face[172].x,
        face[172].y,
        face[397].x,
        face[397].y,
        face[234].x,
        face[234].y,
        face[454].x,
        face[454].y,
        face[152].x,
        face[152].y,
        face[10].x,
        face[10].y,
      ],
      i * 24,
    );
  });
  return {
    skin: { w, h, data: skin },
    features: rgba(lip, eye, mouth, dark),
    makeup: rgba(cheek, shadow),
    anchors,
    faceCount: Math.min(4, faces.length),
  };
}
