const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

describe('public API', () => {
  test('exports only the documented makeIcons API', () => {
    const api = require('../src');
    assert.deepEqual(Object.keys(api).sort(), ['makeIcons']);
    assert.equal(typeof api.makeIcons, 'function');
  });
});
