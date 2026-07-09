const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { PNG_SIGNATURE } = require('../src/png');
const { makeIcons } = require('../src');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-generate-'));
}

function decodeFirstPixelAlpha(png) {
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') width = data.readUInt32BE(0);
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.ok(width > 0);
  assert.equal(raw[0], 0);
  return raw[4];
}

function pngDimensions(png) {
  assert.deepEqual(png.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const config = {
  project: { name: 'Example App' },
  mark: {
    glyph: 'braces',
    shape: 'squircle',
    background: '#101827',
    foreground: '#ffffff',
    accent: '#22d3ee',
  },
  targets: ['generic'],
};

describe('makeIcons', () => {
  test('writes generic svg and png files', () => {
    const cwd = tempDir();
    const result = makeIcons(config, { cwd, targets: ['generic'] });
    assert.equal(result.ok, true);
    assert.equal(result.produced.length, 2);

    const png = path.join(cwd, 'assets', 'icon.png');
    const svg = path.join(cwd, 'assets', 'icon.svg');
    assert.equal(fs.existsSync(png), true);
    assert.equal(fs.existsSync(svg), true);
    assert.deepEqual(fs.readFileSync(png).subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
    assert.ok(fs.readFileSync(svg, 'utf8').includes('<title>Example App</title>'));
  });

  test('supports dry-run without writing', () => {
    const cwd = tempDir();
    const result = makeIcons(config, { cwd, targets: ['generic'], write: false });
    assert.equal(result.produced.length, 2);
    assert.equal(fs.existsSync(path.join(cwd, 'assets', 'icon.png')), false);
  });

  test('patches browser extension manifest icons', () => {
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Demo' }, null, 2));
    const result = makeIcons(config, { cwd, targets: ['browser-extension'], patch: true });
    assert.equal(result.patches.length, 1);
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.icons, {
      16: 'assets/icons/icon16.png',
      32: 'assets/icons/icon32.png',
      48: 'assets/icons/icon48.png',
      128: 'assets/icons/icon128.png',
    });
  });

  test('preserves JSON indent and skips already-applied patches', () => {
    const cwd = tempDir();
    const manifestPath = path.join(cwd, 'manifest.json');
    fs.writeFileSync(manifestPath, '{\n    "manifest_version": 3,\n    "name": "Demo"\n}\n');
    const first = makeIcons(config, { cwd, targets: ['browser-extension'], patch: true });
    assert.equal(first.patches.length, 1);
    const patched = fs.readFileSync(manifestPath, 'utf8');
    assert.ok(patched.includes('\n    "icons": {'));
    const second = makeIcons(config, { cwd, targets: ['browser-extension'], patch: true });
    assert.equal(second.patches.length, 0);
  });

  test('patches Expo app icon fields without rewriting unchanged JSON', () => {
    const cwd = tempDir();
    const appJsonPath = path.join(cwd, 'app.json');
    fs.writeFileSync(appJsonPath, JSON.stringify({ expo: { name: 'Demo' } }, null, 2));

    const first = makeIcons(config, { cwd, targets: ['expo'], patch: true });
    assert.equal(first.patches.length, 1);
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    assert.equal(appJson.expo.icon, './assets/icon.png');
    assert.equal(appJson.expo.android.adaptiveIcon.foregroundImage, './assets/adaptive-icon.png');

    const patched = fs.readFileSync(appJsonPath, 'utf8');
    const second = makeIcons(config, { cwd, targets: ['expo'], patch: true });
    assert.equal(second.patches.length, 0);
    assert.equal(fs.readFileSync(appJsonPath, 'utf8'), patched);
  });

  test('patches package icon fields for app and editor package targets', () => {
    const cwd = tempDir();
    const pkgPath = path.join(cwd, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2));

    const electron = makeIcons(config, { cwd, targets: ['electron'], patch: true });
    assert.equal(electron.patches.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).icon, 'assets/icon.png');

    const unchanged = makeIcons(config, { cwd, targets: ['electron'], patch: true });
    assert.equal(unchanged.patches.length, 0);

    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2));
    const vscode = makeIcons(config, { cwd, targets: ['vscode'], patch: true });
    assert.equal(vscode.patches.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).icon, 'assets/icon.png');
  });

  test('patches PWA manifest icon entries and skips no-op rewrites', () => {
    const cwd = tempDir();
    const publicDir = path.join(cwd, 'public');
    fs.mkdirSync(publicDir);
    const manifestPath = path.join(publicDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ name: 'Demo' }, null, 2));

    const first = makeIcons(config, { cwd, targets: ['pwa'], patch: true });
    assert.equal(first.patches.length, 1);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.icons, [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ]);

    const patched = fs.readFileSync(manifestPath, 'utf8');
    const second = makeIcons(config, { cwd, targets: ['pwa'], patch: true });
    assert.equal(second.patches.length, 0);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), patched);
  });

  test('writes Expo adaptive icon with transparent background', () => {
    const cwd = tempDir();
    makeIcons(config, { cwd, targets: ['expo'] });
    const adaptive = fs.readFileSync(path.join(cwd, 'assets', 'adaptive-icon.png'));
    assert.deepEqual(adaptive.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
    assert.equal(decodeFirstPixelAlpha(adaptive), 0);
  });

  test('writes electron ico and icns containers', () => {
    const cwd = tempDir();
    const result = makeIcons(config, { cwd, targets: ['electron'] });
    const ico = fs.readFileSync(path.join(cwd, 'assets', 'icon.ico'));
    const icns = fs.readFileSync(path.join(cwd, 'assets', 'icon.icns'));
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 4);
    assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
    assert.ok(result.produced.some((item) => item.format === 'ico'));
    assert.ok(result.produced.some((item) => item.format === 'icns'));
  });

  test('writes preview contact sheet', () => {
    const cwd = tempDir();
    const result = makeIcons(config, { cwd, targets: ['generic'], preview: true });
    assert.equal(fs.existsSync(path.join(cwd, 'icon-preview.html')), true);
    assert.ok(fs.readFileSync(result.preview.path, 'utf8').includes('Example App icon preview'));
  });

  test('compiles custom SVG source into PNG outputs', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    fs.writeFileSync(path.join(cwd, 'brand', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#000"/><circle cx="32" cy="32" r="16" fill="#fff"/></svg>');
    const result = makeIcons({ ...config, mark: { source: './brand/logo.svg' } }, { cwd, targets: ['generic'] });
    const svg = fs.readFileSync(path.join(cwd, 'assets', 'icon.svg'), 'utf8');
    assert.ok(svg.includes('<circle cx="32"'));
    assert.deepEqual(fs.readFileSync(path.join(cwd, 'assets', 'icon.png')).subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
    assert.equal(result.produced.length, 2);
  });

  test('renders non-square custom SVG source into square PNG outputs', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    fs.writeFileSync(path.join(cwd, 'brand', 'wide.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#000"/></svg>');
    makeIcons({ ...config, mark: { source: './brand/wide.svg' } }, { cwd, targets: ['generic'] });
    const png = fs.readFileSync(path.join(cwd, 'assets', 'icon.png'));
    assert.deepEqual(pngDimensions(png), { width: 1024, height: 1024 });
  });

  test('rejects custom SVG sources outside the target directory', () => {
    const cwd = tempDir();
    const outside = tempDir();
    fs.writeFileSync(path.join(outside, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"></svg>');
    const source = path.relative(cwd, path.join(outside, 'logo.svg'));
    assert.throws(
      () => makeIcons({ ...config, mark: { source } }, { cwd, targets: ['generic'] }),
      /mark\.source must stay inside the target directory/,
    );
  });

  test('groups target outputs under outDir when requested', () => {
    const cwd = tempDir();
    makeIcons(config, { cwd, targets: ['generic'], outDir: 'out' });
    assert.equal(fs.existsSync(path.join(cwd, 'out', 'generic', 'assets', 'icon.png')), true);
  });
});
