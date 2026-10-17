import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromiumBased } from './browser.ts';

test('Chromium browsers are told from the others by their brands, else their user agent', () => {
  const ua = {
    chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Safari/605.1.15',
    firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
  };
  assert.equal(chromiumBased(ua.chrome), true);
  assert.equal(chromiumBased(ua.edge), true);
  assert.equal(chromiumBased(ua.safari), false);
  assert.equal(chromiumBased(ua.firefox), false);
  assert.equal(chromiumBased('', [{ brand: 'Not A;Brand' }, { brand: 'Chromium' }]), true);
});
