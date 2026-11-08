import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInlineMarkdown, safeMarkdownHref } from './markdown-blocks';

test('a link written with backslashes does not leave the site', () => {
  const base = 'https://openfilm.dev/chat/turn';
  for (const href of ['\\\\evil.com', '/\\\\evil.com', '\\\\/evil.com', '\\\\\\\\evil.com']) {
    assert.equal(new URL(href, base).origin, 'https://evil.com', `${href} is read as an outside host by a browser`);
    assert.equal(safeMarkdownHref(href), null, href);
  }
  /* a reply's link whose target is not allowed stays plain text */
  for (const piece of parseInlineMarkdown('[a clip](\\\\evil.com)')) {
    assert.notEqual(piece.kind, 'link');
  }
});

test('ordinary links are unchanged, and other schemes are still not allowed', () => {
  assert.equal(safeMarkdownHref('https://example.com/clip'), 'https://example.com/clip');
  assert.equal(safeMarkdownHref('/clips/take.wav'), '/clips/take.wav');
  assert.equal(safeMarkdownHref('clips/take.wav'), 'clips/take.wav');
  assert.equal(safeMarkdownHref('javascript:alert(1)'), null);
  assert.equal(safeMarkdownHref('data:text/html,hi'), null);
});
