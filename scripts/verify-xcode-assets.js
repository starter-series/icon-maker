const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeIcons } = require('../src');

if (process.platform !== 'darwin') {
  console.log('xcode asset smoke skipped (requires macOS)');
  process.exit(0);
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'iconkit-xcode-smoke-'));

function runActool(platform, minimumTarget, extraArgs = []) {
  const output = path.join(cwd, `compiled-${platform}`);
  fs.mkdirSync(output);
  const result = spawnSync('xcrun', [
    'actool',
    path.join(cwd, 'Assets.xcassets'),
    '--compile', output,
    '--platform', platform,
    '--minimum-deployment-target', minimumTarget,
    ...extraArgs,
    '--app-icon', 'AppIcon',
    '--output-partial-info-plist', path.join(cwd, `${platform}.plist`),
    '--warnings',
    '--errors',
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`actool ${platform} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

try {
  const result = makeIcons({
    project: { name: 'Xcode Smoke' },
    mark: {
      glyph: 'spark',
      shape: 'square',
      background: '#123456',
      foreground: '#ffffff',
      accent: '#38bdf8',
    },
    targets: ['apple'],
  }, { cwd });
  const iosIcon = result.produced.find((item) => item.path.endsWith('AppIcon-ios-1024.png'));
  assert.ok(iosIcon && fs.existsSync(iosIcon.path));
  assert.equal(fs.readFileSync(iosIcon.path)[25], 2, 'Apple PNG must not contain an alpha channel');

  runActool('iphoneos', '15.0', ['--target-device', 'iphone', '--target-device', 'ipad']);
  runActool('macosx', '13.0');
  console.log('xcode asset smoke ok (iphoneos + macosx)');
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
