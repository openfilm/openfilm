import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../i18n/en.ts';
import { es } from '../i18n/es.ts';

const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();

test('the Spanish editing-export hint names the app as often as the English one', () => {
  assert.deepEqual(placeholders(es.exportCenter.nleHintDraft), placeholders(en.exportCenter.nleHintDraft));
});
