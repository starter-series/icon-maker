const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { discoverBrandContext } = require('../src/brand');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-brand-'));
}

describe('brand context discovery', () => {
  test('finds bounded brand assets, guidance documents, and structured colors', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'brand'));
    fs.mkdirSync(path.join(cwd, 'public'));
    fs.mkdirSync(path.join(cwd, 'node_modules', 'ignored'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, 'brand', 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#14B8A6"/><path fill="#F8FAFC"/></svg>',
    );
    fs.writeFileSync(path.join(cwd, 'brand', 'identity.md'), '# Visual identity\nPrecise and quiet.\n');
    fs.writeFileSync(
      path.join(cwd, 'public', 'manifest.json'),
      JSON.stringify({ theme_color: '#0F172A', background_color: '#ffffff' }),
    );
    fs.writeFileSync(path.join(cwd, 'node_modules', 'ignored', 'logo.svg'), '<svg fill="#ff0000"/>');

    const result = discoverBrandContext(cwd);
    assert.equal(result.hasEvidence, true);
    assert.deepEqual(result.assets.map((item) => item.relativePath), ['brand/logo.svg']);
    assert.deepEqual(result.documents.map((item) => item.relativePath), ['brand/identity.md']);
    assert.ok(result.colors.some((item) => item.value === '#14b8a6'));
    assert.ok(result.colors.some((item) => item.value === '#0f172a'));
    assert.equal(result.colors.some((item) => item.value === '#ff0000'), false);
  });

  test('reports no evidence for an empty project', () => {
    assert.deepEqual(discoverBrandContext(tempDir()), {
      assets: [],
      documents: [],
      colors: [],
      hasEvidence: false,
    });
  });

  test('finds an existing Xcode App Icon through Contents.json', () => {
    const cwd = tempDir();
    const set = path.join(cwd, 'App', 'Assets.xcassets', 'AppIcon.appiconset');
    fs.mkdirSync(set, { recursive: true });
    fs.writeFileSync(path.join(set, 'existing-1024.png'), 'fixture');
    fs.writeFileSync(
      path.join(set, 'Contents.json'),
      JSON.stringify({ images: [{ filename: 'existing-1024.png', idiom: 'universal' }] }),
    );

    const result = discoverBrandContext(cwd);
    assert.equal(result.hasEvidence, true);
    assert.deepEqual(result.assets, [{
      relativePath: 'App/Assets.xcassets/AppIcon.appiconset/existing-1024.png',
      kind: 'icon',
    }]);
  });
});
