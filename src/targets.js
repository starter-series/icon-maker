const fs = require('fs');
const path = require('path');

const TARGETS = {
  'browser-extension': {
    label: 'Browser extension',
    files: [
      { path: 'assets/icons/icon16.png', size: 16, format: 'png' },
      { path: 'assets/icons/icon32.png', size: 32, format: 'png' },
      { path: 'assets/icons/icon48.png', size: 48, format: 'png' },
      { path: 'assets/icons/icon128.png', size: 128, format: 'png' },
      { path: 'assets/icons/icon.svg', size: 1024, format: 'svg' },
    ],
  },
  expo: {
    label: 'Expo / React Native',
    files: [
      { path: 'assets/icon.png', size: 1024, format: 'png' },
      { path: 'assets/adaptive-icon.png', size: 1024, format: 'png', transparentBackground: true, role: 'adaptive-foreground' },
      { path: 'assets/icon.svg', size: 1024, format: 'svg' },
    ],
  },
  electron: {
    label: 'Electron app',
    files: [
      { path: 'assets/icon.png', size: 1024, format: 'png' },
      { path: 'assets/icon.ico', sizes: [16, 32, 48, 256], format: 'ico' },
      { path: 'assets/icon.icns', sizes: [128, 256, 512, 1024], format: 'icns' },
      { path: 'assets/icon.svg', size: 1024, format: 'svg' },
    ],
  },
  vscode: {
    label: 'VS Code extension',
    files: [
      { path: 'assets/icon.png', size: 256, format: 'png' },
      { path: 'assets/icon.svg', size: 1024, format: 'svg' },
    ],
  },
  pwa: {
    label: 'Progressive web app',
    files: [
      { path: 'public/icon-192.png', size: 192, format: 'png' },
      { path: 'public/icon-512.png', size: 512, format: 'png' },
      { path: 'public/favicon.ico', sizes: [16, 32, 48], format: 'ico' },
      { path: 'public/favicon.svg', size: 1024, format: 'svg' },
    ],
  },
  'mcp-connector': {
    label: 'MCP connector submission',
    files: [
      { path: 'assets/icon.png', size: 1024, format: 'png' },
      { path: 'assets/icon-512.png', size: 512, format: 'png' },
      { path: 'assets/icon.svg', size: 1024, format: 'svg' },
    ],
  },
  generic: {
    label: 'Generic icon set',
    files: [
      { path: 'assets/icon.png', size: 1024, format: 'png' },
      { path: 'assets/icon.svg', size: 1024, format: 'svg' },
    ],
  },
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_err) {
    return null;
  }
}

function hasPackageDependency(pkg, name) {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name] || pkg.peerDependencies?.[name]);
}

function detectTargets(cwd) {
  const found = [];
  const manifest = readJson(path.join(cwd, 'manifest.json'));
  if (manifest?.manifest_version) found.push('browser-extension');

  const appJson = readJson(path.join(cwd, 'app.json'));
  if (appJson?.expo || fs.existsSync(path.join(cwd, 'app.config.js'))) found.push('expo');

  const pkg = readJson(path.join(cwd, 'package.json')) || {};
  if (pkg.engines?.vscode || pkg.contributes) found.push('vscode');
  if (hasPackageDependency(pkg, 'electron') || hasPackageDependency(pkg, 'electron-builder')) found.push('electron');
  if (fs.existsSync(path.join(cwd, 'public', 'manifest.json'))) found.push('pwa');
  if (fs.existsSync(path.join(cwd, 'server.json'))) found.push('mcp-connector');

  return [...new Set(found.length ? found : ['generic'])];
}

function splitTargetList(values) {
  return values.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean);
}

function resolveTargets(requested, cwd, configTargets) {
  const raw = splitTargetList(requested && requested.length ? requested : configTargets || ['auto']);
  const expanded = raw.includes('auto') ? raw.filter((value) => value !== 'auto').concat(detectTargets(cwd)) : raw;
  const unique = [...new Set(expanded)];
  const unknown = unique.filter((target) => !TARGETS[target]);
  if (unknown.length) throw new Error(`Unknown icon target: ${unknown.join(', ')}`);
  return unique;
}

module.exports = { TARGETS, detectTargets, resolveTargets };
