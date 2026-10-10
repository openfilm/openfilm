import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familiesOf, hasCodepoint, readFaces } from './fonts.mjs';

/** A font file of the tables given (tag → bytes), as an OpenType table directory lays them out. */
function sfnt(tables) {
  const tags = Object.keys(tables);
  const head = Buffer.alloc(12 + tags.length * 16);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt16BE(tags.length, 4);
  let at = head.length;
  const bodies = [];
  tags.forEach((tag, i) => {
    const body = tables[tag];
    head.write(tag, 12 + i * 16, 'latin1');
    head.writeUInt32BE(at, 12 + i * 16 + 8);
    head.writeUInt32BE(body.length, 12 + i * 16 + 12);
    bodies.push(body);
    at += body.length;
  });
  return Buffer.concat([head, ...bodies]);
}

/** A `name` table of Windows English names (id → text). */
function nameTable(names) {
  const entries = Object.entries(names);
  const strings = entries.map(([, text]) => Buffer.from(text, 'utf16le').swap16());
  const head = Buffer.alloc(6 + entries.length * 12);
  head.writeUInt16BE(entries.length, 2);
  head.writeUInt16BE(head.length, 4);
  let offset = 0;
  entries.forEach(([id], i) => {
    const r = 6 + i * 12;
    head.writeUInt16BE(3, r);
    head.writeUInt16BE(1, r + 2);
    head.writeUInt16BE(0x409, r + 4);
    head.writeUInt16BE(Number(id), r + 6);
    head.writeUInt16BE(strings[i].length, r + 8);
    head.writeUInt16BE(offset, r + 10);
    offset += strings[i].length;
  });
  return Buffer.concat([head, ...strings]);
}

function os2(weight, italic = false) {
  const b = Buffer.alloc(96);
  b.writeUInt16BE(weight, 4);
  b.writeUInt16BE(italic ? 1 : 0x40, 62);
  return b;
}

function fvar(axes) {
  const b = Buffer.alloc(16 + axes.length * 20);
  b.writeUInt16BE(1, 0);
  b.writeUInt16BE(16, 4);
  b.writeUInt16BE(axes.length, 8);
  b.writeUInt16BE(20, 10);
  axes.forEach(([tag, min, def, max], i) => {
    const o = 16 + i * 20;
    b.write(tag, o, 'latin1');
    b.writeInt32BE(Math.round(min * 65536), o + 4);
    b.writeInt32BE(Math.round(def * 65536), o + 8);
    b.writeInt32BE(Math.round(max * 65536), o + 12);
  });
  return b;
}

const reader = (buf) => async (at, len) => buf.subarray(at, at + len);

test('a face\'s family, weight class and italic bit', async () => {
  const [bold] = await readFaces(reader(sfnt({ name: nameTable({ 1: 'Acme Sans Bold', 2: 'Regular', 16: 'Acme Sans', 17: 'Bold' }), 'OS/2': os2(700) })));
  assert.equal(bold.family, 'Acme Sans', 'the typographic family groups the weights');
  assert.equal(bold.weight, 700);
  assert.equal(bold.italic, false);
  const [italic] = await readFaces(reader(sfnt({ name: nameTable({ 1: 'Acme Sans', 2: 'Italic' }), 'OS/2': os2(400, true) })));
  assert.equal(italic.italic, true);
  const [old] = await readFaces(reader(sfnt({ name: nameTable({ 1: 'Old', 2: 'Bold Italic' }) })));
  assert.deepEqual([old.weight, old.italic], [400, true], 'no OS/2: the style name says italic');
});

test('a variable font: its weight axis on CSS\'s scale, and an italic axis', async () => {
  const [face] = await readFaces(reader(sfnt({ name: nameTable({ 1: 'Flex' }), 'OS/2': os2(400), fvar: fvar([['wght', 100, 400, 900], ['ital', 0, 0, 1]]) })));
  assert.deepEqual(face.wght, [100, 900]);
  assert.equal(face.ital, true);
  const [skia] = await readFaces(reader(sfnt({ name: nameTable({ 1: 'Skia' }), 'OS/2': os2(500), fvar: fvar([['wght', 0.48, 1, 3.2]]) })));
  assert.equal(skia.wght, undefined, 'an axis of another scale is not a CSS weight range');
});

test('families gather their faces\' weights and italics', () => {
  const face = (family, weight, italic = false, more = {}) => ({ family, aliases: [family], locale: 'latin', weight, italic, ...more });
  const [acme, flex] = familiesOf([
    face('Acme', 400), face('Acme', 700), face('Acme', 400, true), face('Acme', 300),
    face('Flex', 400, false, { wght: [200, 800], ital: true }),
    face('.Hidden', 400),
  ]);
  assert.deepEqual(acme, { family: 'Acme', locale: 'latin', role: '', weights: [300, 400, 700], italics: [400] });
  assert.deepEqual(flex.weights, [200, 300, 400, 500, 600, 700, 800]);
  assert.deepEqual(flex.italics, flex.weights);
  assert.deepEqual(flex.variable, [200, 800]);
  const [only] = familiesOf([face('Slanted', 400, true)]);
  assert.deepEqual([only.weights, only.italics], [[400], [400]], 'italics only: those are its weights too');
});

/** A `cmap` of one format 4 subtable mapping `from`…`to` (and the closing 0xFFFF segment). */
function cmap4(from, to) {
  const segs = 2;
  const sub = Buffer.alloc(16 + segs * 8);
  sub.writeUInt16BE(4, 0);
  sub.writeUInt16BE(sub.length, 2);
  sub.writeUInt16BE(segs * 2, 6);
  const ends = 14;
  sub.writeUInt16BE(to, ends);
  sub.writeUInt16BE(0xffff, ends + 2);
  const starts = ends + segs * 2 + 2;
  sub.writeUInt16BE(from, starts);
  sub.writeUInt16BE(0xffff, starts + 2);
  const deltas = starts + segs * 2;
  sub.writeInt16BE(1 - from, deltas);
  sub.writeInt16BE(1, deltas + 2);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1, 2);
  head.writeUInt16BE(3, 4);
  head.writeUInt16BE(1, 6);
  head.writeUInt32BE(12, 8);
  return Buffer.concat([head, sub]);
}

test('a CJK font\'s sample only when its character map has it', async () => {
  assert.equal(hasCodepoint(cmap4(0x6c00, 0x6cff), 0x6c38), true);
  assert.equal(hasCodepoint(cmap4(0x41, 0x7a), 0x6c38), false);
  const zh = (map) => sfnt({ name: nameTable({ 1: 'Kai' }), 'OS/2': (() => { const b = os2(400); b.writeUInt32BE(1 << 18, 78); return b; })(), cmap: map });
  const [has] = await readFaces(reader(zh(cmap4(0x6c00, 0x6cff))));
  assert.deepEqual([has.locale, has.sample], ['zh-CN', '永']);
  const [misfiled] = await readFaces(reader(zh(cmap4(0x41, 0x7a))));
  assert.equal(misfiled.sample, undefined, 'filed as Chinese by its code pages, no 永 in it');
  assert.equal(familiesOf([has])[0].sample, '永');
});
