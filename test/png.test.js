const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeRgbPng, resizeRgba, unpremultiplyRgba } = require('../src/png');

describe('RGBA resizing', () => {
  test('area-averages in premultiplied alpha space', () => {
    const source = Buffer.from([
      255, 0, 0, 255,
      0, 0, 255, 0,
    ]);
    assert.deepEqual([...resizeRgba(2, 1, source, 1, 1)], [255, 0, 0, 128]);
  });

  test('returns an independent copy when dimensions do not change', () => {
    const source = Buffer.from([12, 34, 56, 78]);
    const resized = resizeRgba(1, 1, source, 1, 1);
    assert.deepEqual(resized, source);
    assert.notEqual(resized, source);
  });

  test('normalizes premultiplied RGBA before resizing', () => {
    const premultiplied = Buffer.from([128, 0, 0, 128]);
    assert.deepEqual([...unpremultiplyRgba(premultiplied)], [255, 0, 0, 128]);
  });

  test('encodes opaque RGB PNGs without an alpha channel', () => {
    const png = encodeRgbPng(1, 1, Buffer.from([12, 34, 56, 255]));
    assert.equal(png[24], 8);
    assert.equal(png[25], 2);
  });
});
