/**
 * The overlay that puts an HTML report into the screenshot. Its placement
 * and clipping are the whole job: a report painted one row off, or past the
 * edge of the buffer, is a wrong picture or a crash.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { overlay, type Raster } from './composite';

/** A w×h raster filled with one value per pixel (all four bytes). */
function fill(width: number, height: number, v: number): Raster {
  return { data: Buffer.alloc(width * height * 4, v), width, height };
}
const at = (r: Raster, data: Buffer, x: number, y: number) => data[(y * r.width + x) * 4];

describe('overlay', () => {
  test('copies the top raster in at its offset and leaves the rest alone', () => {
    const base = fill(6, 5, 1);
    const out = overlay(base, fill(2, 3, 9), 3, 1);
    assert.equal(at(base, out, 3, 1), 9);
    assert.equal(at(base, out, 4, 3), 9);
    assert.equal(at(base, out, 2, 1), 1);
    assert.equal(at(base, out, 5, 1), 1);
    assert.equal(at(base, out, 3, 0), 1);
    assert.equal(at(base, out, 3, 4), 1);
  });

  test('clips a top raster that runs past the right and bottom edges', () => {
    const base = fill(4, 4, 1);
    const out = overlay(base, fill(10, 10, 9), 2, 3);
    assert.equal(out.length, base.data.length);
    assert.equal(at(base, out, 3, 3), 9);
    assert.equal(at(base, out, 1, 3), 1);
    assert.equal(at(base, out, 3, 2), 1);
  });

  test('clips a top raster placed at a negative offset', () => {
    const base = fill(4, 4, 1);
    const top: Raster = { data: Buffer.alloc(3 * 3 * 4), width: 3, height: 3 };
    for (let i = 0; i < 9; i++) top.data.fill(10 + i, i * 4, i * 4 + 4); // each pixel its own value
    const out = overlay(base, top, -1, -2);
    // Pixel (0,0) of the base is pixel (1,2) of the top: 10 + 2*3 + 1.
    assert.equal(at(base, out, 0, 0), 17);
    assert.equal(at(base, out, 1, 0), 18);
    assert.equal(at(base, out, 0, 1), 1);
  });

  test('a top raster entirely outside changes nothing, and the base is never mutated', () => {
    const base = fill(4, 4, 1);
    assert.deepEqual(overlay(base, fill(2, 2, 9), 10, 10), base.data);
    overlay(base, fill(2, 2, 9), 0, 0);
    assert.ok(base.data.every((b) => b === 1));
  });
});
