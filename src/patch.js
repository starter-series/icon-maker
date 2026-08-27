const fs = require('fs');
const path = require('path');
const { planAndroidManifestPatch } = require('./android');
const { toHex } = require('./color');
const { planElectronWiring } = require('./electron');
const { planPwaManifestPatch, pwaAssetsFromArtifacts } = require('./pwa');
const { TARGETS } = require('./targets');
const { commitWriteTransaction, validateWritePath } = require('./write-transaction');

function detectJsonStyle(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indentMatch = text.match(/\n([ \t]+)"/);
  return { eol, indent: indentMatch ? indentMatch[1] : '  ' };
}

function readJsonDocument(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return { error: `could not read ${file}` };
  }
  try {
    return { json: JSON.parse(text), text, style: detectJsonStyle(text), changed: false };
  } catch (_err) {
    return { error: `could not parse ${file}` };
  }
}

function renderJsonDocument(doc) {
  const json = JSON.stringify(doc.json, null, doc.style.indent);
  return `${json.replace(/\n/g, doc.style.eol)}${doc.style.eol}`;
}

function setIfChanged(object, key, value) {
  if (object[key] === value) return false;
  object[key] = value;
  return true;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidPatchTarget(file, details) {
  return new Error(`icon-maker: patch target ${file} ${details}`);
}

function rel(cwd, absolutePath) {
  return path.relative(cwd, absolutePath).split(path.sep).join('/');
}

function producedByName(cwd, produced, target, basename) {
  const item = produced.find((entry) => entry.target === target && path.basename(entry.path) === basename);
  return item ? rel(cwd, item.path) : null;
}

function mutateBrowserExtension(cwd, produced, json) {
  if (!isPlainObject(json)) throw invalidPatchTarget('manifest.json', 'must contain a JSON object');
  if (json.icons !== undefined && !isPlainObject(json.icons)) {
    throw invalidPatchTarget('manifest.json', 'icons must be a JSON object');
  }
  json.icons = json.icons || {};
  let changed = false;
  for (const size of [16, 32, 48, 128]) {
    const iconPath = producedByName(cwd, produced, 'browser-extension', `icon${size}.png`);
    if (iconPath) changed = setIfChanged(json.icons, String(size), iconPath) || changed;
  }
  return { changed, patch: { target: 'browser-extension', action: 'updated manifest.icons' } };
}

function expoAdaptiveBackground(config = {}) {
  const configured = config.android?.backgroundColor;
  if (configured) {
    if (/^#[0-9a-fA-F]{6}$/.test(configured)) return configured;
    if (/^#[0-9a-fA-F]{8}$/.test(configured)) return `#${configured.slice(3)}`;
    const err = new Error(`android.backgroundColor must be #RRGGBB or #AARRGGBB: ${configured}`);
    err.exitCode = 2;
    throw err;
  }
  const normalized = toHex(config.mark?.background || '#FFFFFF');
  return normalized === 'transparent' ? '#FFFFFF' : normalized;
}

function mutateExpo(cwd, produced, json, options = {}) {
  if (!isPlainObject(json) || !isPlainObject(json.expo)) {
    throw invalidPatchTarget('app.json', 'must contain an expo JSON object');
  }
  if (json.expo.android !== undefined && !isPlainObject(json.expo.android)) {
    throw invalidPatchTarget('app.json', 'expo.android must be a JSON object');
  }
  if (
    json.expo.android?.adaptiveIcon !== undefined
    && !isPlainObject(json.expo.android.adaptiveIcon)
  ) {
    throw invalidPatchTarget('app.json', 'expo.android.adaptiveIcon must be a JSON object');
  }
  const icon = producedByName(cwd, produced, 'expo', 'icon.png');
  const adaptive = producedByName(cwd, produced, 'expo', 'adaptive-icon.png');
  const monochrome = producedByName(cwd, produced, 'expo', 'monochrome-icon.png');
  let changed = false;
  if (icon) changed = setIfChanged(json.expo, 'icon', `./${icon}`) || changed;
  if (adaptive) {
    json.expo.android = json.expo.android || {};
    json.expo.android.adaptiveIcon = json.expo.android.adaptiveIcon || {};
    changed = setIfChanged(json.expo.android.adaptiveIcon, 'foregroundImage', `./${adaptive}`) || changed;
    changed = setIfChanged(
      json.expo.android.adaptiveIcon,
      'backgroundColor',
      expoAdaptiveBackground(options.config),
    ) || changed;
    if (monochrome) {
      changed = setIfChanged(
        json.expo.android.adaptiveIcon,
        'monochromeImage',
        `./${monochrome}`,
      ) || changed;
    }
  }
  return { changed, patch: { target: 'expo', action: 'updated expo icon fields' } };
}

function mutatePackageIcon(cwd, produced, target, basename, json) {
  if (!isPlainObject(json)) throw invalidPatchTarget('package.json', 'must contain a JSON object');
  const icon = producedByName(cwd, produced, target, basename);
  if (!icon) return null;
  return {
    changed: setIfChanged(json, 'icon', icon),
    patch: { target, action: 'updated package.json icon' },
  };
}

const PATCHERS = {
  'browser-extension': (cwd, produced, _target, _spec, json) => mutateBrowserExtension(cwd, produced, json),
  expo: (cwd, produced, _target, _spec, json, options) => mutateExpo(cwd, produced, json, options),
  electron: (cwd, produced, _target, _spec, json, options) => {
    if (!isPlainObject(json)) throw invalidPatchTarget('package.json', 'must contain a JSON object');
    return planElectronWiring(cwd, json, produced, options.warnings);
  },
  'package-icon': (cwd, produced, target, spec, json) => (
    mutatePackageIcon(cwd, produced, target, spec.basename, json)
  ),
};

function patchInputPath(cwd, _target, spec) {
  if (spec.type === 'browser-extension') return path.join(cwd, 'manifest.json');
  if (spec.type === 'expo') return path.join(cwd, 'app.json');
  if (spec.type === 'electron') return path.join(cwd, 'package.json');
  if (spec.type === 'package-icon') return path.join(cwd, 'package.json');
  return null;
}

function loadPlannedDocument(cwd, file, documents, _warnings) {
  if (documents.has(file)) return documents.get(file);
  validateWritePath(cwd, file, 'patch target');
  const doc = readJsonDocument(file);
  if (doc?.error) throw new Error(`icon-maker: ${doc.error}`);
  documents.set(file, doc);
  return doc;
}

function planAndroidPatch(cwd, target, warnings, options) {
  const context = options.targetContexts?.get?.('android');
  const input = context?.manifest;
  if (!input) {
    warnings.push({
      code: 'patch-target-missing',
      message: '--patch requested for android, but no resolved AndroidManifest.xml was available',
    });
    return { patches: [], writes: [] };
  }
  validateWritePath(cwd, input, 'patch target');
  let text;
  try {
    text = fs.readFileSync(input, 'utf8');
  } catch (err) {
    throw new Error(`icon-maker: could not read ${input}`, { cause: err });
  }
  const plan = planAndroidManifestPatch(text, options.config?.android || {});
  if (plan.errors?.length) {
    throw new Error(`icon-maker: Android manifest patch blocked: ${plan.errors.map((item) => item.message).join('; ')}`);
  }
  warnings.push(...plan.warnings);
  if (!plan.changed) return { patches: [], writes: [] };
  return {
    patches: [{
      file: input,
      target,
      action: 'updated AndroidManifest launcher icon fields',
    }],
    writes: [{ path: input, contents: plan.contents, label: 'patch target' }],
  };
}

function appendDiagnosticsOnce(warnings, diagnostics) {
  for (const item of diagnostics) {
    if (!warnings.some((warning) => warning.code === item.code && warning.message === item.message)) {
      warnings.push({ code: item.code, message: item.message });
    }
  }
}

function planPwaPatch(cwd, target, produced, warnings, options) {
  const plan = planPwaManifestPatch({
    cwd,
    config: options.config || {},
    assets: pwaAssetsFromArtifacts(produced),
  });
  appendDiagnosticsOnce(warnings, plan.diagnostics.filter((item) => item.severity === 'warning'));
  const errors = plan.diagnostics.filter((item) => item.severity === 'error');
  if (errors.length) {
    throw new Error(`icon-maker: PWA manifest patch blocked: ${errors.map((item) => item.message).join('; ')}`);
  }
  if (!plan.changed) return { patches: [], writes: [] };
  validateWritePath(cwd, plan.manifestPath, 'patch target');
  return {
    patches: [{
      file: plan.manifestPath,
      target,
      action: 'updated web app manifest icons',
    }],
    writes: [{ path: plan.manifestPath, contents: plan.contents, label: 'patch target' }],
  };
}

function hasDynamicExpoConfig(cwd) {
  return ['app.config.js', 'app.config.ts'].find((name) => fs.existsSync(path.join(cwd, name))) || null;
}

function planPatches(cwd, targets, produced, warnings = [], options = {}) {
  const documents = new Map();
  const patches = [];
  const directWrites = [];
  for (const target of targets) {
    const spec = TARGETS[target]?.patch;
    if (spec?.type === 'android') {
      const planned = planAndroidPatch(cwd, target, warnings, options);
      patches.push(...planned.patches);
      directWrites.push(...planned.writes);
      continue;
    }
    if (spec?.type === 'pwa') {
      const planned = planPwaPatch(cwd, target, produced, warnings, options);
      patches.push(...planned.patches);
      directWrites.push(...planned.writes);
      continue;
    }
    const patcher = spec && PATCHERS[spec.type];
    const input = spec && patchInputPath(cwd, target, spec);
    if (!patcher || !input) continue;
    if (spec.type === 'expo') {
      const dynamicConfig = hasDynamicExpoConfig(cwd);
      if (dynamicConfig) {
        warnings.push({
          code: 'expo-dynamic-config-not-patched',
          message: `--patch does not execute or rewrite ${dynamicConfig}; update its Expo icon fields manually`,
        });
        continue;
      }
    }
    const doc = loadPlannedDocument(cwd, input, documents, warnings);
    if (!doc) {
      warnings.push({
        code: 'patch-target-missing',
        message: `--patch requested for ${target}, but ${path.relative(cwd, input)} was not found`,
      });
      continue;
    }
    const result = patcher(cwd, produced, target, spec, doc.json, { ...options, warnings });
    if (!result?.changed) continue;
    doc.changed = true;
    patches.push({ file: input, ...result.patch });
  }

  const writes = [...directWrites];
  for (const [file, doc] of documents) {
    if (!doc?.changed) continue;
    const contents = renderJsonDocument(doc);
    if (contents !== doc.text) writes.push({ path: file, contents, label: 'patch target' });
  }
  return { patches, writes };
}

function applyPatches(cwd, targets, produced, warnings = [], options = {}) {
  const planned = planPatches(cwd, targets, produced, warnings, options);
  const results = commitWriteTransaction(cwd, planned.writes);
  const written = new Set(results.filter((result) => result.written).map((result) => result.path));
  return planned.patches.filter((patch) => written.has(path.resolve(patch.file)));
}

module.exports = { applyPatches, detectJsonStyle, planPatches };
