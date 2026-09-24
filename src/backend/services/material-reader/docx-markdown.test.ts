/**
 * Phase 31 §5.1 — mammoth's HTML as GFM: tables stay tables, lists keep
 * their nesting and numbers, and nothing in the text becomes markup.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docxHtmlToMarkdown } from './docx-markdown';

test('headings, emphasis and paragraphs', () => {
  assert.equal(
    docxHtmlToMarkdown('<h1>Q3 summary</h1><p><em>Prepared for the board.</em></p><p>Margin <strong>held</strong> at 41%.</p>'),
    '# Q3 summary\n\n_Prepared for the board._\n\nMargin **held** at 41%.',
  );
});

test('lists keep their numbers and nesting', () => {
  assert.equal(
    docxHtmlToMarkdown('<ol><li>Reconcile<ul><li>EMEA</li><li>APAC</li></ul></li><li>Restate</li></ol><p>After.</p>'),
    '1. Reconcile\n  - EMEA\n  - APAC\n2. Restate\n\nAfter.',
  );
});

test('a table is a GFM table; a pipe in a cell is escaped; paragraphs in a cell join', () => {
  assert.equal(
    docxHtmlToMarkdown('<table><tr><td><p>Region</p></td><td><p>Q3</p></td></tr><tr><td><p>EMEA</p><p>(restated)</p></td><td><p>1|2</p></td></tr></table>'),
    '| Region | Q3 |\n| --- | --- |\n| EMEA (restated) | 1\\|2 |',
  );
});

test('entities decode, images and links are words, and a line break breaks the line', () => {
  assert.equal(
    docxHtmlToMarkdown('<p>R&amp;D &lt;script&gt; &#8212; ok<br />next</p><p><img src="" alt="Revenue chart" /> <a href="https://example.com/a">source</a></p>'),
    'R&D <script> — ok\nnext\n\n[image: Revenue chart] [source](https://example.com/a)',
  );
});
