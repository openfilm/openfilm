// @ts-check

/**
 * A container's picture options with the quality the person chose. Everything else the container set — its
 * encoder, its colour tags, its pixel format — is kept whole; only the number after `-crf` changes. A codec
 * with no `-crf` (ProRes) has no quality to set, so its options come back as they were.
 * @param {string[]} video @param {number | null | undefined} crf
 * @returns {string[]}
 */
export function crfVideo(video, crf) {
  if (crf == null) return video;
  const out = [...video];
  const at = out.indexOf('-crf');
  if (at < 0) return out;
  out[at + 1] = String(crf);
  return out;
}

/**
 * Whether the picture must be encoded by software. A host that gave its own format has already chosen an
 * encoder; `--crf` names a software codec's quality, which a graphics chip's bitrate has no place for.
 * @param {{ format?: unknown, crf?: number | null, hardware?: boolean }} opts
 */
export function softwareOnly(opts) {
  return Boolean(opts.format || opts.crf != null || opts.hardware === false);
}
