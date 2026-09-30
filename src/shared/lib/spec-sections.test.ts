import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingSlug, specSections, findSection, sectionText } from './spec-sections';

const PAGE = [
  '# Invoice format',
  'An invoice is a JSON document.',
  '## Fields',
  '- amount',
  '### Currency (ISO 4217)',
  'Three letters.',
  '## Totals',
  '```md',
  '## Not a heading',
  '```',
  '## Fields',
  'Again.',
].join('\n');

test('a heading becomes its slug, the way links to it are written', () => {
  assert.equal(headingSlug('Fields'), 'fields');
  assert.equal(headingSlug('Currency (ISO 4217)'), 'currency-iso-4217');
  assert.equal(headingSlug('  `amount` & *total*  '), 'amount-total');
  assert.equal(headingSlug('Données clés'), 'données-clés');
});

test('every heading, with its extent up to the next one at its level or above; fenced code is not a heading', () => {
  const s = specSections(PAGE);
  assert.deepEqual(s.map((x) => [x.slug, x.level, x.line, x.end]), [
    ['invoice-format', 1, 0, 12],
    ['fields', 2, 2, 6],
    ['currency-iso-4217', 3, 4, 6],
    ['totals', 2, 6, 10],
    ['fields-2', 2, 10, 12],
  ]);
});

test('a section is found by its slug and read with its heading; one that is not there is undefined', () => {
  assert.equal(findSection(PAGE, 'totals')?.title, 'Totals');
  assert.equal(sectionText(PAGE, 'fields'), '## Fields\n- amount\n### Currency (ISO 4217)\nThree letters.');
  assert.equal(findSection(PAGE, 'nope'), undefined);
  assert.equal(sectionText('', 'fields'), undefined);
});
