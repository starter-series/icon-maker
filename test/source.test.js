const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { crc32, encodePng } = require('../src/png');
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

  test('rejects malformed source data before a nested image can silently render blank', () => {
    const cwd = tempDir();
    const png = encodePng(1, 1, Buffer.from([1, 2, 3, 255]));
    for (const [name, contents] of [
      ['broken.svg', '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'],
      ['broken.png', png.subarray(0, 24)],
    ]) {
      fs.writeFileSync(path.join(cwd, name), contents);
      assert.throws(() => loadSource(cwd, { mark: { source: name } }), /invalid|valid|parse/i);
    }
  });

  test('classifies PNG signature before SVG-like metadata', () => {
    const cwd = tempDir();
    const original = encodePng(1, 1, Buffer.from([1, 2, 3, 255]));
    const type = Buffer.from('tEXt');
    const data = Buffer.from('Comment\0<svg metadata>');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32([type, data]));
    const png = Buffer.concat([original.subarray(0, -12), length, type, data, crc, original.subarray(-12)]);
    fs.writeFileSync(path.join(cwd, 'icon.png'), png);
    assert.equal(loadSource(cwd, { mark: { source: './icon.png' } }).type, 'png');
  });

  test('loads role-specific adaptive, maskable, round, and monochrome sources without default fallback', () => {
    const cwd = tempDir();
    for (const name of ['default', 'adaptive', 'maskable', 'round', 'monochrome']) {
      fs.writeFileSync(
        path.join(cwd, `${name}.svg`),
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>${name}</title></svg>`,
      );
    }
    const config = {
      mark: {
        source: {
          default: './default.svg',
          adaptiveForeground: './adaptive.svg',
          maskable: './maskable.svg',
          round: './round.svg',
          monochrome: './monochrome.svg',
        },
      },
    };
    assert.match(loadSource(cwd, config, 'adaptive-foreground').svg, /adaptive/);
    assert.match(loadSource(cwd, config, 'maskable').svg, /maskable/);
    assert.match(loadSource(cwd, config, 'round').svg, /round/);
    assert.match(loadSource(cwd, config, 'monochrome').svg, /monochrome/);
    assert.equal(loadSource(cwd, { mark: { source: './default.svg' } }, 'maskable'), null);
    assert.equal(loadSource(cwd, { mark: { source: './default.svg' } }, 'monochrome'), null);
  });
});
