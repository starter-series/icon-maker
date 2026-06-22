const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { detectTargets, resolveTargets } = require('../src/targets');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-targets-'));
}

describe('target detection', () => {
  test('detects browser extension from manifest.json', () => {
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, 'manifest.json'), JSON.stringify({ manifest_version: 3 }));
    assert.ok(detectTargets(cwd).includes('browser-extension'));
  });

  test('detects expo and vscode surfaces', () => {
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, 'app.json'), JSON.stringify({ expo: { name: 'App' } }));
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ engines: { vscode: '^1.90.0' } }));
    assert.deepEqual(detectTargets(cwd).sort(), ['expo', 'vscode']);
  });

  test('detects electron, pwa, and mcp connector surfaces', () => {
    const cwd = tempDir();
    fs.mkdirSync(path.join(cwd, 'public'));
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ dependencies: { electron: '^35.0.0' } }));
    fs.writeFileSync(path.join(cwd, 'public', 'manifest.json'), JSON.stringify({ name: 'Demo' }));
    fs.writeFileSync(path.join(cwd, 'server.json'), JSON.stringify({ name: 'demo-server' }));

    assert.deepEqual(detectTargets(cwd).sort(), ['electron', 'mcp-connector', 'pwa']);
  });

  test('falls back to generic and rejects unknown explicit target', () => {
    const cwd = tempDir();
    assert.deepEqual(detectTargets(cwd), ['generic']);
    assert.throws(() => resolveTargets(['nope'], cwd), /Unknown icon target/);
  });
});
