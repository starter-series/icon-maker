const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeAppleContents,
  resolveAppleAppIconSet,
  resolveAppleAssetCatalog,
  resolveAppleDeliveryMode,
  resolveAppleIconComposer,
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
  test('discovers Icon Composer files and packages while respecting bounded scan exclusions', () => {
    const cwd = tempDir();
    const file = path.join(cwd, 'Brand', 'Primary.icon');
    const packagePath = path.join(cwd, 'Alternate.icon');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'approved icon composer fixture');
    fs.mkdirSync(packagePath);
    fs.mkdirSync(path.join(cwd, 'build'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'build', 'Ignored.icon'), 'ignored');

    const scanned = scanAppleProject(cwd);
    assert.deepEqual(scanned.iconComposerFiles, [packagePath, file].sort());
  });

  test('validates an explicitly configured Icon Composer artifact inside the checkout', () => {
    const cwd = tempDir();
    const icon = path.join(cwd, 'Brand', 'AppIcon.icon');
    fs.mkdirSync(path.dirname(icon), { recursive: true });
    fs.writeFileSync(icon, 'approved icon composer fixture');

    assert.equal(
      resolveAppleIconComposer(cwd, { apple: { iconComposer: './Brand/AppIcon.icon' } }),
      icon,
    );
    assert.throws(
      () => resolveAppleIconComposer(cwd, { apple: { iconComposer: './Brand/AppIcon.png' } }),
      { exitCode: 2, message: /must point to an \.icon/ },
    );
    assert.throws(
      () => resolveAppleIconComposer(cwd, { apple: { iconComposer: './Missing.icon' } }),
      { exitCode: 2, message: /does not exist/ },
    );
  });

  test('rejects Icon Composer artifacts outside the checkout', () => {
    const cwd = tempDir();
    const outside = tempDir();
    const icon = path.join(outside, 'AppIcon.icon');
    fs.writeFileSync(icon, 'outside');
    assert.throws(
      () => resolveAppleIconComposer(cwd, {
        apple: { iconComposer: path.relative(cwd, icon) },
      }),
      { exitCode: 2, message: /apple\.iconComposer must stay inside the target directory/ },
    );
  });

  test('requires explicit selection when multiple Icon Composer artifacts are discovered', () => {
    const cwd = tempDir();
    const first = path.join(cwd, 'A.icon');
    const second = path.join(cwd, 'Nested', 'B.icon');
    fs.writeFileSync(first, 'a');
    fs.mkdirSync(path.dirname(second));
    fs.writeFileSync(second, 'b');
    const scanned = scanAppleProject(cwd);

    assert.throws(
      () => resolveAppleIconComposer(cwd, {}, [], scanned),
      { exitCode: 2, message: /multiple Icon Composer artifacts.*apple\.iconComposer/ },
    );
    assert.equal(
      resolveAppleIconComposer(cwd, { apple: { iconComposer: './A.icon' } }, [], scanned),
      first,
    );
  });

  test('auto delivery refuses to guess between Icon Composer and a legacy AppIcon set', () => {
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, 'AppIcon.icon'), 'approved icon composer fixture');
    fs.mkdirSync(path.join(cwd, 'Assets.xcassets', 'AppIcon.appiconset'), { recursive: true });
    const scanned = scanAppleProject(cwd);

    assert.throws(
      () => resolveAppleDeliveryMode(cwd, {}, [], scanned),
      { exitCode: 2, message: /both Icon Composer.*set apple\.deliveryMode/ },
    );
  });

  test('explicit delivery mode resolves coexistence without modifying either artifact', () => {
    const cwd = tempDir();
    const icon = path.join(cwd, 'AppIcon.icon');
    const set = path.join(cwd, 'Assets.xcassets', 'AppIcon.appiconset');
    fs.writeFileSync(icon, 'approved icon composer fixture');
    fs.mkdirSync(set, { recursive: true });
    const scanned = scanAppleProject(cwd);
    const legacyWarnings = [];
    const composerWarnings = [];

    assert.equal(
      resolveAppleDeliveryMode(cwd, { apple: { deliveryMode: 'legacy' } }, legacyWarnings, scanned),
      'legacy',
    );
    assert.ok(legacyWarnings.some((warning) => warning.code === 'apple-icon-composer-ignored'));
    assert.equal(
      resolveAppleDeliveryMode(
        cwd,
        { apple: { deliveryMode: 'icon-composer', iconComposer: './AppIcon.icon' } },
        composerWarnings,
        scanned,
      ),
      'icon-composer',
    );
    assert.ok(composerWarnings.some((warning) => warning.code === 'apple-legacy-appiconset-ignored'));
    assert.equal(fs.readFileSync(icon, 'utf8'), 'approved icon composer fixture');
    assert.equal(fs.existsSync(set), true);
  });

  test('delivery mode auto-selects unambiguous workflows and validates explicit requests', () => {
    const legacyCwd = tempDir();
    assert.equal(resolveAppleDeliveryMode(legacyCwd, {}), 'legacy');

    const composerCwd = tempDir();
    fs.writeFileSync(path.join(composerCwd, 'AppIcon.icon'), 'approved icon composer fixture');
    assert.equal(resolveAppleDeliveryMode(composerCwd, {}), 'icon-composer');

    assert.throws(
      () => resolveAppleDeliveryMode(legacyCwd, { apple: { deliveryMode: 'icon-composer' } }),
      { exitCode: 2, message: /no approved \.icon artifact/ },
    );
    assert.throws(
      () => resolveAppleDeliveryMode(legacyCwd, { apple: { deliveryMode: 'future' } }),
      { exitCode: 2, message: /must be auto, legacy, or icon-composer/ },
    );
    assert.throws(
      () => resolveAppleDeliveryMode(legacyCwd, {
        apple: { deliveryMode: 'legacy', iconComposer: './Missing.icon' },
      }),
      { exitCode: 2, message: /apple\.iconComposer does not exist/ },
    );
  });

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
