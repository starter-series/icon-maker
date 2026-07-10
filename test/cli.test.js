const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initConfig, parseArgs } = require('../src/cli');
const { makeDesignBrief } = require('../src/brief');

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

  test('parses provider-neutral brief and direct source options', () => {
    const brief = parseArgs(['--brief', '--target', 'apple,pwa', '--json']);
    assert.equal(brief.brief, true);
    assert.deepEqual(brief.targets, ['apple', 'pwa']);

    const compile = parseArgs([
      '--source', './brand/icon.png',
      '--adaptive-source', './brand/icon-adaptive.svg',
      '--target', 'apple',
    ]);
    assert.equal(compile.source, './brand/icon.png');
    assert.equal(compile.adaptiveSource, './brand/icon-adaptive.svg');
  });

  test('rejects unknown options and missing option values as usage errors', () => {
    assert.throws(() => parseArgs(['--unknown']), { exitCode: 2, message: /Unknown option/ });
    assert.throws(() => parseArgs(['--target']), { exitCode: 2, message: /--target requires a value/ });
    assert.throws(() => parseArgs(['one', 'two']), { exitCode: 2, message: /Unexpected positional argument/ });
    assert.throws(() => parseArgs(['--brief', '--source', 'icon.svg']), { exitCode: 2, message: /cannot be combined/ });
    assert.throws(() => parseArgs(['--brief', '--preview']), { exitCode: 2, message: /compile output options/ });
    assert.throws(() => parseArgs(['--init', '--source', 'icon.svg']), { exitCode: 2, message: /cannot be combined/ });
  });

  test('prints a provider-neutral design brief without writing files', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(process.execPath, [bin, cwd, '--brief', '--target', 'apple,pwa', '--json'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.equal(parsed.kind, 'design-brief');
    assert.deepEqual(parsed.targets, ['apple', 'pwa']);
    assert.deepEqual(parsed.sourceContract.accepted, ['svg', 'png']);
    assert.match(parsed.prompt, /Xcode/);
    assert.match(parsed.prompt, /text-only interface/);
    assert.deepEqual(fs.readdirSync(cwd), []);
  });

  test('only includes Apple-specific design rules when Apple is targeted', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(process.execPath, [bin, cwd, '--brief', '--target', 'pwa', '--json'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.doesNotMatch(parsed.prompt, /Apple's rounded mask/);
  });

  test('uses package description as product context in the design brief', () => {
    const cwd = tempDir();
    fs.writeFileSync(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'focus-timer', description: 'A quiet focus timer for remote teams' }),
    );
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(process.execPath, [bin, cwd, '--brief', '--target', 'generic', '--json'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.equal(parsed.project.description, 'A quiet focus timer for remote teams');
    assert.match(parsed.prompt, /quiet focus timer for remote teams/);
  });

  test('uses the requested target preset when no config exists', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(process.execPath, [bin, cwd, '--brief', '--target', 'expo', '--json'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.match(parsed.prompt, /background #4630eb/);
    assert.match(parsed.prompt, /exactly two labelled SVG code blocks/);
    assert.doesNotMatch(parsed.prompt, /exactly one SVG code block/);
  });

  test('uses input config targets for programmatic brief presets', () => {
    const cwd = tempDir();
    const result = makeDesignBrief({ project: { name: 'Expo App' }, targets: ['expo'] }, { cwd });
    assert.match(result.prompt, /background #4630eb/);
    assert.deepEqual(result.targets, ['expo']);
  });

  test('passes a direct source through the CLI without a config file', () => {
    const cwd = tempDir();
    const brand = path.join(cwd, 'brand');
    fs.mkdirSync(brand);
    fs.writeFileSync(
      path.join(brand, 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#123456"/></svg>',
    );
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(
      process.execPath,
      [bin, cwd, '--source', './brand/icon.svg', '--target', 'browser-extension', '--out-dir', 'out', '--json'],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.equal(parsed.source.type, 'svg');
    assert.equal(parsed.produced.every((item) => fs.existsSync(item.path)), true);
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

  test('--json keeps delayed config output off stdout', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    fs.writeFileSync(
      path.join(cwd, 'icon-maker.config.js'),
      "process.nextTick(() => console.log('ASYNC_CONFIG_NOISE')); module.exports = { targets: ['generic'] };\n",
    );
    const result = spawnSync(process.execPath, [bin, '--dry-run', '--json'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim().split('\n').length, 1);
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.match(result.stderr, /ASYNC_CONFIG_NOISE/);
  });
});
