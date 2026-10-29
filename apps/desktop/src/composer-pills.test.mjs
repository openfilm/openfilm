import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PILL_NEIGHBOR, dropSpaceAfterRemoval, spacesAroundPill } from '../chat/src/components/prompt-editor/pill-spacing.ts';
import {
  attachmentPill,
  attachmentPillPictures,
  attachmentsInText,
  attachmentWords,
  isAttachmentPill,
  newAttachmentPillId,
  projectFilePath,
  sentPill,
} from '../chat/src/lib/attachment-pills.ts';

test('a pill dropped against a word gets a space on that side, none against a space or punctuation', () => {
  assert.deepEqual(spacesAroundPill('e', 'b'), { before: true, after: true });
  assert.deepEqual(spacesAroundPill(' ', ' '), { before: false, after: false });
  assert.deepEqual(spacesAroundPill('', ''), { before: false, after: false }, 'the start and end of a line');
  assert.deepEqual(spacesAroundPill('(', ')'), { before: false, after: false });
  assert.deepEqual(spacesAroundPill('t', ','), { before: true, after: false });
  assert.deepEqual(spacesAroundPill(',', 'x'), { before: true, after: true });
});

test('a pill between Chinese or Japanese characters gets no spaces', () => {
  assert.deepEqual(spacesAroundPill('把', '放'), { before: false, after: false });
  assert.deepEqual(spacesAroundPill('，', 'の'), { before: false, after: false });
  assert.deepEqual(spacesAroundPill('을', '를'), { before: true, after: true }, 'Korean is written with spaces');
});

test('two pills side by side are kept apart, as two words would be', () => {
  assert.deepEqual(spacesAroundPill(PILL_NEIGHBOR, PILL_NEIGHBOR), { before: true, after: true });
});

test('the place a pill left keeps one space between the words, and none at the start of a line', () => {
  assert.equal(dropSpaceAfterRemoval(' ', ' '), true, '"make  blue" becomes "make blue"');
  assert.equal(dropSpaceAfterRemoval('', ' '), true, 'a pill that opened the line takes its space along');
  assert.equal(dropSpaceAfterRemoval('e', ' '), false);
  assert.equal(dropSpaceAfterRemoval(' ', 'b'), false);
  assert.equal(dropSpaceAfterRemoval(' ', ''), false);
});

test('only a project file lights up in Studio: a path elsewhere on the disk does not', () => {
  assert.equal(projectFilePath('assets/upload/a.mp4'), 'assets/upload/a.mp4');
  assert.equal(projectFilePath('/Users/me/Desktop/a.png'), null);
  assert.equal(projectFilePath('C:\\Users\\me\\a.png'), null);
  assert.equal(projectFilePath('D:/footage/a.mov'), null);
  assert.equal(projectFilePath('\\\\server\\share\\a.mov'), null);
  assert.equal(projectFilePath(null), null);
});

const shot = { id: newAttachmentPillId(), name: 'shot.png', kind: 'image', size: 2048, path: '/Users/me/Desktop/shot.png', previewUrl: 'blob:shot' };
const clip = { id: newAttachmentPillId(), name: 'take 2.mov', kind: 'document', size: 3 * 1024 * 1024, path: '/Users/me/Movies/take 2.mov', thumb: 'data:image/webp;base64,AAAA' };
const folder = { id: newAttachmentPillId(), name: 'refs', kind: 'document', size: 0, folder: true, path: '/Users/me/refs/' };

test('a file brought in is a file pill, with its picture and size, under an id of its own', () => {
  assert.equal(isAttachmentPill(shot.id), true);
  assert.notEqual(shot.id, clip.id);
  assert.deepEqual(attachmentPill(shot), { id: shot.id, kind: 'file', label: 'shot.png', detail: '2.0 KB', image: { src: 'blob:shot' } });
  assert.deepEqual(attachmentPill(clip).image, { src: clip.thumb }, "a video shows its frame");
  assert.deepEqual(attachmentPill(folder), { id: folder.id, kind: 'file', label: 'refs/' }, 'a folder has no size');
  assert.equal(isAttachmentPill('file:assets/a.png'), false);
});

test('the files sent are those whose pills are in the text, in the order of the pills', () => {
  const pills = [{ id: clip.id }, { id: 'studio:time:4' }, { id: shot.id }];
  assert.deepEqual(attachmentsInText([shot, clip, folder], pills).map((f) => f.name), ['take 2.mov', 'shot.png'], 'the folder\'s pill was taken out');
  assert.deepEqual(attachmentsInText([shot], []), []);
});

test('the agent reads where each file is, in place of its pill', () => {
  assert.equal(attachmentWords(shot), '/Users/me/Desktop/shot.png');
  assert.equal(attachmentWords(clip), '`/Users/me/Movies/take 2.mov`', 'a path with a space is set apart');
  assert.equal(attachmentWords(folder), '/Users/me/refs/');
  assert.equal(attachmentWords({ path: undefined }), null, 'a pasted file not yet kept has no path');
  assert.equal(attachmentWords({ path: 'C:\\Users\\me\\refs\\', folder: true }), 'C:\\Users\\me\\refs/');
});

test('the sent bubble keeps file pills without their passing picture, and gets thumbnails back from the attachments', () => {
  const studio = { id: 'studio:time:4', kind: 'time', label: '0:04', image: { src: 'http://127.0.0.1/frame.jpg' } };
  assert.equal(sentPill(attachmentPill(shot)).image, undefined);
  assert.deepEqual(sentPill(studio), studio, 'other pills keep their picture');
  const display = { text: 'the pills, as markers', references: [attachmentPill(clip), studio, attachmentPill(shot)].map(sentPill) };
  const pictures = attachmentPillPictures(display, [{ kind: 'document', name: clip.name, thumb: 'thumb-clip' }, { kind: 'image', name: shot.name, thumb: 'thumb-shot' }]);
  assert.deepEqual([...pictures], [[clip.id, 'thumb-clip'], [shot.id, 'thumb-shot']]);
  assert.equal(attachmentPillPictures(display, []), null, 'unpaired: the attachments keep their own row');
  assert.equal(attachmentPillPictures({ text: 'x', references: [studio] }, [{ kind: 'image', name: 'old.png' }]), null, 'a message from before');
  assert.equal(attachmentPillPictures(undefined, [{ kind: 'image', name: 'long.png' }]), null, 'a message too long to keep its pills');
});
