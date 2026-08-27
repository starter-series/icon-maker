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

  test('encodes the complete modern PNG-backed ICNS size matrix', () => {
    const png = Buffer.concat([PNG_SIGNATURE, Buffer.from('fake')]);
    const sizes = [16, 32, 64, 128, 256, 512, 1024];
    const icns = encodeIcns(sizes.map((size) => ({ size, png })));
    const types = [];
    let offset = 8;
    while (offset < icns.length) {
      types.push(icns.subarray(offset, offset + 4).toString('ascii'));
      offset += icns.readUInt32BE(offset + 4);
    }
    assert.deepEqual(types, ['icp4', 'icp5', 'icp6', 'ic07', 'ic08', 'ic09', 'ic10']);
  });
});
