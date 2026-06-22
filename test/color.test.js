const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { contrastRatio, parseHexColor, toHex } = require('../src/color');

describe('colors', () => {
  test('parses short, long, and transparent colors', () => {
    assert.deepEqual(parseHexColor('#abc'), { r: 170, g: 187, b: 204, a: 255 });
    assert.deepEqual(parseHexColor('#11223344'), { r: 17, g: 34, b: 51, a: 68 });
    assert.deepEqual(parseHexColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  });

  test('serializes hex and computes contrast', () => {
    assert.equal(toHex({ r: 255, g: 255, b: 255, a: 255 }), '#ffffff');
    assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  });
});
