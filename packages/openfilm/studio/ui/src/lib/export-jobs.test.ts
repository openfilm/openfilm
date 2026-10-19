import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endedHeadline, exportFileName, formatFilmTime, type ExportJob, type ExportJobStatus } from './export-jobs.ts';
import { exportName } from '../../../server/exports.mjs';

test('the dialog\'s times: tenths only where the time is not a whole second', () => {
  assert.equal(formatFilmTime(7500), '0:07.5');
  assert.equal(formatFilmTime(11_500), '0:11.5');
  assert.equal(formatFilmTime(12_000), '0:12');
  assert.equal(formatFilmTime(4000), '0:04');
  assert.equal(formatFilmTime(3333), '0:03.3');
  assert.equal(formatFilmTime(59_960), '1:00');
  assert.equal(formatFilmTime(3_725_400), '1:02:05.4');
});

const job = (status: ExportJobStatus) => ({ status }) as ExportJob;
const words = (key: string) => key.replace('exportTray.', '');
const headline = (...statuses: ExportJobStatus[]) => endedHeadline(statuses.map(job), words);

test('the tray says how the exports ended: cancelled is not finished, and a mix says each part', () => {
  assert.deepEqual(headline('done', 'done'), { tone: 'ok', text: 'finished' });
  assert.deepEqual(headline('cancelled'), { tone: 'muted', text: 'cancelledOne' });
  assert.deepEqual(headline('cancelled', 'cancelled'), { tone: 'muted', text: 'cancelledAll' });
  assert.deepEqual(headline('failed'), { tone: 'err', text: 'failedOne' });
  assert.deepEqual(headline('failed', 'failed'), { tone: 'err', text: 'failedAll' });
  assert.deepEqual(headline('done', 'cancelled', 'cancelled'), { tone: 'ok', text: 'countDone, countCancelled' });
  assert.deepEqual(headline('cancelled', 'failed'), { tone: 'err', text: 'countCancelled, countFailed' });
  assert.deepEqual(headline('done', 'cancelled', 'failed'), { tone: 'err', text: 'countDone, countCancelled, countFailed' });
});

test('the files\' name the dialog shows back is the one the server writes', () => {
  for (const typed of ['My/Cut: final?.mp4', '  ..hidden. ', 'Trip 2026.v2', 'COM1', 'a\tb\u0007c', '抖音 · 发布片.MOV', '???', 'x'.repeat(100)]) {
    assert.equal(exportFileName(typed), exportName(typed), typed);
  }
  assert.equal(exportFileName('My/Cut: final?.mp4'), 'My Cut final');
});
