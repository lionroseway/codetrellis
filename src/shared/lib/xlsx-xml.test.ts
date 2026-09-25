/**
 * The workbook reader both the checks and the viewer's worker use.
 * Values as the spreadsheet app last saved them, dates by style, caps held.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateStyles,
  parseSharedStrings,
  parseSheetGrid,
  parseWorkbookSheets,
  serialToDate,
  sheetDimension,
} from './xlsx-xml';

const CAPS = { maxRows: 100, maxCols: 50, maxCells: 1000 };

describe('the workbook part', () => {
  test('sheets in order, each with the part that holds it; names decoded', () => {
    const wb = '<workbook><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Regional &amp; FX" sheetId="2" r:id="rId2"/></sheets></workbook>';
    const rels = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>';
    assert.deepEqual(parseWorkbookSheets(wb, rels), [
      { name: 'Summary', part: 'xl/worksheets/sheet1.xml' },
      { name: 'Regional & FX', part: 'xl/worksheets/sheet2.xml' },
    ]);
    assert.equal(sheetDimension('<worksheet><dimension ref="A1:F20"/></worksheet>'), 'A1:F20');
  });

  test('shared strings join rich-text runs', () => {
    assert.deepEqual(
      parseSharedStrings('<sst><si><t>EMEA</t></si><si><r><t>Q3 </t></r><r><t xml:space="preserve">total</t></r></si></sst>'),
      ['EMEA', 'Q3 total'],
    );
  });
});

describe('cells', () => {
  const styles =
    '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;day&quot;0.00"/></numFmts>' +
    '<cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';

  test('date formats: built-in and custom, and a quoted "d" is not a date', () => {
    assert.deepEqual([...parseDateStyles(styles)].sort(), [1, 2]);
  });

  test('shared, inline, number, date, boolean and error cells — as text, in place', () => {
    const sheet =
      '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>note &lt;b&gt;</t></is></c></row>' +
      '<row r="2"><c r="A2"><v>120.5</v></c><c r="B2" s="1"><v>45565</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="e"><v>#DIV/0!</v></c>' +
      '<c r="E2"><f>SUM(A2:A2)</f><v>120.5</v></c></row></sheetData>';
    const grid = parseSheetGrid(sheet, ['EMEA'], parseDateStyles(styles), CAPS);
    assert.deepEqual(grid.rows, [
      ['EMEA', '', 'note <b>'],
      ['120.5', serialToDate(45565), 'TRUE', '#DIV/0!', '120.5'],
    ]);
    assert.equal(serialToDate(45565), '2024-09-30');
    assert.equal(grid.truncated, false);
  });

  test('rows, columns and cells past the caps are left out, and said to be', () => {
    const cells = Array.from({ length: 30 }, (_, i) => `<c r="A${i + 1}"><v>${i}</v></c>`).join('');
    const grid = parseSheetGrid(`<sheetData>${cells}<c r="ZZ1"><v>9</v></c></sheetData>`, [], new Set(), { maxRows: 10, maxCols: 5, maxCells: 1000 });
    assert.equal(grid.rows.length, 10);
    assert.equal(grid.truncated, true);
    const few = parseSheetGrid(`<sheetData>${cells}</sheetData>`, [], new Set(), { maxRows: 100, maxCols: 5, maxCells: 4 });
    assert.equal(few.cells, 4);
    assert.equal(few.truncated, true);
  });
});
