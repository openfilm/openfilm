import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_TOOLS, clipModels } from './canvas-clip.ts';

const tool = (key: string) => CLIP_TOOLS.find((x) => x.key === key)!;
const seedance = { via: 'openfilm', model: 'volcengine/doubao-seedance-2-0-mini-260615', name: 'Seedance 2.0 Mini', spec: { refs: 9, clip: 3, voice: 3, frames: true as const } };
const kling = { via: 'fal', model: 'kling-o3-edit', name: 'Kling O3 Edit', spec: { refs: 4, needs: 'clip' as const } };
const words = { via: 'openrouter', model: 'kwaivgi/kling-v3.0-pro', name: 'Kling 3.0', spec: { refs: 0, frames: true as const } };
const noVoice = { via: 'google', model: 'gemini-omni-1.2-flash', name: 'Gemini Omni', spec: { refs: 6, clip: true } };

test('a clip tool is offered by the model made for it first, then by those that take a clip as a reference and what else it needs', () => {
  assert.deepEqual(clipModels(tool('edit'), [seedance, kling, words]).map((c) => c.name), ['Kling O3 Edit', 'Seedance 2.0 Mini']);
  assert.deepEqual(clipModels(tool('extend'), [seedance, noVoice, words]).map((c) => c.name), ['Gemini Omni', 'Seedance 2.0 Mini']);
  /* a recording needs a model that takes one; a model made for another tool does not do this one */
  assert.deepEqual(clipModels(tool('lipsync'), [noVoice, kling, seedance]).map((c) => c.name), ['Seedance 2.0 Mini']);
  assert.deepEqual(clipModels(tool('motion'), [words]), []);
  /* through OpenFilm the model's id carries its provider */
  assert.equal(clipModels(tool('edit'), [{ ...kling, via: 'openfilm', model: 'fal/kling-o3-edit' }])[0]!.name, 'Kling O3 Edit');
});
