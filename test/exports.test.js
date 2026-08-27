const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

describe('public API', () => {
  test('exports the documented compile and check APIs', () => {
    const api = require('../src');
    assert.deepEqual(Object.keys(api).sort(), ['checkIcons', 'makeIcons']);
    assert.equal(typeof api.checkIcons, 'function');
    assert.equal(typeof api.makeIcons, 'function');
  });
});
