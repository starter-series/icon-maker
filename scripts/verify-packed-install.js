const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-pack-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
    },
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`);
  }

  return result;
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`${label} did not print valid JSON: ${err.message}\n${stdout}`, { cause: err });
  }
}

try {
  const packResult = run('npm', ['pack', '--json', '--pack-destination', tmp]);
  const [pack] = parseJson(packResult.stdout, 'npm pack');
  assert.ok(pack && pack.filename, 'npm pack returned no filename');

  const tarball = path.join(tmp, pack.filename);
  assert.ok(fs.existsSync(tarball), `tarball missing: ${tarball}`);

  const consumer = path.join(tmp, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'icon-maker-pack-smoke', version: '0.0.0', private: true }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(consumer, 'icon-maker.config.js'),
    `module.exports = {
  project: { name: 'Pack Smoke', slug: 'pack-smoke' },
  mark: {
    glyph: 'spark',
    shape: 'squircle',
    background: '#111827',
    foreground: '#f8fafc',
    accent: '#22c55e'
  },
  targets: ['generic']
};
`,
  );

  run('npm', ['install', '--ignore-scripts', tarball], { cwd: consumer });

  const cliResult = run(
    'npx',
    ['--yes', 'icon-maker', '--target', 'generic', '--out-dir', 'out', '--json'],
    { cwd: consumer },
  );
  const cliJson = parseJson(cliResult.stdout, 'icon-maker CLI');
  assert.equal(cliJson.ok, true);
  assert.deepEqual(cliJson.targets, ['generic']);
  assert.ok(cliJson.produced.length >= 2, 'CLI produced no icon files');
  const realConsumerOut = fs.realpathSync(path.join(consumer, 'out'));
  for (const item of cliJson.produced) {
    assert.ok(fs.existsSync(item.path), `missing generated file: ${item.path}`);
    const realItemPath = fs.realpathSync(item.path);
    const relative = path.relative(realConsumerOut, realItemPath);
    assert.ok(
      relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      `unexpected output path: ${item.path}`,
    );
  }

  const apiScript = `
const fs = require('node:fs');
const path = require('node:path');
const { makeIcons } = require('iconkit');
const cwd = path.resolve('api-consumer');
fs.mkdirSync(cwd, { recursive: true });
const result = makeIcons({
  project: { name: 'API Smoke', slug: 'api-smoke' },
  mark: {
    glyph: 'bolt',
    shape: 'circle',
    background: '#172554',
    foreground: '#f8fafc',
    accent: '#f97316'
  },
  targets: ['generic']
}, { cwd, outDir: 'icons' });
console.log(JSON.stringify({
  ok: result.ok,
  count: result.produced.length,
  exists: result.produced.every((item) => fs.existsSync(item.path))
}));
`;
  const apiResult = run('node', ['-e', apiScript], { cwd: consumer });
  const apiJson = parseJson(apiResult.stdout, 'makeIcons API');
  assert.deepEqual(apiJson, { ok: true, count: 2, exists: true });

  console.log(`packed install smoke ok (${pack.filename})`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
