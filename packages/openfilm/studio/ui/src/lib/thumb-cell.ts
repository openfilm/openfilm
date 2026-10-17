/**
 * How a cell of a clip's thumbnail row is drawn (BlockThumbs): at its own width. An <img> takes the page's
 * `max-width: 100%`, so in a clip narrower than a cell every picture was squeezed to the clip's width while the
 * cells kept their steps, and the clip color showed between them, as if the pictures were broken.
 */
export function thumbCellStyle(left: number, width: number, height: number) {
  return { left, width, maxWidth: 'none', height, opacity: 0.9 } as const;
}
