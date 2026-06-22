const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeIco, encodeIcns } = require('../src/containers');
const { PNG_SIGNATURE } = require('../src/png');

describe('icon containers', () => {
  test('encodes PNG-backed ICO files', () => {
    const png = Buffer.concat([PNG_SIGNATURE, Buffer.from('fake')]);
    const ico = encodeIco([{ size: 256, png }]);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 1);
    assert.equal(ico[6], 0);
    assert.equal(ico.readUInt32LE(14), png.length);
  });

  test('encodes PNG-backed ICNS files', () => {
    const png = Buffer.concat([PNG_SIGNATURE, Buffer.from('fake')]);
    const icns = encodeIcns([{ size: 128, png }]);
    assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
    assert.equal(icns.subarray(8, 12).toString('ascii'), 'ic07');
  });
});
