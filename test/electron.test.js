const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectElectronProvider,
  findDynamicForgeConfigs,
  planElectronWiring,
} = require('../src/electron');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-electron-'));
}

function produced(cwd, names = ['icon.png', 'icon.ico', 'icon.icns']) {
  return names.map((name) => ({
    target: 'electron',
    path: path.join(cwd, 'assets', name),
  }));
}

describe('Electron provider detection and wiring', () => {
  test('detects electron-builder from a dependency or static build config', () => {
    assert.equal(
      detectElectronProvider({ devDependencies: { 'electron-builder': '^26.0.0' } }).provider,
      'electron-builder',
    );
    assert.equal(detectElectronProvider({ build: {} }).provider, 'electron-builder');
  });

  test('plans electron-builder mac, win, and linux icons without treating top-level icon as wiring', () => {
    const cwd = tempDir();
    const packageJson = {
      icon: 'legacy-package-metadata.png',
      devDependencies: { 'electron-builder': '^26.0.0' },
    };
    const warnings = [];
    const result = planElectronWiring(cwd, packageJson, produced(cwd), warnings, {
      dynamicForgeConfigs: [],
    });

    assert.equal(result.provider, 'electron-builder');
    assert.equal(result.changed, true);
    assert.equal(result.complete, true);
    assert.equal(packageJson.icon, 'legacy-package-metadata.png');
    assert.deepEqual(packageJson.build, {
      mac: { icon: 'assets/icon.icns' },
      win: { icon: 'assets/icon.ico' },
      linux: { icon: 'assets/icon.png' },
    });
    assert.deepEqual(warnings, []);
  });

  test('preserves unmanaged electron-builder paths while wiring independent missing platforms', () => {
    const cwd = tempDir();
    const packageJson = {
      build: {
        mac: { icon: 'brand/custom.icns', category: 'public.app-category.utilities' },
      },
    };
    const warnings = [];
    const result = planElectronWiring(cwd, packageJson, produced(cwd), warnings, {
      dynamicForgeConfigs: [],
    });

    assert.equal(result.changed, true);
    assert.equal(result.complete, false);
    assert.deepEqual(packageJson.build.mac, {
      icon: 'brand/custom.icns',
      category: 'public.app-category.utilities',
    });
    assert.equal(packageJson.build.win.icon, 'assets/icon.ico');
    assert.equal(packageJson.build.linux.icon, 'assets/icon.png');
    assert.ok(warnings.some((warning) => warning.code === 'electron-icon-unmanaged'));
  });

  test('does not replace non-object electron-builder config', () => {
    const cwd = tempDir();
    const packageJson = {
      devDependencies: { 'electron-builder': '^26.0.0' },
      build: './electron-builder.yml',
    };
    const warnings = [];
    const result = planElectronWiring(cwd, packageJson, produced(cwd), warnings, {
      dynamicForgeConfigs: [],
    });

    assert.equal(result.changed, false);
    assert.equal(packageJson.build, './electron-builder.yml');
    assert.ok(warnings.some((warning) => warning.code === 'electron-builder-config-unsupported'));
  });

  test('does not introduce a build object that shadows an external builder config', () => {
    const cwd = tempDir();
    for (const name of ['electron-builder.yml', 'electron-builder.cjs']) {
      const file = path.join(cwd, name);
      fs.writeFileSync(file, 'must not execute or rewrite');
      const packageJson = { devDependencies: { 'electron-builder': '^26.0.0' } };
      const before = structuredClone(packageJson);
      const warnings = [];
      const result = planElectronWiring(cwd, packageJson, produced(cwd), warnings);
      assert.equal(result.changed, false);
      assert.equal(result.complete, false);
      assert.deepEqual(packageJson, before);
      assert.ok(warnings.some((item) => item.code === 'electron-builder-external-config'));
      fs.unlinkSync(file);
    }
  });

  test('plans an extensionless Forge packagerConfig icon from matching ICNS and ICO outputs', () => {
    const cwd = tempDir();
    const packageJson = {
      icon: 'not-packager-wiring.png',
      config: { forge: { packagerConfig: { asar: true } } },
    };
    const warnings = [];
    const result = planElectronWiring(cwd, packageJson, produced(cwd), warnings, {
      dynamicForgeConfigs: [],
    });

    assert.equal(result.provider, 'electron-forge');
    assert.equal(result.changed, true);
    assert.equal(result.complete, true);
    assert.equal(packageJson.config.forge.packagerConfig.icon, 'assets/icon');
    assert.equal(packageJson.icon, 'not-packager-wiring.png');
    assert.deepEqual(warnings, []);
  });

  test('preserves an unmanaged Forge icon', () => {
    const cwd = tempDir();
    const packageJson = {
      config: { forge: { packagerConfig: { icon: 'brand/custom' } } },
    };
    const warnings = [];
    const result = planElectronWiring(cwd, packageJson, produced(cwd), warnings, {
      dynamicForgeConfigs: [],
    });

    assert.equal(result.changed, false);
    assert.equal(result.complete, false);
    assert.equal(packageJson.config.forge.packagerConfig.icon, 'brand/custom');
    assert.ok(warnings.some((warning) => warning.code === 'electron-icon-unmanaged'));
  });

  test('warns and does not mutate dynamic Forge configuration', () => {
    const cwd = tempDir();
    const dynamicConfig = path.join(cwd, 'forge.config.ts');
    fs.writeFileSync(dynamicConfig, 'export default { packagerConfig: {} };\n');
    const packageJson = {
      devDependencies: { '@electron-forge/cli': '^7.0.0' },
    };
    const before = JSON.stringify(packageJson);
    const warnings = [];
    assert.deepEqual(findDynamicForgeConfigs(cwd), [dynamicConfig]);

    const result = planElectronWiring(cwd, packageJson, produced(cwd), warnings);
    assert.equal(result.provider, 'electron-forge-dynamic');
    assert.equal(result.changed, false);
    assert.equal(JSON.stringify(packageJson), before);
    assert.ok(warnings.some((warning) => warning.code === 'electron-forge-dynamic-config'));
  });

  test('treats simultaneous static and dynamic Forge configs conservatively', () => {
    const cwd = tempDir();
    const dynamicConfig = path.join(cwd, 'forge.config.js');
    fs.writeFileSync(dynamicConfig, 'module.exports = {};\n');
    const packageJson = { config: { forge: { packagerConfig: {} } } };
    const warnings = [];

    const result = planElectronWiring(cwd, packageJson, produced(cwd), warnings);
    assert.equal(result.provider, 'electron-forge-dynamic');
    assert.equal(result.changed, false);
    assert.equal(packageJson.config.forge.packagerConfig.icon, undefined);
    assert.ok(warnings.some((warning) => warning.code === 'electron-forge-dynamic-config'));
  });

  test('warns and does not mutate ambiguous or unknown packagers', () => {
    const cwd = tempDir();
    const ambiguous = {
      build: {},
      config: { forge: { packagerConfig: {} } },
    };
    const ambiguousBefore = JSON.stringify(ambiguous);
    const ambiguousWarnings = [];
    const ambiguousResult = planElectronWiring(
      cwd,
      ambiguous,
      produced(cwd),
      ambiguousWarnings,
      { dynamicForgeConfigs: [] },
    );
    assert.equal(ambiguousResult.provider, 'ambiguous');
    assert.equal(ambiguousResult.changed, false);
    assert.equal(JSON.stringify(ambiguous), ambiguousBefore);
    assert.ok(ambiguousWarnings.some((warning) => warning.code === 'electron-provider-ambiguous'));

    const unknown = { dependencies: { electron: '^40.0.0' }, icon: 'metadata.png' };
    const unknownBefore = JSON.stringify(unknown);
    const unknownWarnings = [];
    const unknownResult = planElectronWiring(
      cwd,
      unknown,
      produced(cwd),
      unknownWarnings,
      { dynamicForgeConfigs: [] },
    );
    assert.equal(unknownResult.provider, 'unknown');
    assert.equal(unknownResult.changed, false);
    assert.equal(JSON.stringify(unknown), unknownBefore);
    assert.ok(unknownWarnings.some((warning) => warning.code === 'electron-packager-unknown'));
  });

  test('does not claim complete wiring when generated platform outputs are missing', () => {
    const cwd = tempDir();
    const packageJson = { build: {} };
    const warnings = [];
    const result = planElectronWiring(
      cwd,
      packageJson,
      produced(cwd, ['icon.ico']),
      warnings,
      { dynamicForgeConfigs: [] },
    );

    assert.equal(result.changed, true);
    assert.equal(result.complete, false);
    assert.equal(packageJson.build.win.icon, 'assets/icon.ico');
    assert.equal(packageJson.build.mac, undefined);
    assert.equal(packageJson.build.linux, undefined);
    assert.equal(
      warnings.filter((warning) => warning.code === 'electron-icon-output-missing').length,
      2,
    );
  });
});
