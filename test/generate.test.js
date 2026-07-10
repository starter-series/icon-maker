const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { encodePng, PNG_SIGNATURE } = require('../src/png');
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
  // The top-left pixel has no left/up predictor, so its alpha byte is raw[4]
  // for every standard PNG filter type.
  return raw[4];
}

function pngDimensions(png) {
  assert.deepEqual(png.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function pngColorType(png) {
  assert.deepEqual(png.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
  return png[25];
}

const config = {
  project: { name: 'Example App' },
  placeholder: true,
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
    assert.equal(result.sourceMode, 'placeholder');
    assert.ok(result.warnings.some((warning) => warning.code === 'placeholder-source'));
    assert.equal(result.produced.length, 2);

    const png = path.join(cwd, 'assets', 'icon.png');
    const svg = path.join(cwd, 'assets', 'icon.svg');
    assert.equal(fs.existsSync(png), true);
    assert.equal(fs.existsSync(svg), true);
    assert.deepEqual(fs.readFileSync(png).subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
    assert.ok(fs.readFileSync(svg, 'utf8').includes('<title>Example App</title>'));
  });

  test('requires an approved source unless placeholder mode is explicit', () => {
    const cwd = tempDir();
    assert.throws(
      () => makeIcons({ ...config, placeholder: false }, { cwd, targets: ['generic'], write: false }),
      { exitCode: 2, message: /no approved icon source found/ },
    );
  });

  test('rejects an explicit placeholder flag when config already provides a source', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    fs.writeFileSync(
      path.join(cwd, 'brand', 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>',
    );
    assert.throws(
      () => makeIcons(
        { ...config, mark: { source: './brand/icon.svg' } },
        { cwd, targets: ['generic'], placeholder: true, write: false },
      ),
      { exitCode: 2, message: /placeholder cannot be used/ },
    );
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

  test('warns when --patch has no matching manifest', () => {
    const cwd = tempDir();
    const result = makeIcons(config, { cwd, targets: ['browser-extension'], patch: true });
    assert.ok(result.warnings.some((warning) => warning.code === 'patch-target-missing'));
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
    assert.equal(result.sourceMode, 'source');
    const svg = fs.readFileSync(path.join(cwd, 'assets', 'icon.svg'), 'utf8');
    assert.ok(svg.includes('<circle cx="32"'));
    assert.deepEqual(fs.readFileSync(path.join(cwd, 'assets', 'icon.png')).subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
    assert.equal(result.produced.length, 2);
  });

  test('compiles a direct PNG source and reports scaling risks', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    const rgba = Buffer.alloc(64 * 32 * 4, 255);
    fs.writeFileSync(path.join(cwd, 'brand', 'icon.png'), encodePng(64, 32, rgba));

    const result = makeIcons(config, {
      cwd,
      source: './brand/icon.png',
      targets: ['generic'],
    });

    assert.deepEqual(result.source, {
      path: fs.realpathSync(path.join(cwd, 'brand', 'icon.png')),
      type: 'png',
      role: 'default',
      width: 64,
      height: 32,
    });
    assert.equal(result.sourceMode, 'source');
    assert.deepEqual(pngDimensions(fs.readFileSync(path.join(cwd, 'assets', 'icon.png'))), {
      width: 1024,
      height: 1024,
    });
    assert.match(fs.readFileSync(path.join(cwd, 'assets', 'icon.svg'), 'utf8'), /data:image\/png;base64/);
    assert.deepEqual(result.warnings.map((warning) => warning.code), ['non-square-source', 'source-upscaled']);
  });

  test('writes an Xcode-valid Apple app icon asset catalog into the detected catalog', () => {
    const cwd = tempDir();
    const catalog = path.join(cwd, 'Demo', 'Assets.xcassets');
    fs.mkdirSync(catalog, { recursive: true });

    const result = makeIcons(config, { cwd, targets: ['apple'] });
    const appIcon = path.join(catalog, 'AppIcon.appiconset');
    const contents = JSON.parse(fs.readFileSync(path.join(appIcon, 'Contents.json'), 'utf8'));

    assert.equal(result.produced.length, 12);
    assert.equal(result.produced.every((item) => item.path.startsWith(appIcon)), true);
    assert.equal(result.warnings.some((warning) => warning.code === 'apple-catalog-created'), false);
    assert.deepEqual(contents.info, { author: 'xcode', version: 1 });
    assert.equal(contents.images.length, 11);
    assert.ok(contents.images.some((image) => image.platform === 'ios' && image.size === '1024x1024'));
    assert.ok(contents.images.some((image) => image.idiom === 'mac' && image.size === '512x512' && image.scale === '2x'));
    const iosIcon = fs.readFileSync(path.join(appIcon, 'AppIcon-ios-1024.png'));
    assert.deepEqual(pngDimensions(iosIcon), { width: 1024, height: 1024 });
    assert.equal(pngColorType(iosIcon), 2);

    const second = makeIcons(config, { cwd, targets: ['apple'] });
    assert.equal(second.produced.every((item) => item.written === false), true);
  });

  test('writes into the App Icon set selected by the Xcode project', () => {
    const cwd = tempDir();
    const project = path.join(cwd, 'Demo.xcodeproj');
    const catalog = path.join(cwd, 'Demo', 'Assets.xcassets');
    fs.mkdirSync(project);
    fs.mkdirSync(catalog, { recursive: true });
    fs.writeFileSync(
      path.join(project, 'project.pbxproj'),
      'ASSETCATALOG_COMPILER_APPICON_NAME = BrandIcon;\n',
    );
    const result = makeIcons(config, { cwd, targets: ['apple'] });
    assert.equal(result.produced.every((item) => item.path.includes('BrandIcon.appiconset')), true);
    assert.equal(fs.existsSync(path.join(catalog, 'BrandIcon.appiconset', 'Contents.json')), true);
  });

  test('composites transparent external artwork onto an opaque Apple background', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    fs.writeFileSync(
      path.join(cwd, 'brand', 'symbol.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="16" fill="#fff"/></svg>',
    );

    makeIcons(
      { ...config, mark: { ...config.mark, source: './brand/symbol.svg', background: '#123456' } },
      { cwd, targets: ['apple'] },
    );
    const icon = fs.readFileSync(path.join(cwd, 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-ios-1024.png'));
    assert.equal(pngColorType(icon), 2);
  });

  test('flattens a translucent Apple background and emits an opacity warning', () => {
    const cwd = tempDir();
    const result = makeIcons(
      { ...config, mark: { ...config.mark, background: '#12345680' } },
      { cwd, targets: ['apple'] },
    );
    const icon = fs.readFileSync(path.join(cwd, 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-ios-1024.png'));
    assert.equal(pngColorType(icon), 2);
    assert.ok(result.warnings.some((warning) => warning.code === 'apple-background-defaulted'));
  });

  test('requires an explicit Apple catalog when a project has multiple candidates', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'One', 'Assets.xcassets'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'Two', 'Assets.xcassets'), { recursive: true });

    assert.throws(
      () => makeIcons(config, { cwd, targets: ['apple'], write: false }),
      /multiple Xcode asset catalogs/,
    );

    const result = makeIcons(
      { ...config, apple: { assetCatalog: './One/Assets.xcassets' } },
      { cwd, targets: ['apple'], write: false },
    );
    assert.equal(result.produced.every((item) => item.path.includes(path.join('One', 'Assets.xcassets'))), true);
  });

  test('uses a separate transparent source for the Expo adaptive foreground', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    fs.writeFileSync(
      path.join(cwd, 'brand', 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#123456"/></svg>',
    );
    fs.writeFileSync(
      path.join(cwd, 'brand', 'adaptive.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="16" fill="#fff"/></svg>',
    );
    const result = makeIcons(
      {
        ...config,
        mark: {
          ...config.mark,
          source: { default: './brand/icon.svg', adaptiveForeground: './brand/adaptive.svg' },
        },
      },
      { cwd, targets: ['expo'] },
    );
    const adaptive = fs.readFileSync(path.join(cwd, 'assets', 'adaptive-icon.png'));
    assert.equal(decodeFirstPixelAlpha(adaptive), 0);
    assert.equal(result.sourceVariants.adaptiveForeground.role, 'adaptive-foreground');
    assert.equal(result.warnings.some((warning) => warning.code === 'adaptive-source-missing'), false);
  });

  test('warns when an external Expo source has no adaptive foreground variant', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    fs.writeFileSync(
      path.join(cwd, 'brand', 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#123456"/></svg>',
    );
    const result = makeIcons(
      { ...config, mark: { ...config.mark, source: './brand/icon.svg' } },
      { cwd, targets: ['expo'] },
    );
    assert.ok(result.warnings.some((warning) => warning.code === 'adaptive-source-missing'));
  });

  test('keeps source-derived target output stable when unrelated targets are added', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    fs.writeFileSync(
      path.join(cwd, 'brand', 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#22c55e"/></svg>',
    );
    const sourceConfig = { ...config, mark: { ...config.mark, source: './brand/icon.svg' } };
    makeIcons(sourceConfig, { cwd, targets: ['pwa'] });
    const first = crypto.createHash('sha256').update(fs.readFileSync(path.join(cwd, 'public', 'icon-512.png'))).digest('hex');
    makeIcons(sourceConfig, { cwd, targets: ['pwa', 'generic'] });
    const second = crypto.createHash('sha256').update(fs.readFileSync(path.join(cwd, 'public', 'icon-512.png'))).digest('hex');
    assert.equal(second, first);
  });

  test('refuses to overwrite a direct source with a generated output', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'assets'));
    fs.writeFileSync(path.join(cwd, 'assets', 'icon.png'), encodePng(2, 2, Buffer.alloc(16, 255)));
    assert.throws(
      () => makeIcons(config, { cwd, source: './assets/icon.png', targets: ['generic'], write: false }),
      /refusing to overwrite source file/,
    );
  });

  test('refuses to overwrite a source with the preview output', () => {
    const cwd = tempDir();
    const sourcePath = path.join(cwd, 'icon-preview.html');
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>';
    fs.writeFileSync(sourcePath, source);
    assert.throws(
      () => makeIcons(config, { cwd, source: './icon-preview.html', targets: ['generic'], preview: true }),
      /refusing to overwrite source file with preview output/,
    );
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), source);
  });

  test('rejects conflicting multi-target output paths before writing', () => {
    const cwd = tempDir();
    assert.throws(
      () => makeIcons(config, { cwd, targets: ['electron', 'vscode'] }),
      /produce different files.*use --out-dir/,
    );
    assert.equal(fs.existsSync(path.join(cwd, 'assets')), false);
  });

  test('rejects generated output paths that escape through a symlink', { skip: process.platform === 'win32' }, () => {
    const cwd = tempDir();
    const outside = tempDir();
    fs.symlinkSync(outside, path.join(cwd, 'assets'), 'dir');
    assert.throws(
      () => makeIcons(config, { cwd, targets: ['generic'], write: false }),
      /output path resolves outside the target directory/,
    );
  });

  test('uses input config targets to select programmatic API presets', () => {
    const cwd = tempDir();
    makeIcons({ project: { name: 'Expo Preset' }, placeholder: true, targets: ['expo'] }, { cwd });
    assert.match(fs.readFileSync(path.join(cwd, 'assets', 'icon.svg'), 'utf8'), /fill="#4630eb"/);
  });

  test('rejects an Apple asset catalog that resolves outside the target directory', () => {
    const cwd = tempDir();
    const outside = tempDir();
    const assetCatalog = path.join(outside, 'Assets.xcassets');
    fs.mkdirSync(assetCatalog);
    const relative = path.relative(cwd, assetCatalog);

    assert.throws(
      () => makeIcons({ ...config, apple: { assetCatalog: relative } }, { cwd, targets: ['apple'], write: false }),
      /apple\.assetCatalog must stay inside the target directory/,
    );
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
