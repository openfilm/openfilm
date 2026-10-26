import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRangeDelivery, parseExportTime, readExportRange, readExportRanges, requestDurationMs } from './export-range.ts';
import type { ExportRequest } from './export-jobs.ts';
import { formatTimecode } from './timecode.ts';

test('export points accept precise seconds and clock positions independent of scene boundaries', () => {
  assert.equal(parseExportTime(' 2.525 '), 2525);
  assert.equal(parseExportTime('.5'), 500);
  assert.equal(parseExportTime('00:02.525'), 2525);
  assert.equal(parseExportTime('1:02:03.125'), 3_723_125);
  assert.equal(parseExportTime('90:00'), 5_400_000);
  assert.deepEqual(readExportRange('2.525', '00:18.750', 23_200), { fromMs: 2525, toMs: 18750 });
  assert.deepEqual(readExportRange('0', '23.2', 23_200), { fromMs: 0, toMs: 23_200 });
});

test('player timecodes select the same frame at integer and NTSC rates', () => {
  for (const fps of [24, 25, 29.97, 30, 59.94, 60]) {
    const ms = parseExportTime('00:00:17:12', fps)!;
    assert.equal(formatTimecode(ms, { fps }), '00:00:17:12');
  }
  assert.equal(parseExportTime('00:00:02:15', 30), 2500);
});

test('malformed times and empty, reversed or out-of-film ranges are rejected', () => {
  for (const raw of ['', 'abc', '-1', 'Infinity', '1e3', '1:60', '1:60:00', '1.5:20', '1::2', '00:00:01:30', '00:00:01:1.5', '0:0:0:0:0']) {
    assert.equal(parseExportTime(raw), null, raw);
  }
  for (const [from, to] of [['', '4'], ['2', '2'], ['4', '2'], ['0', '23.201'], ['24', '25']]) {
    assert.equal(readExportRange(from!, to!, 23_200), null, `${from}–${to}`);
  }
});

test('multiple selections retain order and invalidate the whole request if any range is wrong', () => {
  const parts = [{ id: 'later', from: '12.5', to: '15' }, { id: 'earlier', from: '2', to: '4' }];
  assert.deepEqual(readExportRanges(parts, 23_200, 30), [[12.5, 15], [2, 4]]);
  assert.equal(readExportRanges([...parts, { id: 'bad', from: '20', to: '15' }], 23_200, 30), null);
  assert.equal(readExportRanges([{ id: 'tiny', from: '0', to: '.001' }], 23_200, 30), null);
  assert.equal(readExportRanges([], 23_200, 30), null);
});

test('separate exports queue each range while merged exports queue one ordered selection, with correct estimates', () => {
  const jobs: ExportRequest[] = [{ kind: 'video', codec: 'h264', fps: 30, quality: 'high', audio: true, label: 'H.264', sidecar: 'srt' }];
  const ranges: [number, number][] = [[12.5, 15], [2, 4]];
  const separate = applyRangeDelivery(jobs, ranges, 'separate');
  assert.deepEqual(separate.map((job) => job.range), ranges);
  assert.equal(separate[0]?.sidecar, 'srt');
  assert.equal(separate.reduce((n, job) => n + requestDurationMs(job, 23_200), 0), 4500);
  const merged = applyRangeDelivery(jobs, ranges, 'merged');
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]?.ranges, ranges);
  assert.equal(merged[0]?.range, undefined);
  assert.equal(requestDurationMs(merged[0]!, 23_200), 4500);
});
