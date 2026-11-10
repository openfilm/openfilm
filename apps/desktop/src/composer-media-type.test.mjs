import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The chat sources are written for a bundler: a relative import may leave out the
// .ts extension, and Node's own TypeScript loader does not add it back. Teach this
// test to resolve those names the way the app's bundler does.
const loader = [
  'export async function resolve(specifier, context, nextResolve) {',
  '  try { return await nextResolve(specifier, context); }',
  '  catch (error) {',
  "    if (error.code !== 'ERR_MODULE_NOT_FOUND' || specifier.endsWith('.ts')) throw error;",
  '    return nextResolve(`${specifier}.ts`, context);',
  '  }',
  '}',
].join('\n');
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const { documentMediaType } = await import('../chat/src/lib/composer-attachments.ts');

test('a file the browser gives no type still has one on the wire', () => {
  assert.equal(documentMediaType({ name: 'notes.xyz', type: '' }), 'application/octet-stream');
  assert.equal(documentMediaType({ name: 'notes.xyz', type: 'text/plain' }), 'text/plain');
});
