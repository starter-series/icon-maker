const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertContainedExistingPath,
  assertContainedOutputPath,
  isContainedPath,
  sameRealFile,
} = require('../src/path-safety');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-path-'));
}

describe('path safety', () => {
  test('distinguishes contained paths from sibling paths', () => {
    const root = tempDir();
    assert.equal(isContainedPath(root, path.join(root, 'assets', 'icon.png')), true);
    assert.equal(isContainedPath(root, path.join(root, '..cache', 'icon.png')), true);
    assert.equal(isContainedPath(root, path.join(path.dirname(root), 'outside.png')), false);
  });

  test('returns contained existing paths and rejects outside inputs as usage errors', () => {
    const root = tempDir();
    const inside = path.join(root, 'icon.svg');
    const outsideRoot = tempDir();
    const outside = path.join(outsideRoot, 'icon.svg');
    fs.writeFileSync(inside, '<svg/>');
    fs.writeFileSync(outside, '<svg/>');

    assert.equal(assertContainedExistingPath(root, inside, 'mark.source'), fs.realpathSync(inside));
    assert.throws(
      () => assertContainedExistingPath(root, outside, 'mark.source'),
      { exitCode: 2, message: /mark\.source must stay inside the target directory/ },
    );
  });

  test('validates future output paths and detects matching real files', () => {
    const root = tempDir();
    const existing = path.join(root, 'source.png');
    fs.writeFileSync(existing, 'source');

    assert.equal(
      assertContainedOutputPath(root, path.join(root, 'nested', 'icon.png')),
      path.join(root, 'nested', 'icon.png'),
    );
    assert.throws(
      () => assertContainedOutputPath(root, path.join(path.dirname(root), 'outside.png')),
      { exitCode: 2, message: /output path must stay inside the target directory/ },
    );
    assert.equal(sameRealFile(existing, path.join(root, '.', 'source.png')), true);
    assert.equal(sameRealFile(existing, path.join(root, 'missing.png')), false);
  });
});
