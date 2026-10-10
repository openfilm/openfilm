/**
 * build/icon.ico for Windows, from the transparent logo (build/logo-1024.png): 16, 24, 32, 48, 64 and 256 px, each a
 * PNG inside the .ico (Windows Vista and later read them), the mark on a transparent square with a little margin.
 * Run on macOS (sips does the scaling): `node scripts/make-ico.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const build = resolve(dirname(fileURLToPath(import.meta.url)), '../build');
const work = mkdtempSync(join(tmpdir(), 'of-ico-'));
const sizes = [16, 24, 32, 48, 64, 256];
const images = sizes.map((size) => {
  const file = join(work, `${size}.png`);
  /* the mark at 88% of the square: Windows draws icons edge to edge, a little air keeps it from looking cramped */
  const inner = Math.max(1, Math.round(size * 0.88));
  execFileSync('/usr/bin/sips', ['-z', String(inner), String(inner), join(build, 'logo-1024.png'), '--out', join(work, `${size}-inner.png`)], { stdio: 'ignore' });
  execFileSync('/usr/bin/sips', ['--padToHeightWidth', String(size), String(size), join(work, `${size}-inner.png`), '--out', file], { stdio: 'ignore' });
  return readFileSync(file);
});
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((png, i) => {
  const size = sizes[i];
  const at = 6 + 16 * i;
  header.writeUInt8(size >= 256 ? 0 : size, at);
  header.writeUInt8(size >= 256 ? 0 : size, at + 1);
  header.writeUInt8(0, at + 2);
  header.writeUInt8(0, at + 3);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(png.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
writeFileSync(join(build, 'icon.ico'), Buffer.concat([header, ...images]));
console.log(join(build, 'icon.ico'));
