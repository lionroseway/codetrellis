import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slideOrder, slideText, thumbnailPart } from './pptx-xml';

const RELS = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="/ppt/slides/slide3.xml"/>
</Relationships>`;
const PARTS = ['ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml'];

test('slide N is PowerPoint\'s order, not the file name\'s number', () => {
  // slide2.xml was moved to the front.
  const presentation = '<p:presentation><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst></p:presentation>';
  assert.deepEqual(slideOrder(presentation, RELS, PARTS), ['ppt/slides/slide2.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide3.xml']);
});

test('without a usable order, the file names\' numbers decide, numerically', () => {
  const parts = ['ppt/slides/slide10.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide1.xml', 'ppt/slides/_rels/slide1.xml.rels'];
  assert.deepEqual(slideOrder(null, null, parts), ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide10.xml']);
  // A relationship to a part that is not in the archive is not a slide.
  const dangling = '<p:sldIdLst><p:sldId r:id="rId9"/></p:sldIdLst>';
  assert.deepEqual(slideOrder(dangling, RELS, parts), ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide10.xml']);
});

test('the title placeholder is the title; every other paragraph is text, and a table row is one line', () => {
  const xml = `<p:sld><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Q3 </a:t></a:r><a:r><a:t>results</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p><a:pPr lvl="0"/><a:r><a:t>Revenue &amp; margin</a:t></a:r></a:p><a:p/><a:p><a:r><a:t xml:space="preserve">Up </a:t></a:r><a:br/><a:r><a:t>12%</a:t></a:r></a:p></p:txBody></p:sp>
    <p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Region</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Q3</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>North</a:t></a:r></a:p></a:txBody></a:tc><a:tc/><a:tc><a:txBody><a:p><a:r><a:t>120</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc/></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
  </p:spTree></p:cSld></p:sld>`;
  assert.deepEqual(slideText(2, xml), { n: 2, title: 'Q3 results', paragraphs: ['Revenue & margin', 'Up 12%', 'Region · Q3', 'North ·  · 120'] });
});

test('a slide with no title placeholder has no title, and its words are still read', () => {
  const xml = '<p:sld><p:sp><p:txBody><a:p><a:r><a:t>Only a box</a:t></a:r></a:p></p:txBody></p:sp></p:sld>';
  assert.deepEqual(slideText(1, xml), { n: 1, title: null, paragraphs: ['Only a box'] });
});

test('the thumbnail comes from the package relationships', () => {
  const rels = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/></Relationships>';
  assert.equal(thumbnailPart(rels), 'docProps/thumbnail.jpeg');
  assert.equal(thumbnailPart('<Relationships/>'), null);
  assert.equal(thumbnailPart(null), null);
});
