import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookie } from './http.mjs';

/** Only the headers are read: a plain object stands in for an IncomingMessage. */
const withCookie = (value) => ({ headers: value === undefined ? {} : { cookie: value } });

test('a cookie is read as it was written, or left alone when its % escapes are broken', () => {
  assert.equal(cookie(withCookie('studio=ok'), 'studio'), 'ok');
  assert.equal(cookie(withCookie('studio=hello%20world; other=1'), 'studio'), 'hello world');
  assert.equal(cookie(withCookie('other=1; studio=ok'), 'studio'), 'ok');
  for (const broken of ['studio=%ZZ', 'studio=abc%', 'studio=%E0%A4%A', 'studio=%', 'studio=%zz; other=1']) {
    assert.equal(cookie(withCookie(broken), 'studio'), null, broken);
  }
  assert.equal(cookie(withCookie(), 'studio'), null, 'no cookie header');
  assert.equal(cookie(withCookie('other=1'), 'studio'), null, 'another cookie only');
});
