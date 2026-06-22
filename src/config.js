const fs = require('fs');
const path = require('path');
const { contrastRatio } = require('./color');

const CONFIG_NAME = 'icon-maker.config.js';

function titleFromName(name) {
  return String(name || 'icon-maker')
    .replace(/^@[^/]+\//, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function readPackage(cwd) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  } catch (_err) {
    return {};
  }
}

const TARGET_MARK_PRESETS = {
  'browser-extension': { glyph: 'braces', shape: 'squircle', background: '#111827', foreground: '#f8fafc', accent: '#38bdf8' },
  expo: { glyph: 'spark', shape: 'squircle', background: '#4630eb', foreground: '#ffffff', accent: '#a7f3d0' },
  electron: { glyph: 'bolt', shape: 'squircle', background: '#1f2937', foreground: '#f9fafb', accent: '#fbbf24' },
  vscode: { glyph: 'braces', shape: 'squircle', background: '#0f172a', foreground: '#f8fafc', accent: '#60a5fa' },
  pwa: { glyph: 'spark', shape: 'circle', background: '#0f766e', foreground: '#ffffff', accent: '#facc15' },
  'mcp-connector': { glyph: 'braces', shape: 'squircle', background: '#18181b', foreground: '#fafafa', accent: '#a78bfa' },
  generic: { glyph: 'braces', shape: 'squircle', background: '#111827', foreground: '#f8fafc', accent: '#38bdf8' },
};

function splitTargetList(values) {
  return values.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean);
}

function initTargets(targets) {
  const normalized = splitTargetList(targets && targets.length ? targets : ['auto']);
  return normalized.length ? [...new Set(normalized)] : ['auto'];
}

function markPresetForTargets(targets) {
  const firstConcrete = targets.find((target) => target !== 'auto') || 'generic';
  return TARGET_MARK_PRESETS[firstConcrete] || TARGET_MARK_PRESETS.generic;
}

function defaultConfig(cwd = process.cwd(), targets = ['auto']) {
  const pkg = readPackage(cwd);
  const name = titleFromName(pkg.name || path.basename(cwd));
  const resolvedTargets = initTargets(targets);
  return {
    project: {
      name,
      slug: String(pkg.name || path.basename(cwd)).replace(/^@[^/]+\//, ''),
    },
    mark: {
      ...markPresetForTargets(resolvedTargets),
      radius: 0.24,
      // Optional: set source to an SVG file when you have a finished brand mark.
      // source: './assets/source-icon.svg',
    },
    targets: resolvedTargets,
  };
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    project: { ...base.project, ...override.project },
    mark: { ...base.mark, ...override.mark },
  };
}

function resolveConfigPath(explicit, cwd) {
  if (explicit) return path.resolve(cwd, explicit);
  const candidate = path.join(cwd, CONFIG_NAME);
  return fs.existsSync(candidate) ? candidate : null;
}

function loadConfig(cwd, explicit) {
  const configPath = resolveConfigPath(explicit, cwd);
  if (!configPath) return { config: defaultConfig(cwd), configPath: null };
  delete require.cache[require.resolve(configPath)];
  const loaded = require(configPath);
  return { config: mergeConfig(defaultConfig(cwd), loaded || {}), configPath };
}

function renderDefaultConfig(cwd = process.cwd(), targets = ['auto']) {
  const config = defaultConfig(cwd, targets);
  return `module.exports = {
  project: ${JSON.stringify(config.project, null, 2).replace(/\n/g, '\n  ')},
  mark: {
    // glyph: 'braces' | 'spark' | 'bolt'
    glyph: ${JSON.stringify(config.mark.glyph)},
    // shape: 'squircle' | 'circle' | 'square'
    shape: ${JSON.stringify(config.mark.shape)},
    background: ${JSON.stringify(config.mark.background)},
    foreground: ${JSON.stringify(config.mark.foreground)},
    accent: ${JSON.stringify(config.mark.accent)},
    radius: ${JSON.stringify(config.mark.radius)},
    // Use a finished SVG source instead of the generated mark:
    // source: './assets/source-icon.svg',
  },
  targets: ${JSON.stringify(config.targets)},
};
`;
}

function validateConfig(config) {
  const warnings = [];
  const background = config.mark?.background || '#111827';
  const foreground = config.mark?.foreground || '#f8fafc';
  if (background !== 'transparent') {
    const ratio = contrastRatio(background, foreground);
    if (ratio < 2) {
      warnings.push({
        code: 'low-contrast',
        message: `foreground/background contrast is ${ratio.toFixed(2)}:1; aim for at least 2:1 for tiny icons`,
      });
    }
  }
  return warnings;
}

module.exports = {
  CONFIG_NAME,
  defaultConfig,
  initTargets,
  loadConfig,
  mergeConfig,
  renderDefaultConfig,
  resolveConfigPath,
  validateConfig,
};
