import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectSpeech, readTranscript, setLine, transcriptIsCurrent, translationsOf, vttOf, writeTranscript } from './transcripts.mjs';

const LINES = [{ text: 'Hello there.', startMs: 0, endMs: 1000 }];

/** A project, and a folder beside it that is not the project's (a `../` away), each with a sound and its transcript. */
function folders() {
  const scratch = mkdtempSync(join(tmpdir(), 'of-transcripts-'));
  const root = join(scratch, 'Film'), away = join(scratch, 'away');
  for (const dir of [join(root, 'assets'), away]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'assets', 'vo.mp3'), 'x');
  writeFileSync(join(root, 'assets', 'vo.vtt'), vttOf(LINES));
  writeFileSync(join(away, 'vo.mp3'), 'x');
  writeFileSync(join(away, 'vo.vtt'), vttOf(LINES));
  writeFileSync(join(away, 'vo.fr.vtt'), vttOf(LINES));
  return { root, away };
}

test('a transcript is read and written only inside the project, never at a `../` source', async () => {
  const { root, away } = folders();
  assert.equal((await readTranscript(root, 'assets/vo.mp3'))?.lines[0].text, 'Hello there.');
  for (const src of ['../away/vo.mp3', '../../x.mp3', '.film/vo.mp3']) {
    assert.equal(await readTranscript(root, src), null, src);
    assert.equal(await readTranscript(root, src, 'fr'), null, src);
    assert.equal(await transcriptIsCurrent(root, src), false, src);
    assert.deepEqual(await translationsOf(root, src), [], src);
    await assert.rejects(writeTranscript(root, src, { lines: LINES }), /not a path inside the project/, src);
    assert.equal(await setLine(root, src, 0, 'changed'), false, src);
  }
  /* a language is part of the file's name: it cannot lead out either */
  await assert.rejects(writeTranscript(root, 'assets/vo.mp3', { lines: LINES }, '/../../../away/x'), /not a path inside the project/);
  assert.equal(readFileSync(join(away, 'vo.vtt'), 'utf8'), vttOf(LINES), 'the transcript out there as it was');
  assert.ok(!existsSync(join(away, 'x.vtt')));
});

test('a link in the project to a folder out of it is not followed for transcripts', { skip: process.platform === 'win32' && 'links need Developer Mode on Windows' }, async () => {
  const { root, away } = folders();
  symlinkSync(away, join(root, 'assets', 'linked'));
  assert.equal(await readTranscript(root, 'assets/linked/vo.mp3'), null);
  assert.deepEqual(await translationsOf(root, 'assets/linked/vo.mp3'), []);
  assert.equal(await transcriptIsCurrent(root, 'assets/linked/vo.mp3'), false);
  await assert.rejects(writeTranscript(root, 'assets/linked/vo.mp3', { lines: [] }), /not a path inside the project/);
  /* a transcript that is itself a link out is not read as the project's speech */
  symlinkSync(join(away, 'vo.vtt'), join(root, 'assets', 'theirs.vtt'));
  writeFileSync(join(away, 'vo.vtt'), vttOf([{ text: 'Private words.', startMs: 0, endMs: 1000 }]));
  assert.equal(await projectSpeech(root), 'Hello there.');
});
