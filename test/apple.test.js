const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeAppleContents,
  resolveAppleAppIconSet,
  resolveAppleAssetCatalog,
  scanAppleProject,
} = require('../src/apple');
const { TARGETS } = require('../src/targets');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-apple-'));
}

function generatedContents() {
  return TARGETS.apple.files.find((file) => file.format === 'json').contents;
}

describe('Apple project routing', () => {
  test('requires an explicit catalog whenever multiple production catalogs exist', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'A', 'Assets.xcassets'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'B', 'Brand.xcassets'), { recursive: true });
    assert.throws(
      () => resolveAppleAssetCatalog(cwd, {}, []),
      /multiple Xcode asset catalogs/,
    );
  });

  test('does not route production output into a Preview Assets catalog', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'Preview Content', 'Preview Assets.xcassets'), { recursive: true });
    const warnings = [];
    assert.equal(resolveAppleAssetCatalog(cwd, {}, warnings), path.join(cwd, 'Assets.xcassets'));
    assert.ok(warnings.some((warning) => warning.code === 'apple-catalog-created'));
  });

  test('rejects a nonexistent explicitly configured catalog', () => {
    const cwd = tempDir();
    assert.throws(
      () => resolveAppleAssetCatalog(cwd, { apple: { assetCatalog: './Typo.xcassets' } }, []),
      /does not exist/,
    );
  });

  test('detects the selected App Icon set from project.pbxproj', () => {
    const cwd = tempDir();
    const project = path.join(cwd, 'Demo.xcodeproj');
    fs.mkdirSync(project);
    fs.writeFileSync(
      path.join(project, 'project.pbxproj'),
      'buildSettings = { ASSETCATALOG_COMPILER_APPICON_NAME = BrandIcon; };\n',
    );
    const scanned = scanAppleProject(cwd);
    assert.equal(resolveAppleAppIconSet(cwd, {}, [], scanned), 'BrandIcon');
  });

  test('requires config when Xcode selects multiple App Icon set names', () => {
    const cwd = tempDir();
    const project = path.join(cwd, 'Demo.xcodeproj');
    fs.mkdirSync(project);
    fs.writeFileSync(
      path.join(project, 'project.pbxproj'),
      [
        'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;',
        'ASSETCATALOG_COMPILER_APPICON_NAME = AlternateIcon;',
      ].join('\n'),
    );
    assert.throws(
      () => resolveAppleAppIconSet(cwd, {}, [], scanAppleProject(cwd)),
      /multiple Xcode App Icon set names/,
    );
  });

  test('rejects unresolved Xcode variables as App Icon set names', () => {
    const cwd = tempDir();
    const project = path.join(cwd, 'Demo.xcodeproj');
    fs.mkdirSync(project);
    fs.writeFileSync(
      path.join(project, 'project.pbxproj'),
      'ASSETCATALOG_COMPILER_APPICON_NAME = $(APP_ICON_NAME);\n',
    );
    assert.throws(
      () => resolveAppleAppIconSet(cwd, {}, [], scanAppleProject(cwd)),
      /apple\.appIconSet must be a single asset name/,
    );
  });

  test('merges empty Xcode appearance slots without losing metadata', () => {
    const cwd = tempDir();
    const catalog = path.join(cwd, 'Assets.xcassets');
    const set = path.join(catalog, 'AppIcon.appiconset');
    fs.mkdirSync(set, { recursive: true });
    fs.writeFileSync(
      path.join(set, 'Contents.json'),
      JSON.stringify({
        images: [
          { idiom: 'universal', platform: 'ios', size: '1024x1024' },
          {
            appearances: [{ appearance: 'luminosity', value: 'dark' }],
            idiom: 'universal',
            platform: 'ios',
            size: '1024x1024',
          },
        ],
        info: { author: 'xcode', version: 1 },
        properties: { 'pre-rendered': true },
      }),
    );
    const merged = mergeAppleContents(catalog, 'AppIcon', generatedContents());
    assert.equal(merged.properties['pre-rendered'], true);
    assert.equal(merged.images[0].filename, 'AppIcon-ios-1024.png');
    assert.ok(merged.images.some((image) => image.appearances?.[0]?.value === 'dark'));
  });

  test('refuses to overwrite an App Icon set owned by another source', () => {
    const cwd = tempDir();
    const catalog = path.join(cwd, 'Assets.xcassets');
    const set = path.join(catalog, 'AppIcon.appiconset');
    fs.mkdirSync(set, { recursive: true });
    fs.writeFileSync(
      path.join(set, 'Contents.json'),
      JSON.stringify({
        images: [{ filename: 'ExistingMarketingIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
        info: { author: 'xcode', version: 1 },
      }),
    );
    assert.throws(
      () => mergeAppleContents(catalog, 'AppIcon', generatedContents()),
      /already references unmanaged icon files/,
    );
  });
});
