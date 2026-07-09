const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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

  test('rejects unknown options and missing option values as usage errors', () => {
    assert.throws(() => parseArgs(['--unknown']), { exitCode: 2, message: /Unknown option/ });
    assert.throws(() => parseArgs(['--target']), { exitCode: 2, message: /--target requires a value/ });
    assert.throws(() => parseArgs(['one', 'two']), { exitCode: 2, message: /Unexpected positional argument/ });
  });

  test('prints JSON usage errors with exit code 2', () => {
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(process.execPath, [bin, '--unknown', '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, error: 'Unknown option: --unknown', code: 2 });
  });

  test('prints unknown target as JSON usage error', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(process.execPath, [bin, cwd, '--target', 'nope', '--dry-run', '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, error: 'Unknown icon target: nope', code: 2 });
  });

  test('init uses explicit target presets', () => {
    const cwd = tempDir();
    const result = initConfig(cwd, ['expo']);
    const text = fs.readFileSync(result.configPath, 'utf8');
    assert.equal(result.created, true);
    assert.ok(text.includes("glyph: \"spark\""));
    assert.ok(text.includes('targets: ["expo"]'));
  });

  test('init honors an explicit JSON config path', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(
      process.execPath,
      [bin, cwd, '--init', '--config', 'custom.config.json', '--target', 'expo', '--json'],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(parsed.created, true);
    assert.equal(parsed.configPath, path.join(cwd, 'custom.config.json'));
    assert.equal(fs.existsSync(path.join(cwd, 'custom.config.json')), true);
    assert.equal(fs.existsSync(path.join(cwd, 'icon-maker.config.js')), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(parsed.configPath, 'utf8')).targets, ['expo']);
  });

  test('--json keeps stdout parseable when a JS config writes to stdout', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    fs.writeFileSync(
      path.join(cwd, 'icon-maker.config.js'),
      "console.log('CONFIG_NOISE'); module.exports = { project: { name: 'Noisy' }, targets: ['generic'] };\n",
    );
    const result = spawnSync(process.execPath, [bin, '--dry-run', '--json'], { cwd, encoding: 'utf8' });
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.equal(parsed.ok, true);
    assert.equal(result.stdout.trim().split('\n').length, 1);
    assert.match(result.stderr, /CONFIG_NOISE/);
  });
});
