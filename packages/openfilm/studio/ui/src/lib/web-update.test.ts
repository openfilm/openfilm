import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusedUpdate, webUpdateOf, type VersionSaid } from './web-update.ts';

const said = (over: Partial<VersionSaid> = {}): VersionSaid => ({ version: '0.1.8', latest: '0.1.9', newer: true, checking: true, source: false, ...over });

test("a newer openfilm is offered; none to a Studio that runs the newest, or that does not update itself", () => {
  assert.deepEqual(webUpdateOf(said()), { status: 'available', version: '0.1.9' });
  assert.equal(webUpdateOf(said({ newer: false, latest: '0.1.8' })), null);
  assert.equal(webUpdateOf(said({ source: true })), null, 'a source checkout: git pull');
  assert.equal(webUpdateOf(said({ checking: false })), null, 'checks turned off');
  assert.equal(webUpdateOf(null), null);
});

test('an update Studio is running, or one that failed, is shown as Studio says it', () => {
  assert.deepEqual(webUpdateOf(said({ update: { status: 'updating', version: '0.1.9' } })), { status: 'updating', version: '0.1.9' });
  assert.deepEqual(webUpdateOf(said({ update: { status: 'failed', version: '0.1.9', error: 'npx did not start' } })),
    { status: 'failed', version: '0.1.9', error: 'npx did not start' });
});

test('an export or media being made is a wait; the newest already, nothing; anything else failed', () => {
  assert.deepEqual(refusedUpdate('0.1.9', 'exporting', 'an export is running'), { status: 'waiting', version: '0.1.9', reason: 'exporting' });
  assert.deepEqual(refusedUpdate('0.1.9', 'making', 'media is being made'), { status: 'waiting', version: '0.1.9', reason: 'making' });
  assert.equal(refusedUpdate('0.1.9', 'newest', 'this is the newest openfilm'), null);
  assert.deepEqual(refusedUpdate('0.1.9', undefined, 'Studio answered 500'), { status: 'failed', version: '0.1.9', error: 'Studio answered 500' });
});
