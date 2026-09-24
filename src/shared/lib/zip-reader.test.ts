/**
 * The viewer workers' zip reader: a bomb is stopped by what it actually
 * inflates to, not by what it declares, and every entry counts — including
 * a second entry that reuses a name.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { CapError, listEntries, readEntry, readText, type InflateBudget } from './zip-reader';

/** A zip whose entries declare `declared` as their size, whatever they inflate to. */
function zip(parts: Array<[string, Buffer, number?]>): ArrayBuffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, raw, declared] of parts) {
    const data = zlib.deflateRawSync(raw);
    const n = Buffer.from(name);
    const size = declared ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(size, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(parts.length, 8); eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  const out = Buffer.concat([...locals, cd, eocd]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

const budget = (maxPart: number, maxTotal: number): InflateBudget => ({ maxPart, maxTotal, used: 0 });

describe('inflating under a budget', () => {
  test('parts read back as they were written', async () => {
    const view = new DataView(zip([['word/document.xml', Buffer.from('<w:document/>')]]));
    assert.equal(await readText(view, listEntries(view), 'word/document.xml', budget(1024, 1024)), '<w:document/>');
    assert.equal(await readText(view, listEntries(view), 'missing.xml', budget(1024, 1024)), null);
  });

  test('a part that inflates past the cap is abandoned, whatever size it declares', async () => {
    const bomb = Buffer.alloc(4 * 1024 * 1024); // 4 MB of zeros deflates to a few KB
    const view = new DataView(zip([['word/media/image1.png', bomb, 10]]));
    const [entry] = listEntries(view);
    assert.ok(entry.compressedSize < 16 * 1024);
    await assert.rejects(readEntry(view, entry, budget(1024 * 1024, 100 * 1024 * 1024)), CapError);
  });

  test('the total counts every entry, so many small parts cannot add up to a bomb', async () => {
    const part = Buffer.alloc(600 * 1024);
    const view = new DataView(zip([['a.xml', part], ['b.xml', part]]));
    const b = budget(1024 * 1024, 1024 * 1024);
    const [first, second] = listEntries(view);
    await readEntry(view, first, b);
    await assert.rejects(readEntry(view, second, b), CapError);
  });

  test('two entries with one name are both listed, so a check by position reaches both', () => {
    const view = new DataView(zip([['word/document.xml', Buffer.from('a')], ['word/document.xml', Buffer.alloc(10)]]));
    assert.equal(listEntries(view).length, 2);
  });

  test('something that is not a zip is refused, not guessed at', () => {
    assert.throws(() => listEntries(new DataView(new TextEncoder().encode('not a zip at all, just words').buffer)), /not a zip/);
  });
});
