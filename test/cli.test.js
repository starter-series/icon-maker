const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initConfig, parseArgs } = require('../src/cli');
const { makeDesignBrief, renderDesignBrief } = require('../src/brief');

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
    const brief = parseArgs([
      '--brief', '--target', 'apple,pwa', '--direction-name', 'Focused signal',
      '--concept', 'a focused signal', '--expresses', 'calm confidence',
      '--visual-metaphor', 'one signal emerging from noise', '--mood', 'precise,quiet',
      '--tradeoff', 'less literal', '--palette', '#0f172a,#14b8a6',
      '--avoid', 'letters,platform logos', '--approve-direction', '--json',
    ]);
    assert.equal(brief.brief, true);
    assert.deepEqual(brief.targets, ['apple', 'pwa']);
    assert.equal(brief.directionName, 'Focused signal');
    assert.equal(brief.concept, 'a focused signal');
    assert.equal(brief.expresses, 'calm confidence');
    assert.equal(brief.visualMetaphor, 'one signal emerging from noise');
    assert.equal(brief.mood, 'precise,quiet');
    assert.equal(brief.tradeoff, 'less literal');
    assert.equal(brief.palette, '#0f172a,#14b8a6');
    assert.equal(brief.avoid, 'letters,platform logos');
    assert.equal(brief.approveDirection, true);

    const compile = parseArgs([
      '--source', './brand/icon.png',
      '--adaptive-source', './brand/icon-adaptive.svg',
      '--target', 'apple',
    ]);
    assert.equal(compile.source, './brand/icon.png');
    assert.equal(compile.adaptiveSource, './brand/icon-adaptive.svg');

    const placeholder = parseArgs(['--placeholder', '--target', 'generic']);
    assert.equal(placeholder.placeholder, true);
  });

  test('rejects unknown options and missing option values as usage errors', () => {
    assert.throws(() => parseArgs(['--unknown']), { exitCode: 2, message: /Unknown option/ });
    assert.throws(() => parseArgs(['--target']), { exitCode: 2, message: /--target requires a value/ });
    assert.throws(() => parseArgs(['one', 'two']), { exitCode: 2, message: /Unexpected positional argument/ });
    assert.throws(() => parseArgs(['--brief', '--source', 'icon.svg']), { exitCode: 2, message: /cannot be combined/ });
    assert.throws(() => parseArgs(['--brief', '--preview']), { exitCode: 2, message: /compile output options/ });
    assert.throws(() => parseArgs(['--init', '--source', 'icon.svg']), { exitCode: 2, message: /cannot be combined/ });
    assert.throws(() => parseArgs(['--placeholder', '--source', 'icon.svg']), { exitCode: 2, message: /cannot be combined/ });
    assert.throws(() => parseArgs(['--brief', '--placeholder']), { exitCode: 2, message: /cannot be combined/ });
    assert.throws(() => parseArgs(['--concept', 'a signal']), { exitCode: 2, message: /require --brief/ });
    assert.throws(() => parseArgs(['--approve-direction']), { exitCode: 2, message: /require --brief/ });
  });

  test('stops at needs-direction without writing files', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(process.execPath, [bin, cwd, '--brief', '--target', 'apple,pwa', '--json'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.equal(parsed.kind, 'source-request');
    assert.equal(parsed.schemaVersion, 2);
    assert.equal(parsed.requestType, 'direction-discovery');
    assert.equal(parsed.imagePrompt, null);
    assert.deepEqual(parsed.targets, ['apple', 'pwa']);
    assert.equal(parsed.sourceContract.preferred, 'png');
    assert.deepEqual(parsed.sourceContract.accepted, ['png', 'svg']);
    assert.deepEqual(parsed.technicalConstraints.map((item) => item.target), ['apple', 'pwa']);
    assert.ok(parsed.technicalConstraints[0].outputs.some((item) => item.size === 1024));
    assert.equal(parsed.workflow.state, 'needs-direction');
    assert.equal(parsed.workflow.nextAction, 'collect-direction');
    assert.equal(parsed.workflow.imageGenerationAllowed, false);
    assert.equal(parsed.workflow.uncertainUserPath.count, 3);
    assert.equal(parsed.workflow.uncertainUserPath.format, 'text-only');
    assert.ok(parsed.workflow.uncertainUserPath.eachMustInclude.includes('what-it-expresses'));
    assert.equal(parsed.workflow.approvalRequired, true);
    assert.equal(parsed.workflow.noFallbackSvgSynthesis, true);
    assert.match(parsed.prompt, /Xcode/);
    assert.match(parsed.prompt, /Image generation is blocked/);
    assert.match(parsed.prompt, /exactly three text-only exploratory directions/);
    assert.doesNotMatch(parsed.prompt, /exactly one SVG code block/);
    assert.deepEqual(fs.readdirSync(cwd), []);
  });

  test('reviews a complete direction before image generation', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(
      process.execPath,
      [bin, cwd, '--brief', '--concept', 'a focused signal', '--mood', 'precise,quiet', '--json'],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.equal(parsed.workflow.state, 'needs-direction-approval');
    assert.equal(parsed.requestType, 'direction-review');
    assert.equal(parsed.imagePrompt, null);
    assert.equal(parsed.workflow.nextAction, 'review-direction');
    assert.equal(parsed.workflow.imageGenerationAllowed, false);
    assert.match(parsed.prompt, /direction is complete enough to review, but it is not approved/);
  });

  test('prints an image-generation brief only for an approved direction', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(
      process.execPath,
      [
        bin, cwd, '--brief', '--target', 'apple,pwa',
        '--concept', 'a focused signal', '--mood', 'precise,quiet',
        '--palette', '#0f172a,#14b8a6', '--approve-direction', '--json',
      ],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.equal(parsed.workflow.state, 'ready-for-image-generation');
    assert.equal(parsed.requestType, 'image-generation');
    assert.equal(parsed.imagePrompt, parsed.prompt);
    assert.equal(parsed.workflow.nextAction, 'generate-image');
    assert.equal(parsed.workflow.imageGenerationAllowed, true);
    assert.match(parsed.prompt, /Approved direction for this candidate/);
    assert.match(parsed.prompt, /a focused signal/);
    assert.match(parsed.prompt, /image-generation model/);
  });

  test('does not render an image-generation prompt through the low-level helper without approval', () => {
    assert.throws(
      () => renderDesignBrief(
        { project: { name: 'Blocked App' } },
        ['generic'],
        { concept: 'a signal', mood: ['quiet'], approved: false },
        { assets: [], documents: [], colors: [], hasEvidence: false },
      ),
      /explicitly approved direction/,
    );
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

  test('keeps partial direction input visible while asking for missing fields', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(
      process.execPath,
      [bin, cwd, '--brief', '--concept', 'a focused signal', '--json'],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.equal(parsed.workflow.state, 'needs-direction');
    assert.deepEqual(parsed.workflow.missingDirection, ['mood']);
    assert.match(parsed.prompt, /Known direction \(unapproved\)/);
    assert.match(parsed.prompt, /Concept: a focused signal/);
  });

  test('reports Expo source constraints before a direction exists', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(process.execPath, [bin, cwd, '--brief', '--target', 'expo', '--json'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.deepEqual(parsed.sourceContract.variants, ['default', 'adaptiveForeground']);
    assert.equal(parsed.workflow.state, 'needs-direction');
    assert.match(parsed.prompt, /Android adaptive-icon foreground/);
    assert.doesNotMatch(parsed.prompt, /two clearly named finished image files/);
  });

  test('uses input config targets for programmatic source requests', () => {
    const cwd = tempDir();
    const result = makeDesignBrief({ project: { name: 'Expo App' }, targets: ['expo'] }, { cwd });
    assert.deepEqual(result.targets, ['expo']);
    assert.equal(result.workflow.nextAction, 'collect-direction');
  });

  test('reviews discovered brand evidence before collecting a new direction', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    fs.writeFileSync(
      path.join(cwd, 'brand', 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#14b8a6"/></svg>',
    );
    const result = makeDesignBrief({ project: { name: 'Branded App' }, targets: ['pwa'] }, { cwd });
    assert.equal(result.workflow.state, 'needs-direction');
    assert.equal(result.workflow.nextAction, 'review-brand-evidence');
    assert.deepEqual(result.brandContext.assets, [{ relativePath: path.join('brand', 'logo.svg'), kind: 'logo' }]);
    assert.match(result.prompt, /Asset \(logo\): brand\/logo\.svg/);
  });

  test('skips image generation when config already names an approved source', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    fs.writeFileSync(
      path.join(cwd, 'brand', 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>',
    );
    const result = makeDesignBrief(
      { project: { name: 'Ready App' }, mark: { source: './brand/icon.svg' }, targets: ['pwa'] },
      { cwd },
    );
    assert.equal(result.workflow.state, 'ready-to-compile');
    assert.equal(result.requestType, 'compile');
    assert.equal(result.imagePrompt, null);
    assert.equal(result.workflow.nextAction, 'compile-preview');
    assert.deepEqual(result.source, {
      path: path.join('brand', 'icon.svg'),
      type: 'svg',
      width: undefined,
      height: undefined,
    });
    assert.match(result.prompt, /Image generation is not needed/);
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
    assert.equal(parsed.sourceMode, 'source');
    assert.equal(parsed.produced.every((item) => fs.existsSync(item.path)), true);
  });

  test('requires a source by default and keeps placeholder generation explicit', () => {
    const cwd = tempDir();
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const missing = spawnSync(process.execPath, [bin, cwd, '--target', 'generic', '--json'], { encoding: 'utf8' });
    assert.equal(missing.status, 2);
    assert.match(JSON.parse(missing.stdout).error, /no approved icon source found/);

    const placeholder = spawnSync(
      process.execPath,
      [bin, cwd, '--placeholder', '--target', 'generic', '--out-dir', 'out', '--json'],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(placeholder.stdout);
    assert.equal(placeholder.status, 0);
    assert.equal(parsed.sourceMode, 'placeholder');
    assert.ok(parsed.warnings.some((warning) => warning.code === 'placeholder-source'));
  });

  test('prints JSON usage errors with exit code 2', () => {
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(process.execPath, [bin, '--unknown', '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { ok: false, error: 'Unknown option: --unknown', code: 2 });
  });

  test('--help --json preserves the one-object stdout contract', () => {
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const result = spawnSync(process.execPath, [bin, '--help', '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim().split('\n').length, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.kind, 'help');
    assert.match(parsed.usage, /--approve-direction/);
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
    const result = spawnSync(process.execPath, [bin, '--placeholder', '--dry-run', '--json'], { cwd, encoding: 'utf8' });
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
    const result = spawnSync(process.execPath, [bin, '--placeholder', '--dry-run', '--json'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim().split('\n').length, 1);
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.match(result.stderr, /ASYNC_CONFIG_NOISE/);
  });
});
