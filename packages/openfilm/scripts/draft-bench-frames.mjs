// Independent reconstruction of serialized draft controls for raster-media regression checks.
export function draftRasterFilter(info, segment) {
  const material = info.materials.videos.find((m) => m.id === segment.material_id);
  const { width, height } = info.canvas_config;
  const fit = Math.min(width / material.width, height / material.height);
  const w = material.width * fit * segment.clip.scale.x, h = material.height * fit * segment.clip.scale.y;
  const x = width / 2 + segment.clip.transform.x * width / 2 - w / 2;
  const y = height / 2 - segment.clip.transform.y * height / 2 - h / 2;
  for (const v of [w, h, x, y]) if (Math.abs(v - Math.round(v)) > 1e-7) throw new Error(`Raster is off the pixel grid: ${[w, h, x, y]}`);
  const scale = Math.round(w) === material.width && Math.round(h) === material.height ? '' : `scale=${Math.round(w)}:${Math.round(h)},`;
  return `format=rgba,${scale}pad=${width}:${height}:${Math.round(x)}:${Math.round(y)}:color=black@0`;
}
