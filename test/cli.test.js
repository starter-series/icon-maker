const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initConfig, parseArgs } = require('../src/cli');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-cli-'));
}

describe('cli args', () => {
  test('parses path, repeated targets, patch, and json', () => {
    const opts = parseArgs(['../app', '--target', 'expo,browser-extension', '--target', 'pwa', '--patch', '--json']);
    assert.equal(opts.path, '../app');
    assert.deepEqual(opts.targets, ['expo', 'browser-extension', 'pwa']);
    assert.equal(opts.patch, true);
    assert.equal(opts.json, true);
  });

  test('parses dry-run and out-dir', () => {
    const opts = parseArgs(['--dry-run', '--preview', '--out-dir', 'out']);
    assert.equal(opts.dryRun, true);
    assert.equal(opts.preview, true);
    assert.equal(opts.outDir, 'out');
  });

  test('init uses explicit target presets', () => {
    const cwd = tempDir();
    const result = initConfig(cwd, ['expo']);
    const text = fs.readFileSync(result.configPath, 'utf8');
    assert.equal(result.created, true);
    assert.ok(text.includes("glyph: \"spark\""));
    assert.ok(text.includes('targets: ["expo"]'));
  });
});
