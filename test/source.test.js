const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { encodePng } = require('../src/png');
const { loadSource } = require('../src/source');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-source-'));
}

describe('external source loading', () => {
  test('unwraps one exact Markdown-fenced SVG response', () => {
    const cwd = tempDir();
    fs.writeFileSync(
      path.join(cwd, 'icon.svg'),
      '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"></svg>\n```\n',
    );
    const source = loadSource(cwd, { mark: { source: './icon.svg' } });
    assert.equal(source.type, 'svg');
    assert.match(source.svg, /^<svg/);
    assert.doesNotMatch(source.svg, /```/);
  });

  test('rejects prose wrapped around an SVG response', () => {
    const cwd = tempDir();
    fs.writeFileSync(
      path.join(cwd, 'icon.svg'),
      'Here is the icon:\n```svg\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n```\n',
    );
    assert.throws(
      () => loadSource(cwd, { mark: { source: './icon.svg' } }),
      /source must be an SVG or PNG file/,
    );
  });

  test('classifies PNG signature before SVG-like metadata', () => {
    const cwd = tempDir();
    const png = Buffer.concat([encodePng(1, 1, Buffer.from([1, 2, 3, 255])), Buffer.from('<svg metadata>')]);
    fs.writeFileSync(path.join(cwd, 'icon.png'), png);
    assert.equal(loadSource(cwd, { mark: { source: './icon.png' } }).type, 'png');
  });
});
