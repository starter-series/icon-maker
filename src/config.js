const fs = require('fs');
const path = require('path');
const { contrastRatio } = require('./color');
const { markPresetForTargets, splitTargetList } = require('./targets');

const CONFIG_NAME = 'icon-maker.config.js';
// Data-only config: parsed with JSON.parse, never executed. Preferred over the
// .js form when auto-discovering, since it cannot run arbitrary code.
const CONFIG_JSON_NAME = 'icon-maker.config.json';

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

function initTargets(targets) {
  const normalized = splitTargetList(targets && targets.length ? targets : ['auto']);
  return normalized.length ? [...new Set(normalized)] : ['auto'];
}

function defaultConfig(cwd = process.cwd(), targets = ['auto']) {
  const pkg = readPackage(cwd);
  const name = titleFromName(pkg.name || path.basename(cwd));
  const resolvedTargets = initTargets(targets);
  const project = {
    name,
    slug: String(pkg.name || path.basename(cwd)).replace(/^@[^/]+\//, ''),
  };
  if (pkg.description) project.description = String(pkg.description);
  return {
    project,
    placeholder: false,
    mark: {
      ...markPresetForTargets(resolvedTargets),
      radius: 0.24,
      // Optional: set source to an SVG/PNG path or a default/adaptiveForeground object.
      // source: './assets/source-icon.svg',
    },
    targets: resolvedTargets,
  };
}

function mergeConfig(base, override) {
  const merged = {
    ...base,
    ...override,
    project: { ...base.project, ...override.project },
    mark: { ...base.mark, ...override.mark },
  };
  if (base.apple || override.apple) merged.apple = { ...base.apple, ...override.apple };
  return merged;
}

function resolveConfigPath(explicit, cwd) {
  if (explicit) return path.resolve(cwd, explicit);
  // Prefer the data-only JSON config so auto-discovery never executes code.
  const jsonCandidate = path.join(cwd, CONFIG_JSON_NAME);
  if (fs.existsSync(jsonCandidate)) return jsonCandidate;
  const candidate = path.join(cwd, CONFIG_NAME);
  return fs.existsSync(candidate) ? candidate : null;
}

// True when `dir` resolves to the same real path as the current working
// directory (the invoker's own directory). Uses realpath so `.`/symlink
// variants cannot bypass the check.
function isInvokerCwd(dir) {
  try {
    return fs.realpathSync(dir) === fs.realpathSync(process.cwd());
  } catch (_err) {
    return false;
  }
}

function loadConfigFile(configPath, autoDiscovered, cwd) {
  if (configPath.endsWith('.json')) {
    // Data-only: parsed, never executed.
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  // A .js config is executed as Node.js code. Refuse to auto-execute one
  // discovered inside a *target* checkout (cwd differs from the invoker's own
  // directory) — that is the untrusted-repo scenario the create-icons skill
  // creates. An explicit --config path is treated as user opt-in.
  if (autoDiscovered && !isInvokerCwd(cwd)) {
    throw new Error(
      `refusing to execute auto-discovered ${path.basename(configPath)} from a target directory; ` +
        `use ${CONFIG_JSON_NAME} for untrusted targets or pass --config explicitly`,
    );
  }
  delete require.cache[require.resolve(configPath)];
  return require(configPath);
}

function loadConfig(cwd, explicit, targets = []) {
  const configPath = resolveConfigPath(explicit, cwd);
  const requestedTargets = targets && targets.length ? targets : null;
  if (!configPath) return { config: defaultConfig(cwd, requestedTargets || ['auto']), configPath: null };
  const loaded = loadConfigFile(configPath, !explicit, cwd);
  const presetTargets = requestedTargets || loaded?.targets || ['auto'];
  return { config: mergeConfig(defaultConfig(cwd, presetTargets), loaded || {}), configPath };
}

function renderDefaultConfig(cwd = process.cwd(), targets = ['auto']) {
  const config = defaultConfig(cwd, targets);
  return `module.exports = {
  project: ${JSON.stringify(config.project, null, 2).replace(/\n/g, '\n  ')},
  // Set true only when deterministic temporary artwork is intentional:
  placeholder: false,
  mark: {
    // glyph: 'braces' | 'spark' | 'bolt'
    glyph: ${JSON.stringify(config.mark.glyph)},
    // shape: 'squircle' | 'circle' | 'square'
    shape: ${JSON.stringify(config.mark.shape)},
    background: ${JSON.stringify(config.mark.background)},
    foreground: ${JSON.stringify(config.mark.foreground)},
    accent: ${JSON.stringify(config.mark.accent)},
    radius: ${JSON.stringify(config.mark.radius)},
    // Approved source artwork:
    // source: { default: './brand/icon.png', adaptiveForeground: './brand/icon-adaptive.png' },
  },
  // When Xcode routing is ambiguous, select the catalog and App Icon set:
  // apple: { assetCatalog: './MyApp/Assets.xcassets', appIconSet: 'AppIcon' },
  targets: ${JSON.stringify(config.targets)},
};
`;
}

function renderDefaultJsonConfig(cwd = process.cwd(), targets = ['auto']) {
  return `${JSON.stringify(defaultConfig(cwd, targets), null, 2)}\n`;
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
  CONFIG_JSON_NAME,
  defaultConfig,
  initTargets,
  loadConfig,
  mergeConfig,
  renderDefaultConfig,
  renderDefaultJsonConfig,
  resolveConfigPath,
  validateConfig,
};
