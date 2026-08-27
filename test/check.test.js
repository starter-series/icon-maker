const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkIcons, makeIcons } = require('../src');
const { crc32, encodePng, PNG_SIGNATURE } = require('../src/png');

const placeholderConfig = {
  project: { name: 'Check Fixture' },
  placeholder: true,
  mark: {
    glyph: 'spark',
    shape: 'square',
    background: '#123456',
    foreground: '#ffffff',
    accent: '#38bdf8',
  },
  targets: ['generic'],
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-check-'));
}

function diagnosticCodes(result) {
  return result.diagnostics.map((item) => item.code);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32([typeBuffer, data]));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function undecodablePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', Buffer.alloc(0)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function insertPngChunk(png, type, data, before = 'IEND') {
  const insertion = png.indexOf(Buffer.from(before)) - 4;
  return Buffer.concat([png.subarray(0, insertion), pngChunk(type, data), png.subarray(insertion)]);
}

describe('checkIcons', () => {
  test('validates existing outputs without writing them', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['generic'] });
    const png = path.join(cwd, 'assets', 'icon.png');
    const svg = path.join(cwd, 'assets', 'icon.svg');
    const before = [png, svg].map((file) => ({
      file,
      contents: fs.readFileSync(file),
      mtimeMs: fs.statSync(file).mtimeMs,
    }));

    const result = checkIcons(placeholderConfig, { cwd, targets: ['generic'] });

    assert.equal(result.schemaVersion, 1);
    assert.equal(result.kind, 'check');
    assert.equal(result.ok, true);
    assert.deepEqual(result.summary, { artifacts: 2, errors: 0, warnings: 0 });
    assert.equal(result.checked.length, 2);
    for (const item of before) {
      assert.deepEqual(fs.readFileSync(item.file), item.contents);
      assert.equal(fs.statSync(item.file).mtimeMs, item.mtimeMs);
    }
  });

  test('reports missing files, wrong PNG dimensions, and a non-SVG root', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['generic'] });
    fs.writeFileSync(path.join(cwd, 'assets', 'icon.png'), encodePng(2, 2, Buffer.alloc(16, 255)));
    fs.writeFileSync(path.join(cwd, 'assets', 'icon.svg'), '<html></html>');

    const invalid = checkIcons(placeholderConfig, { cwd, targets: ['generic'] });
    assert.equal(invalid.ok, false);
    assert.ok(diagnosticCodes(invalid).includes('png-dimensions'));
    assert.ok(diagnosticCodes(invalid).includes('svg-root'));

    fs.rmSync(path.join(cwd, 'assets', 'icon.png'));
    const missing = checkIcons(placeholderConfig, { cwd, targets: ['generic'] });
    assert.ok(diagnosticCodes(missing).includes('artifact-missing'));
  });

  test('rejects a PNG whose chunk payload no longer matches its CRC', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['generic'] });
    const file = path.join(cwd, 'assets', 'icon.png');
    const png = fs.readFileSync(file);
    const idat = png.indexOf(Buffer.from('IDAT'));
    assert.ok(idat > 0);
    png[idat + 8] ^= 0xff;
    fs.writeFileSync(file, png);

    const result = checkIcons(placeholderConfig, { cwd, targets: ['generic'] });
    assert.ok(diagnosticCodes(result).includes('png-invalid'));
  });

  test('rejects malformed SVG documents even when they start with an SVG root', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['generic'] });
    fs.writeFileSync(path.join(cwd, 'assets', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>');
    const result = checkIcons(placeholderConfig, { cwd, targets: ['generic'], strict: true });
    assert.equal(result.ok, false);
    assert.ok(diagnosticCodes(result).includes('svg-invalid'));
  });

  test('rejects non-object JSON roots instead of skipping wiring or throwing a TypeError', () => {
    for (const target of ['browser-extension', 'expo', 'electron', 'vscode', 'apple']) {
      const cwd = tempDir();
      makeIcons(placeholderConfig, { cwd, targets: [target] });
      const file = target === 'apple' ? 'Assets.xcassets/AppIcon.appiconset/Contents.json'
        : target === 'browser-extension' ? 'manifest.json'
          : target === 'expo' ? 'app.json' : 'package.json';
      for (const value of ['null', 'false', '0', '[]']) {
        fs.writeFileSync(path.join(cwd, file), value);
        const result = checkIcons(placeholderConfig, { cwd, targets: [target], strict: true });
        assert.equal(result.ok, false, `${target}: ${value}`);
        assert.ok(result.summary.errors > 0, `${target}: ${value}`);
      }
    }
  });

  test('rejects CRC-valid PNG data whose IDAT cannot decode into image scanlines', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['generic'] });
    fs.writeFileSync(path.join(cwd, 'assets', 'icon.png'), undecodablePng(1024));

    const result = checkIcons(placeholderConfig, { cwd, targets: ['generic'] });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => (
      item.code === 'png-invalid' && item.message.includes('IDAT decode')
    )));
  });

  test('rejects unsupported critical PNG chunks even when their CRC is valid', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['generic'] });
    const file = path.join(cwd, 'assets', 'icon.png');
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, insertPngChunk(original, 'ABCD', Buffer.from('unknown')));

    const result = checkIcons(placeholderConfig, { cwd, targets: ['generic'] });
    assert.ok(result.diagnostics.some((item) => (
      item.code === 'png-invalid' && item.message.includes('unknown critical chunk')
    )));

    fs.writeFileSync(file, insertPngChunk(original, 'PLTE', Buffer.alloc(0), 'IDAT'));
    const palette = checkIcons(placeholderConfig, { cwd, targets: ['generic'] });
    assert.ok(palette.diagnostics.some((item) => (
      item.code === 'png-invalid' && item.message.includes('PLTE length')
    )));
  });

  test('requires actual transparent pixels in adaptive foreground PNGs', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['expo'] });
    fs.writeFileSync(
      path.join(cwd, 'assets', 'adaptive-icon.png'),
      encodePng(1024, 1024, Buffer.alloc(1024 * 1024 * 4, 255)),
    );

    const result = checkIcons(placeholderConfig, { cwd, targets: ['expo'] });
    assert.ok(diagnosticCodes(result).includes('png-transparency-required'));

    fs.writeFileSync(path.join(cwd, 'assets', 'adaptive-icon.png'),
      encodePng(1024, 1024, Buffer.alloc(1024 * 1024 * 4)));
    const empty = checkIcons(placeholderConfig, { cwd, targets: ['expo'] });
    assert.ok(diagnosticCodes(empty).includes('png-foreground-empty'));
  });

  test('validates ICO and ICNS headers and size tables', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['electron'] });
    fs.writeFileSync(path.join(cwd, 'assets', 'icon.ico'), Buffer.from('not an ico'));
    fs.writeFileSync(path.join(cwd, 'assets', 'icon.icns'), Buffer.from('not an icns'));

    const result = checkIcons(placeholderConfig, { cwd, targets: ['electron'] });
    assert.ok(diagnosticCodes(result).includes('ico-invalid'));
    assert.ok(diagnosticCodes(result).includes('icns-invalid'));
  });

  test('requires RGB Apple PNGs and parseable JSON metadata', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['apple'] });
    const appIconSet = path.join(cwd, 'Assets.xcassets', 'AppIcon.appiconset');
    fs.writeFileSync(
      path.join(appIconSet, 'AppIcon-ios-1024.png'),
      encodePng(1024, 1024, Buffer.alloc(1024 * 1024 * 4, 255)),
    );
    fs.writeFileSync(path.join(appIconSet, 'Contents.json'), '{broken');

    const result = checkIcons(placeholderConfig, { cwd, targets: ['apple'] });
    assert.ok(diagnosticCodes(result).includes('apple-png-color-type'));
    assert.ok(diagnosticCodes(result).includes('json-invalid'));
  });

  test('requires Apple Contents.json to reference the exact generated files', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['apple'] });
    const appIconSet = path.join(cwd, 'Assets.xcassets', 'AppIcon.appiconset');
    const contentsPath = path.join(appIconSet, 'Contents.json');
    const contents = JSON.parse(fs.readFileSync(contentsPath, 'utf8'));
    const unreferenced = contents.images[0].filename;
    const missing = contents.images[1].filename;
    delete contents.images[0].filename;
    contents.images.push({ filename: 'unexpected.png', idiom: 'universal', size: '1x1' });
    fs.writeFileSync(contentsPath, `${JSON.stringify(contents, null, 2)}\n`);
    fs.rmSync(path.join(appIconSet, missing));
    fs.writeFileSync(path.join(appIconSet, 'unexpected.png'), 'unexpected');

    const result = checkIcons(placeholderConfig, { cwd, targets: ['apple'] });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => (
      item.code === 'apple-contents-reference-mismatch' && item.message.includes(unreferenced)
    )));
    assert.ok(result.diagnostics.some((item) => (
      item.code === 'apple-contents-file-missing' && item.message.includes(missing)
    )));
    assert.ok(diagnosticCodes(result).includes('apple-contents-reference-unexpected'));
  });

  test('validates Apple slot metadata, not just the set of PNG filenames', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['apple'] });
    const file = path.join(cwd, 'Assets.xcassets', 'AppIcon.appiconset', 'Contents.json');
    const original = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const mutation of [
      (contents) => { contents.images[1].size = '128x128'; },
      (contents) => { contents.images[1].scale = '2x'; },
      (contents) => { contents.images[0].platform = 'watchos'; },
      (contents) => { contents.images[0].appearances = [{ appearance: 'luminosity', value: 'dark' }]; },
    ]) {
      const contents = structuredClone(original);
      mutation(contents);
      fs.writeFileSync(file, JSON.stringify(contents));
      const result = checkIcons(placeholderConfig, { cwd, targets: ['apple'] });
      assert.equal(result.ok, false);
      assert.ok(diagnosticCodes(result).includes('apple-contents-slot-mismatch'));
    }
  });

  test('accepts semantically current PWA wiring without forcing JSON reformatting', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'public'));
    const file = path.join(cwd, 'public', 'manifest.json');
    fs.writeFileSync(file, '{}');
    makeIcons(placeholderConfig, { cwd, targets: ['pwa'], patch: true });
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const minified = JSON.stringify(json);
    fs.writeFileSync(file, minified);
    const result = checkIcons(placeholderConfig, { cwd, targets: ['pwa'], strict: true });
    assert.equal(result.ok, true);
    const repeated = makeIcons(placeholderConfig, { cwd, targets: ['pwa'], patch: true });
    assert.deepEqual(repeated.patches, []);
    assert.equal(fs.readFileSync(file, 'utf8'), minified);
  });

  test('keeps generated-only checks non-fatal when wiring files are absent', () => {
    for (const target of ['browser-extension', 'expo', 'pwa', 'vscode']) {
      const cwd = tempDir();
      makeIcons(placeholderConfig, { cwd, targets: [target] });
      const result = checkIcons(placeholderConfig, { cwd, targets: [target] });
      assert.equal(result.ok, true, target);
      const missingCode = target === 'pwa' ? 'pwa-manifest-missing' : `${target}-wiring-missing`;
      assert.ok(diagnosticCodes(result).includes(missingCode), target);
    }

    const electronCwd = tempDir();
    makeIcons(placeholderConfig, { cwd: electronCwd, targets: ['electron'] });
    const electron = checkIcons(placeholderConfig, { cwd: electronCwd, targets: ['electron'] });
    assert.equal(electron.ok, true);
    assert.ok(diagnosticCodes(electron).includes('electron-wiring-missing'));
  });

  test('validates browser extension, Expo, PWA, and VS Code wiring paths', () => {
    const fixtures = [
      {
        target: 'browser-extension',
        file: 'manifest.json',
        valid: {
          manifest_version: 3,
          icons: {
            16: 'assets/icons/icon16.png',
            32: 'assets/icons/icon32.png',
            48: 'assets/icons/icon48.png',
            128: 'assets/icons/icon128.png',
          },
        },
        breakWiring(json) { json.icons['16'] = 'wrong.png'; },
      },
      {
        target: 'expo',
        file: 'app.json',
        valid: {
          expo: {
            icon: './assets/icon.png',
            android: {
              adaptiveIcon: {
                foregroundImage: './assets/adaptive-icon.png',
                backgroundColor: '#123456',
              },
            },
          },
        },
        breakWiring(json) { json.expo.icon = './wrong.png'; },
      },
      {
        target: 'pwa',
        file: 'public/manifest.json',
        valid: {
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
        breakWiring(json) { json.icons[0].src = '/wrong.png'; },
      },
      {
        target: 'vscode',
        file: 'package.json',
        valid: { name: 'check-fixture', icon: 'assets/icon.png' },
        breakWiring(json) { json.icon = 'wrong.png'; },
      },
    ];

    for (const fixture of fixtures) {
      const cwd = tempDir();
      makeIcons(placeholderConfig, { cwd, targets: [fixture.target] });
      const file = path.join(cwd, fixture.file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(fixture.valid, null, 2)}\n`);

      const valid = checkIcons(placeholderConfig, { cwd, targets: [fixture.target] });
      assert.equal(valid.summary.errors, 0, fixture.target);
      assert.equal(valid.summary.warnings, 0, fixture.target);

      const broken = JSON.parse(fs.readFileSync(file, 'utf8'));
      fixture.breakWiring(broken);
      fs.writeFileSync(file, `${JSON.stringify(broken, null, 2)}\n`);
      const invalid = checkIcons(placeholderConfig, { cwd, targets: [fixture.target] });
      assert.equal(invalid.ok, false, fixture.target);
      assert.ok(diagnosticCodes(invalid).includes(`${fixture.target}-wiring-mismatch`), fixture.target);
    }
  });

  test('checks the resolved www webmanifest and its colocated PWA outputs', () => {
    const cwd = tempDir();
    const manifestPath = path.join(cwd, 'www', 'manifest.webmanifest');
    fs.mkdirSync(path.dirname(manifestPath));
    fs.writeFileSync(manifestPath, `${JSON.stringify({ name: 'Demo' }, null, 2)}\n`);
    const pwaConfig = {
      ...placeholderConfig,
      pwa: { manifest: './www/manifest.webmanifest' },
    };
    makeIcons(pwaConfig, { cwd, targets: ['pwa'], patch: true });

    const valid = checkIcons(pwaConfig, { cwd, targets: ['pwa'] });
    assert.equal(valid.ok, true);
    assert.deepEqual(valid.summary, { artifacts: 4, errors: 0, warnings: 0 });
    assert.equal(valid.checked.every((item) => item.path.startsWith(path.join(cwd, 'www'))), true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.icons[0].src = '/wrong.png';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const invalid = checkIcons(pwaConfig, { cwd, targets: ['pwa'] });
    assert.equal(invalid.ok, false);
    assert.ok(diagnosticCodes(invalid).includes('pwa-wiring-mismatch'));
  });

  test('infers one-shot PWA and Expo optional roles from persisted wiring', () => {
    const pwaCwd = tempDir();
    fs.mkdirSync(path.join(pwaCwd, 'brand'));
    fs.mkdirSync(path.join(pwaCwd, 'public'));
    fs.writeFileSync(path.join(pwaCwd, 'public', 'manifest.json'), '{}\n');
    fs.writeFileSync(
      path.join(pwaCwd, 'brand', 'maskable.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24"/></svg>',
    );
    makeIcons(
      { ...placeholderConfig, mark: { ...placeholderConfig.mark, source: { maskable: './brand/maskable.svg' } } },
      { cwd: pwaCwd, targets: ['pwa'], patch: true },
    );
    fs.rmSync(path.join(pwaCwd, 'public', 'icon-maskable-512.png'));
    const pwa = checkIcons(placeholderConfig, { cwd: pwaCwd, targets: ['pwa'], strict: true });
    assert.ok(diagnosticCodes(pwa).includes('artifact-missing'));

    const expoCwd = tempDir();
    fs.mkdirSync(path.join(expoCwd, 'brand'));
    fs.writeFileSync(path.join(expoCwd, 'app.json'), JSON.stringify({ expo: { name: 'Demo' } }));
    fs.writeFileSync(
      path.join(expoCwd, 'brand', 'mono.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24"/></svg>',
    );
    makeIcons(
      { ...placeholderConfig, mark: { ...placeholderConfig.mark, source: { monochrome: './brand/mono.svg' } } },
      { cwd: expoCwd, targets: ['expo'], patch: true },
    );
    fs.rmSync(path.join(expoCwd, 'assets', 'monochrome-icon.png'));
    const expo = checkIcons(placeholderConfig, { cwd: expoCwd, targets: ['expo'], strict: true });
    assert.ok(diagnosticCodes(expo).includes('artifact-missing'));
  });

  test('warns that dynamic Expo config can override an otherwise valid app.json', () => {
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, 'app.config.js'), 'module.exports = ({ config }) => config;\n');
    fs.writeFileSync(path.join(cwd, 'app.json'), JSON.stringify({
      expo: {
        icon: './assets/icon.png',
        android: {
          adaptiveIcon: {
            foregroundImage: './assets/adaptive-icon.png',
            backgroundColor: '#123456',
          },
        },
      },
    }));
    makeIcons(placeholderConfig, { cwd, targets: ['expo'] });

    const normal = checkIcons(placeholderConfig, { cwd, targets: ['expo'] });
    const strict = checkIcons(placeholderConfig, { cwd, targets: ['expo'], strict: true });
    assert.equal(normal.ok, true);
    assert.ok(diagnosticCodes(normal).includes('expo-dynamic-config-unverified'));
    assert.equal(strict.ok, false);
  });

  test('validates native Android output routing, XML resources, and manifest wiring', () => {
    const cwd = tempDir();
    const manifest = path.join(cwd, 'app', 'src', 'main', 'AndroidManifest.xml');
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(
      manifest,
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>\n',
    );
    makeIcons(placeholderConfig, { cwd, targets: ['android'], patch: true });

    const valid = checkIcons(placeholderConfig, { cwd, targets: ['android'] });
    assert.equal(valid.summary.errors, 0);
    assert.ok(valid.checked.some((item) => item.path.includes(
      `${path.join('app', 'src', 'main', 'res', 'mipmap-mdpi')}${path.sep}`,
    )));
    assert.ok(valid.checked.some((item) => item.format === 'xml'));

    fs.writeFileSync(
      manifest,
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:icon="@mipmap/wrong" android:roundIcon="@mipmap/ic_launcher_round" /></manifest>\n',
    );
    const invalid = checkIcons(placeholderConfig, { cwd, targets: ['android'] });
    assert.ok(diagnosticCodes(invalid).includes('android-wiring-mismatch'));

    fs.writeFileSync(manifest, '<manifest><application>');
    const malformed = checkIcons(placeholderConfig, { cwd, targets: ['android'], strict: true });
    assert.ok(diagnosticCodes(malformed).includes('android-manifest-invalid'));
  });

  test('validates supported Electron packager wiring instead of a top-level package icon', () => {
    const cwd = tempDir();
    const packagePath = path.join(cwd, 'package.json');
    fs.writeFileSync(packagePath, `${JSON.stringify({
      name: 'electron-check',
      devDependencies: { 'electron-builder': '^26.0.0' },
    }, null, 2)}\n`);
    makeIcons(placeholderConfig, { cwd, targets: ['electron'], patch: true });

    const valid = checkIcons(placeholderConfig, { cwd, targets: ['electron'] });
    assert.equal(valid.summary.errors, 0);
    assert.equal(valid.summary.warnings, 0);

    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.build.mac.icon = 'other.icns';
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    const invalid = checkIcons(placeholderConfig, { cwd, targets: ['electron'] });
    assert.ok(diagnosticCodes(invalid).includes('electron-icon-unmanaged'));
  });

  test('checks an existing Apple Icon Composer artifact and blocks raster compilation into it', () => {
    const cwd = tempDir();
    const icon = path.join(cwd, 'Brand', 'AppIcon.icon');
    const project = path.join(cwd, 'Demo.xcodeproj');
    fs.mkdirSync(path.join(icon, 'Assets'), { recursive: true });
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(icon, 'Assets', 'layer.png'), encodePng(1, 1, Buffer.from([0, 0, 0, 255])));
    fs.writeFileSync(path.join(icon, 'icon.json'), JSON.stringify({
      fill: 'automatic',
      groups: [{ layers: [{ 'image-name': 'layer.png' }] }],
      'supported-platforms': { squares: 'shared' },
    }));
    fs.writeFileSync(
      path.join(project, 'project.pbxproj'),
      'path = Brand/AppIcon.icon;\nASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n',
    );
    const config = {
      ...placeholderConfig,
      apple: { deliveryMode: 'icon-composer', iconComposer: './Brand/AppIcon.icon' },
      targets: ['apple'],
    };

    const result = checkIcons(config, { cwd, targets: ['apple'] });
    assert.equal(result.ok, true);
    assert.equal(result.summary.errors, 0);
    assert.equal(result.summary.warnings, 0);
    assert.deepEqual(result.checked.map((item) => item.format), ['icon-composer']);
    fs.writeFileSync(path.join(icon, 'Assets', 'layer.png'), 'not an image');
    const corrupted = checkIcons(config, { cwd, targets: ['apple'], strict: true });
    assert.equal(corrupted.ok, false);
    assert.ok(diagnosticCodes(corrupted).includes('apple-icon-composer-invalid'));
    assert.throws(
      () => makeIcons(config, { cwd, targets: ['apple'] }),
      { exitCode: 2, message: /Icon Composer delivery.*run --check/ },
    );
  });

  test('rejects unstructured Icon Composer content and comment-only Xcode references', () => {
    const cwd = tempDir();
    const icon = path.join(cwd, 'AppIcon.icon');
    const project = path.join(cwd, 'Demo.xcodeproj');
    fs.writeFileSync(icon, 'not icon composer metadata');
    fs.mkdirSync(project);
    fs.writeFileSync(
      path.join(project, 'project.pbxproj'),
      '/* path = AppIcon.icon; ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; */\n',
    );
    const config = {
      ...placeholderConfig,
      apple: { deliveryMode: 'icon-composer', iconComposer: './AppIcon.icon' },
      targets: ['apple'],
    };

    const result = checkIcons(config, { cwd, targets: ['apple'], strict: true });
    assert.equal(result.ok, false);
    assert.ok(diagnosticCodes(result).includes('apple-icon-composer-invalid'));
    assert.ok(diagnosticCodes(result).includes('apple-icon-composer-reference-unverified'));
  });

  test('strict mode fails on an otherwise non-fatal Apple routing warning', () => {
    const cwd = tempDir();
    const project = path.join(cwd, 'Demo.xcodeproj');
    const catalog = path.join(cwd, 'Demo', 'Assets.xcassets');
    fs.mkdirSync(project);
    fs.mkdirSync(catalog, { recursive: true });
    fs.writeFileSync(
      path.join(project, 'project.pbxproj'),
      'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n',
    );
    const config = {
      ...placeholderConfig,
      apple: { assetCatalog: './Demo/Assets.xcassets', appIconSet: 'BrandIcon' },
      targets: ['apple'],
    };
    fs.writeFileSync(path.join(cwd, 'icon-maker.config.json'), `${JSON.stringify(config, null, 2)}\n`);
    makeIcons(config, { cwd, targets: ['apple'] });

    const normal = checkIcons(config, { cwd, targets: ['apple'] });
    const strict = checkIcons(config, { cwd, targets: ['apple'], strict: true });
    assert.equal(normal.summary.errors, 0);
    assert.equal(normal.summary.warnings, 1);
    assert.equal(normal.ok, true);
    assert.equal(strict.ok, false);

    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');
    const cli = spawnSync(
      process.execPath,
      [bin, cwd, '--check', '--strict', '--target', 'apple', '--json'],
      { encoding: 'utf8' },
    );
    assert.equal(cli.status, 1);
    const parsed = JSON.parse(cli.stdout);
    assert.equal(parsed.kind, 'check');
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.summary.errors, 0);
    assert.equal(parsed.summary.warnings, 1);
  });

  test('CLI returns zero for valid outputs and one for check failures', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['generic'] });
    const bin = path.resolve(__dirname, '..', 'bin', 'icon-maker.js');

    const valid = spawnSync(
      process.execPath,
      [bin, cwd, '--check', '--target', 'generic', '--json'],
      { encoding: 'utf8' },
    );
    assert.equal(valid.status, 0);
    assert.equal(JSON.parse(valid.stdout).ok, true);

    fs.rmSync(path.join(cwd, 'assets', 'icon.svg'));
    const invalid = spawnSync(
      process.execPath,
      [bin, cwd, '--check', '--target', 'generic', '--json'],
      { encoding: 'utf8' },
    );
    assert.equal(invalid.status, 1);
    const parsed = JSON.parse(invalid.stdout);
    assert.equal(parsed.ok, false);
    assert.ok(diagnosticCodes(parsed).includes('artifact-missing'));
  });

  test('checks staged --out-dir artifacts while explicitly skipping project wiring', () => {
    const cwd = tempDir();
    makeIcons(placeholderConfig, { cwd, targets: ['browser-extension'], outDir: 'staged' });

    const normal = checkIcons(placeholderConfig, {
      cwd,
      targets: ['browser-extension'],
      outDir: 'staged',
    });
    const strict = checkIcons(placeholderConfig, {
      cwd,
      targets: ['browser-extension'],
      outDir: 'staged',
      strict: true,
    });
    assert.equal(normal.summary.errors, 0);
    assert.equal(normal.ok, true);
    assert.ok(diagnosticCodes(normal).includes('wiring-check-skipped-out-dir'));
    assert.equal(strict.ok, false);
  });

  test('infers optional roles from staged outputs rather than the final project directories', () => {
    for (const target of ['pwa', 'expo', 'android']) {
      const cwd = tempDir();
      fs.writeFileSync(path.join(cwd, 'role.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20"/></svg>');
      if (target === 'android') {
        fs.mkdirSync(path.join(cwd, 'app', 'src', 'main'), { recursive: true });
        fs.writeFileSync(path.join(cwd, 'app', 'src', 'main', 'AndroidManifest.xml'),
          '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>');
      }
      const config = { ...placeholderConfig, mark: { ...placeholderConfig.mark,
        source: target === 'pwa' ? { maskable: 'role.svg' } : { monochrome: 'role.svg' } } };
      const generated = makeIcons(config, { cwd, targets: [target], outDir: 'staged' });
      const optional = generated.produced.find((item) => item.role === (target === 'pwa' ? 'maskable' : 'monochrome'));
      assert.ok(optional, target);
      fs.writeFileSync(optional.path, 'corrupt');
      const result = checkIcons(placeholderConfig, { cwd, targets: [target], outDir: 'staged' });
      assert.equal(result.ok, false, target);
      assert.ok(diagnosticCodes(result).includes('png-invalid'), target);
    }
  });
});
