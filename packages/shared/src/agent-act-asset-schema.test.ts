import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicActivityResult } from './agent-activity';
import { publicGenerationEventSchema } from './contract';

test('a made asset passes the event schema; a path outside assets/ does not', () => {
  const asset = publicActivityResult('image_gen', JSON.stringify({ src: 'assets/image/wall.png' }), false);
  assert.ok(publicGenerationEventSchema.safeParse({ type: 'agent-act-done', callId: 'c1', asset }).success);
  for (const src of ['/etc/passwd', 'mg/scene.tsx']) {
    const parsed = publicGenerationEventSchema.safeParse({ type: 'agent-act-done', callId: 'c1', asset: { kind: 'image', src } });
    assert.equal(parsed.success, false, src);
  }
});
