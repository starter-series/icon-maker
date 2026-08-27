const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ANDROID_DENSITIES,
  planAndroidIconFiles,
  planAndroidManifestPatch,
  renderAdaptiveIconXml,
  renderAndroidColorXml,
  resolveAndroidProject,
  scanAndroidProject,
} = require('../src/android');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-android-'));
}

function writeManifest(cwd, relativePath, contents = '<manifest><application /></manifest>\n') {
  const file = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

describe('Android project routing', () => {
  test('finds standard and nested src/main Android manifests while skipping build output', () => {
    const cwd = tempDir();
    const standard = writeManifest(cwd, 'src/main/AndroidManifest.xml');
    const nested = writeManifest(cwd, 'packages/mobile/android/app/src/main/AndroidManifest.xml');
    writeManifest(cwd, 'build/generated/src/main/AndroidManifest.xml');

    assert.deepEqual(scanAndroidProject(cwd).manifests, [nested, standard].sort((a, b) => a.localeCompare(b)));
  });

  test('resolves one candidate into manifest, source-set, resource, and module paths', () => {
    const cwd = tempDir();
    writeManifest(cwd, 'android/app/src/main/AndroidManifest.xml');
    const realCwd = fs.realpathSync(cwd);
    const manifest = path.join(realCwd, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    assert.deepEqual(resolveAndroidProject(cwd), {
      manifest,
      sourceSetDir: path.join(realCwd, 'android', 'app', 'src', 'main'),
      resDir: path.join(realCwd, 'android', 'app', 'src', 'main', 'res'),
      moduleDir: path.join(realCwd, 'android', 'app'),
      relativeManifest: 'android/app/src/main/AndroidManifest.xml',
    });
  });

  test('requires an explicit manifest when multiple Android modules are present', () => {
    const cwd = tempDir();
    writeManifest(cwd, 'android/app/src/main/AndroidManifest.xml');
    const selected = writeManifest(cwd, 'android/demo/src/main/AndroidManifest.xml');

    assert.throws(
      () => resolveAndroidProject(cwd),
      { exitCode: 2, message: /multiple Android manifests.*set android\.manifest/ },
    );
    assert.equal(
      resolveAndroidProject(cwd, { android: { manifest: './android/demo/src/main/AndroidManifest.xml' } }).manifest,
      fs.realpathSync(selected),
    );
  });

  test('rejects explicit manifests outside the target checkout', { skip: process.platform === 'win32' }, () => {
    const cwd = tempDir();
    const outside = tempDir();
    const manifest = writeManifest(outside, 'app/src/main/AndroidManifest.xml');
    assert.throws(
      () => resolveAndroidProject(cwd, { android: { manifest } }),
      { exitCode: 2, message: /android\.manifest must stay inside the target directory/ },
    );
  });
});

describe('Android icon file planning', () => {
  test('plans density-specific legacy, round, and adaptive foreground files', () => {
    const files = planAndroidIconFiles({ backgroundColor: '#123456' });
    assert.equal(files.length, ANDROID_DENSITIES.length * 3 + 3);
    assert.deepEqual(
      files.filter((file) => file.role === 'legacy').map(({ density, size }) => ({ density, size })),
      [
        { density: 'mdpi', size: 48 },
        { density: 'hdpi', size: 72 },
        { density: 'xhdpi', size: 96 },
        { density: 'xxhdpi', size: 144 },
        { density: 'xxxhdpi', size: 192 },
      ],
    );
    assert.deepEqual(
      files.filter((file) => file.role === 'adaptive-foreground').map(({ density, size }) => ({ density, size })),
      [
        { density: 'mdpi', size: 108 },
        { density: 'hdpi', size: 162 },
        { density: 'xhdpi', size: 216 },
        { density: 'xxhdpi', size: 324 },
        { density: 'xxxhdpi', size: 432 },
      ],
    );
    assert.equal(files.find((file) => file.role === 'adaptive-background-color').contents.includes('#123456'), true);
    assert.equal(files.find((file) => file.role === 'adaptive-definition').contents.includes('<monochrome'), false);
  });

  test('adds optional density-specific monochrome files and XML references', () => {
    const files = planAndroidIconFiles({ includeMonochrome: true });
    assert.equal(files.filter((file) => file.role === 'monochrome').length, ANDROID_DENSITIES.length);
    assert.doesNotMatch(
      files.find((file) => file.path === 'mipmap-anydpi-v26/ic_launcher.xml').contents,
      /<monochrome/,
    );
    assert.match(
      files.find((file) => file.path === 'mipmap-anydpi-v33/ic_launcher.xml').contents,
      /<monochrome android:drawable="@mipmap\/ic_launcher_monochrome" \/>/,
    );
  });

  test('renders deterministic adaptive icon and color XML', () => {
    assert.equal(
      renderAdaptiveIconXml({
        backgroundResourceName: 'brand_background',
        foregroundResourceName: 'brand_foreground',
        monochromeResourceName: 'brand_monochrome',
      }),
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
        '    <background android:drawable="@color/brand_background" />\n' +
        '    <foreground android:drawable="@mipmap/brand_foreground" />\n' +
        '    <monochrome android:drawable="@mipmap/brand_monochrome" />\n' +
        '</adaptive-icon>\n',
    );
    assert.match(
      renderAndroidColorXml({ backgroundResourceName: 'brand_background', backgroundColor: '#AABBCC' }),
      /<color name="brand_background">#AABBCC<\/color>/,
    );
  });

  test('rejects invalid or colliding Android resource names', () => {
    assert.throws(
      () => planAndroidIconFiles({ resourceName: 'AppIcon' }),
      { exitCode: 2, message: /lowercase Android resource name/ },
    );
    assert.throws(
      () => planAndroidIconFiles({ roundResourceName: 'ic_launcher' }),
      { exitCode: 2, message: /resource names must be distinct/ },
    );
  });
});

describe('AndroidManifest icon patch planning', () => {
  test('preserves comments and CRLF while replacing icon and adding roundIcon', () => {
    const input = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<!-- <application android:icon="@mipmap/comment_only" /> -->',
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
      '    <application',
      '        android:name=".MainApplication"',
      '        android:icon="@mipmap/old_icon">',
      '    </application>',
      '</manifest>',
      '',
    ].join('\r\n');
    const plan = planAndroidManifestPatch(input, { resourceName: 'brand_icon' });
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.warnings, []);
    assert.match(plan.contents, /android:icon="@mipmap\/brand_icon"/);
    assert.match(plan.contents, /android:roundIcon="@mipmap\/brand_icon_round"/);
    assert.match(plan.contents, /<!-- <application android:icon="@mipmap\/comment_only" \/> -->/);
    assert.equal(plan.contents.replaceAll('\r\n', '').includes('\n'), false);
  });

  test('leaves an already-current manifest byte-for-byte unchanged', () => {
    const input = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round" /></manifest>\n';
    assert.deepEqual(planAndroidManifestPatch(input), {
      changed: false,
      contents: input,
      warnings: [],
      attributes: [
        { name: 'icon', value: '@mipmap/ic_launcher' },
        { name: 'roundIcon', value: '@mipmap/ic_launcher_round' },
      ],
    });
  });

  test('does not rewrite dynamic icon values', () => {
    const input = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:icon="${launcherIcon}" /></manifest>\n';
    const plan = planAndroidManifestPatch(input);
    assert.equal(plan.changed, false);
    assert.equal(plan.contents, input);
    assert.deepEqual(plan.warnings.map((warning) => warning.code), ['android-manifest-dynamic-icon']);
  });

  test('does not guess when application elements or target attributes are ambiguous', () => {
    const applications = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /><application /></manifest>\n';
    const duplicateAttributes = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:icon="@mipmap/a" android:icon="@mipmap/b" /></manifest>\n';
    assert.deepEqual(
      planAndroidManifestPatch(applications).warnings.map((warning) => warning.code),
      ['android-manifest-ambiguous-application'],
    );
    assert.deepEqual(
      planAndroidManifestPatch(duplicateAttributes).errors.map((error) => error.code),
      ['android-manifest-invalid'],
    );
  });

  test('rejects structurally malformed Android XML before planning a patch', () => {
    const plan = planAndroidManifestPatch('<manifest><application>');
    assert.equal(plan.changed, false);
    assert.deepEqual(plan.warnings, []);
    assert.deepEqual(plan.errors.map((error) => error.code), ['android-manifest-invalid']);

    for (const invalid of [
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="A & B" /></manifest>',
      '<![CDATA[outside]]><manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>',
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest><?xml version="1.0"?>',
    ]) {
      assert.deepEqual(
        planAndroidManifestPatch(invalid).errors.map((error) => error.code),
        ['android-manifest-invalid'],
      );
    }
  });

  test('requires the standard android namespace before adding prefixed icon attributes', () => {
    const plan = planAndroidManifestPatch('<manifest><application /></manifest>');
    assert.equal(plan.changed, false);
    assert.deepEqual(plan.errors.map((error) => error.code), ['android-manifest-namespace-invalid']);
  });
});
