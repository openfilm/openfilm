import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pipeline } from '@/api';
import { nextStage, progress } from './pipeline.ts';

/** A line with its stages as the server sends them: in order, each with its status. */
const line = (...statuses: ('todo' | 'doing' | 'done')[]): Pipeline => ({
  version: 1,
  stages: statuses.map((status, i) => ({ name: `stage${i}`, leaves: `what stage${i} leaves`, status })),
});

test('the film is at its first stage that is not done', () => {
  const pipeline = line('done', 'done', 'doing', 'todo', 'todo', 'todo', 'todo');
  assert.equal(nextStage(pipeline)?.name, 'stage2');
  assert.equal(nextStage(line('done', 'done', 'done', 'done', 'done', 'done', 'done')), null);
});

test('the panel says how far the line has come', () => {
  assert.deepEqual(progress(line('done', 'doing', 'todo', 'todo', 'todo', 'todo', 'todo')), { done: 1, total: 7 });
  assert.deepEqual(progress(line('done', 'done', 'done', 'done', 'done', 'done', 'done')), { done: 7, total: 7 });
});
