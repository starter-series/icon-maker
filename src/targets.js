const fs = require('fs');
const path = require('path');
const { hasAppleProject } = require('./apple');

const APPLE_APP_ICON_SPECS = [
  { filename: 'AppIcon-ios-1024.png', pixels: 1024, idiom: 'universal', platform: 'ios', size: '1024x1024' },
  { filename: 'AppIcon-mac-16.png', pixels: 16, idiom: 'mac', scale: '1x', size: '16x16' },
  { filename: 'AppIcon-mac-16@2x.png', pixels: 32, idiom: 'mac', scale: '2x', size: '16x16' },
  { filename: 'AppIcon-mac-32.png', pixels: 32, idiom: 'mac', scale: '1x', size: '32x32' },
  { filename: 'AppIcon-mac-32@2x.png', pixels: 64, idiom: 'mac', scale: '2x', size: '32x32' },
  { filename: 'AppIcon-mac-128.png', pixels: 128, idiom: 'mac', scale: '1x', size: '128x128' },
  { filename: 'AppIcon-mac-128@2x.png', pixels: 256, idiom: 'mac', scale: '2x', size: '128x128' },
  { filename: 'AppIcon-mac-256.png', pixels: 256, idiom: 'mac', scale: '1x', size: '256x256' },
  { filename: 'AppIcon-mac-256@2x.png', pixels: 512, idiom: 'mac', scale: '2x', size: '256x256' },
  { filename: 'AppIcon-mac-512.png', pixels: 512, idiom: 'mac', scale: '1x', size: '512x512' },
  { filename: 'AppIcon-mac-512@2x.png', pixels: 1024, idiom: 'mac', scale: '2x', size: '512x512' },
];

const APPLE_APP_ICON_IMAGES = APPLE_APP_ICON_SPECS.map(({ pixels: _pixels, ...image }) => image);
const APPLE_APP_ICON_FILES = APPLE_APP_ICON_SPECS.map(({ filename, pixels }) => ({
  path: `Assets.xcassets/AppIcon.appiconset/${filename}`,
  size: pixels,
  format: 'png',
  opaqueBackground: true,
  mark: { shape: 'square', backgroundInset: 0, radius: 0 },
}));
APPLE_APP_ICON_FILES.push({
  path: 'Assets.xcassets/AppIcon.appiconset/Contents.json',
  format: 'json',
  contents: {
    images: APPLE_APP_ICON_IMAGES,
    info: { author: 'xcode', version: 1 },
  },
});

const TARGETS = {
  apple: {
    label: 'Apple app (Xcode)',
    mark: { glyph: 'spark', shape: 'square', background: '#111827', foreground: '#ffffff', accent: '#38bdf8' },
    files: APPLE_APP_ICON_FILES,
  },
  'browser-extension': {
    label: 'Browser extension',
    mark: { glyph: 'braces', shape: 'squircle', background: '#111827', foreground: '#f8fafc', accent: '#38bdf8' },
    patch: { type: 'browser-extension' },
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
    mark: { glyph: 'spark', shape: 'squircle', background: '#4630eb', foreground: '#ffffff', accent: '#a7f3d0' },
    patch: { type: 'expo' },
    files: [
      { path: 'assets/icon.png', size: 1024, format: 'png' },
      { path: 'assets/adaptive-icon.png', size: 1024, format: 'png', transparentBackground: true, role: 'adaptive-foreground' },
      { path: 'assets/icon.svg', size: 1024, format: 'svg' },
    ],
  },
  electron: {
    label: 'Electron app',
    mark: { glyph: 'bolt', shape: 'squircle', background: '#1f2937', foreground: '#f9fafb', accent: '#fbbf24' },
    patch: { type: 'package-icon', basename: 'icon.png' },
    files: [
      { path: 'assets/icon.png', size: 1024, format: 'png' },
      { path: 'assets/icon.ico', sizes: [16, 32, 48, 256], format: 'ico' },
      { path: 'assets/icon.icns', sizes: [128, 256, 512, 1024], format: 'icns' },
      { path: 'assets/icon.svg', size: 1024, format: 'svg' },
    ],
  },
  vscode: {
    label: 'VS Code extension',
    mark: { glyph: 'braces', shape: 'squircle', background: '#0f172a', foreground: '#f8fafc', accent: '#60a5fa' },
    patch: { type: 'package-icon', basename: 'icon.png' },
    files: [
      { path: 'assets/icon.png', size: 256, format: 'png' },
      { path: 'assets/icon.svg', size: 1024, format: 'svg' },
    ],
  },
  pwa: {
    label: 'Progressive web app',
    mark: { glyph: 'spark', shape: 'circle', background: '#0f766e', foreground: '#ffffff', accent: '#facc15' },
    patch: { type: 'pwa' },
    files: [
      { path: 'public/icon-192.png', size: 192, format: 'png' },
      { path: 'public/icon-512.png', size: 512, format: 'png' },
      { path: 'public/favicon.ico', sizes: [16, 32, 48], format: 'ico' },
      { path: 'public/favicon.svg', size: 1024, format: 'svg' },
    ],
  },
  'mcp-connector': {
    label: 'MCP connector submission',
    mark: { glyph: 'braces', shape: 'squircle', background: '#18181b', foreground: '#fafafa', accent: '#a78bfa' },
    files: [
      { path: 'assets/icon.png', size: 1024, format: 'png' },
      { path: 'assets/icon-512.png', size: 512, format: 'png' },
      { path: 'assets/icon.svg', size: 1024, format: 'svg' },
    ],
  },
  generic: {
    label: 'Generic icon set',
    mark: { glyph: 'braces', shape: 'squircle', background: '#111827', foreground: '#f8fafc', accent: '#38bdf8' },
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

function detectTargets(cwd, discovery = {}) {
  const found = [];
  if (hasAppleProject(cwd, discovery)) found.push('apple');

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

function markPresetForTargets(targets) {
  const firstConcrete = targets.find((target) => target !== 'auto') || 'generic';
  return TARGETS[firstConcrete]?.mark || TARGETS.generic.mark;
}

function resolveTargets(requested, cwd, configTargets, discovery = {}) {
  const raw = splitTargetList(requested && requested.length ? requested : configTargets || ['auto']);
  const expanded = raw.includes('auto') ? raw.filter((value) => value !== 'auto').concat(detectTargets(cwd, discovery)) : raw;
  const unique = [...new Set(expanded)];
  const unknown = unique.filter((target) => !TARGETS[target]);
  if (unknown.length) {
    const err = new Error(`Unknown icon target: ${unknown.join(', ')}`);
    err.exitCode = 2;
    throw err;
  }
  return unique;
}

module.exports = { TARGETS, detectTargets, markPresetForTargets, resolveTargets, splitTargetList };
