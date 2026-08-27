const fs = require('fs');
const path = require('path');
const {
  projectScan,
  resolveAppleAppIconSet,
  resolveAppleAssetCatalog,
  resolveAppleDeliveryMode,
  resolveAppleIconComposer,
} = require('./apple');
const {
  androidProjectScan,
  planAndroidIconFiles,
  planAndroidManifestPatch,
  resolveAndroidProject,
} = require('./android');
const { toHex } = require('./color');
const { defaultConfig, loadConfig, mergeConfig } = require('./config');
const { planElectronWiring } = require('./electron');
const { assertContainedExistingPath, assertContainedOutputPath } = require('./path-safety');
const { inspectPng } = require('./png-inspect');
const {
  planPwaIconFiles,
  planPwaManifestPatch,
  pwaAssetsFromArtifacts,
  resolvePwaManifest,
} = require('./pwa');
const { loadSource, sourcePathFromConfig, validateSvgDocument } = require('./source');
const { TARGETS, resolveTargets } = require('./targets');

const CHECK_SCHEMA_VERSION = 1;

function diagnostic(severity, code, target, file, message) {
  return {
    severity,
    code,
    target,
    path: file,
    message,
  };
}

function relative(cwd, file) {
  return path.relative(cwd, file).split(path.sep).join('/') || '.';
}

function validatePng(buffer, target, file, spec, cwd, diagnostics) {
  const inspected = inspectPng(buffer);
  if (!inspected.valid) {
    diagnostics.push(diagnostic(
      'error',
      'png-invalid',
      target,
      file,
      `${relative(cwd, file)} is not a structurally valid PNG (${inspected.reason})`,
    ));
    return;
  }

  const { width, height, colorType } = inspected;
  if (width !== spec.size || height !== spec.size) {
    diagnostics.push(diagnostic(
      'error',
      'png-dimensions',
      target,
      file,
      `${relative(cwd, file)} is ${width}x${height}; expected ${spec.size}x${spec.size}`,
    ));
  }

  if (target === 'apple' && colorType !== 2) {
    diagnostics.push(diagnostic(
      'error',
      'apple-png-color-type',
      target,
      file,
      `${relative(cwd, file)} uses PNG color type ${colorType}; Apple output must be RGB color type 2 without alpha`,
    ));
  }
  if (spec.transparentBackground === true && colorType !== 6) {
    diagnostics.push(diagnostic(
      'error',
      'png-alpha-required',
      target,
      file,
      `${relative(cwd, file)} uses PNG color type ${colorType}; this foreground output requires RGBA color type 6`,
    ));
  } else if (spec.transparentBackground === true && inspected.hasTransparency !== true) {
    diagnostics.push(diagnostic(
      'error',
      'png-transparency-required',
      target,
      file,
      `${relative(cwd, file)} is fully opaque; this foreground output requires at least one transparent pixel`,
    ));
  }
  if (spec.transparentBackground === true && inspected.hasVisiblePixels === false) {
    diagnostics.push(diagnostic('error', 'png-foreground-empty', target, file,
      `${relative(cwd, file)} is fully transparent; this foreground output requires visible pixels`));
  }
}

function beginsWithSvg(text) {
  const normalized = text.replace(/^\uFEFF/, '').trimStart();
  return /^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[\s\S]*?>\s*)?<svg[\s>]/i.test(normalized);
}

function validateSvg(buffer, target, file, cwd, diagnostics) {
  const svg = buffer.toString('utf8');
  if (beginsWithSvg(svg)) {
    try {
      validateSvgDocument(svg);
    } catch (_err) {
      diagnostics.push(diagnostic('error', 'svg-invalid', target, file,
        `${relative(cwd, file)} is not a parseable SVG document`));
    }
    return;
  }
  diagnostics.push(diagnostic(
    'error',
    'svg-root',
    target,
    file,
    `${relative(cwd, file)} does not have an SVG document root`,
  ));
}

function icoSize(value) {
  return value === 0 ? 256 : value;
}

function validPngPayload(buffer, expectedSize) {
  const inspected = inspectPng(buffer);
  return inspected.valid && inspected.width === expectedSize && inspected.height === expectedSize;
}

function validateIco(buffer, target, file, spec, cwd, diagnostics) {
  let valid = buffer.length >= 6
    && buffer.readUInt16LE(0) === 0
    && buffer.readUInt16LE(2) === 1;
  const count = valid ? buffer.readUInt16LE(4) : 0;
  valid = valid && count > 0 && buffer.length >= 6 + count * 16;
  const sizes = [];
  if (valid) {
    for (let index = 0; index < count; index++) {
      const offset = 6 + index * 16;
      const width = icoSize(buffer[offset]);
      const height = icoSize(buffer[offset + 1]);
      const byteLength = buffer.readUInt32LE(offset + 8);
      const imageOffset = buffer.readUInt32LE(offset + 12);
      if (
        width !== height
        || !byteLength
        || imageOffset < 6 + count * 16
        || imageOffset + byteLength > buffer.length
        || !validPngPayload(buffer.subarray(imageOffset, imageOffset + byteLength), width)
      ) {
        valid = false;
        break;
      }
      sizes.push(width);
    }
  }
  const expected = [...(spec.sizes || [])].sort((left, right) => left - right);
  const actual = sizes.sort((left, right) => left - right);
  if (valid && expected.length) valid = JSON.stringify(actual) === JSON.stringify(expected);
  if (valid) return;
  diagnostics.push(diagnostic(
    'error',
    'ico-invalid',
    target,
    file,
    `${relative(cwd, file)} has an invalid ICO header, entry table, or size set`,
  ));
}

const ICNS_TYPES = new Map([
  [16, 'icp4'],
  [32, 'icp5'],
  [64, 'icp6'],
  [128, 'ic07'],
  [256, 'ic08'],
  [512, 'ic09'],
  [1024, 'ic10'],
]);

function validateIcns(buffer, target, file, spec, cwd, diagnostics) {
  let valid = buffer.length >= 8
    && buffer.subarray(0, 4).toString('ascii') === 'icns'
    && buffer.readUInt32BE(4) === buffer.length;
  const types = [];
  let offset = 8;
  while (valid && offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      valid = false;
      break;
    }
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const length = buffer.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > buffer.length) {
      valid = false;
      break;
    }
    const size = [...ICNS_TYPES].find(([, expectedType]) => expectedType === type)?.[0];
    if (!size || !validPngPayload(buffer.subarray(offset + 8, offset + length), size)) {
      valid = false;
      break;
    }
    types.push(type);
    offset += length;
  }
  valid = valid && offset === buffer.length;
  const expectedTypes = (spec.sizes || []).map((size) => ICNS_TYPES.get(size)).filter(Boolean).sort();
  if (valid && expectedTypes.length) {
    valid = JSON.stringify(types.sort()) === JSON.stringify(expectedTypes);
  }
  if (valid) return;
  diagnostics.push(diagnostic(
    'error',
    'icns-invalid',
    target,
    file,
    `${relative(cwd, file)} has an invalid ICNS header, chunk table, or size set`,
  ));
}

function validateJson(buffer, target, file, cwd, diagnostics) {
  try {
    JSON.parse(buffer.toString('utf8'));
  } catch (_err) {
    diagnostics.push(diagnostic(
      'error',
      'json-invalid',
      target,
      file,
      `${relative(cwd, file)} is not valid JSON`,
    ));
  }
}

function validateXml(buffer, target, file, spec, cwd, diagnostics) {
  const text = buffer.toString('utf8');
  const hasRoot = /<(?:adaptive-icon|resources)[\s>]/.test(text);
  const exact = typeof spec.contents !== 'string' || text === spec.contents;
  if (hasRoot && exact) return;
  diagnostics.push(diagnostic(
    'error',
    `${target}-xml-mismatch`,
    target,
    file,
    `${relative(cwd, file)} does not match the planned ${target} XML resource`,
  ));
}

function validateIconComposerArtifact(cwd, item, stat, diagnostics) {
  const metadataPath = stat.isDirectory() ? path.join(item.path, 'icon.json') : item.path;
  let metadata;
  try {
    assertContainedExistingPath(stat.isDirectory() ? item.path : cwd, metadataPath, 'Icon Composer metadata');
    const metadataStat = fs.statSync(metadataPath);
    if (!metadataStat.isFile() || !metadataStat.size) throw new Error('metadata is not a non-empty file');
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (_err) {
    metadata = null;
  }
  const plainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const groupsValid = Array.isArray(metadata?.groups)
    && metadata.groups.length > 0
    && metadata.groups.length <= 4
    && metadata.groups.every((group) => (
      plainObject(group)
      && Array.isArray(group.layers)
      && group.layers.length > 0
      && group.layers.every((layer) => (
        plainObject(layer)
        && typeof layer['image-name'] === 'string'
        && layer['image-name'].trim().length > 0
      ))
    ));
  const platforms = metadata?.['supported-platforms'];
  const platformsValid = plainObject(platforms) && Object.values(platforms).some((value) => (
    (typeof value === 'string' && value.trim())
    || (Array.isArray(value) && value.length > 0)
  ));
  const structured = metadata
    && typeof metadata === 'object'
    && !Array.isArray(metadata)
    && typeof metadata.fill === 'string'
    && metadata.fill.trim().length > 0
    && groupsValid
    && platformsValid;
  if (structured && stat.isDirectory()) {
    const imageNames = [];
    const collectImageNames = (value) => {
      if (!value || typeof value !== 'object') return;
      if (typeof value['image-name'] === 'string') imageNames.push(value['image-name']);
      for (const nested of Object.values(value)) collectImageNames(nested);
    };
    collectImageNames(metadata.groups);
    const assetsDirectory = path.join(item.path, 'Assets');
    const assetsValid = imageNames.every((name) => {
      if (path.basename(name) !== name) return false;
      try {
        const asset = assertContainedExistingPath(item.path, path.join(assetsDirectory, name), 'Icon Composer asset');
        const assetStat = fs.statSync(asset);
        if (!assetStat.isFile() || !assetStat.size) return false;
        if (['.png', '.svg'].includes(path.extname(name).toLowerCase())) {
          loadSource(item.path, { mark: { source: asset } });
        } else {
          diagnostics.push(diagnostic('warning', 'apple-icon-composer-asset-unverified', item.target, asset,
            `${relative(cwd, asset)} uses an image format this checker cannot decode`));
        }
        return true;
      } catch (_err) {
        return false;
      }
    });
    if (assetsValid) return;
  } else if (structured && stat.isFile()) {
    diagnostics.push(diagnostic('warning', 'apple-icon-composer-assets-unverified', item.target, item.path,
      'Standalone Icon Composer metadata has no package asset directory; referenced artwork could not be verified'));
    return;
  }
  diagnostics.push(diagnostic(
    'error',
    'apple-icon-composer-invalid',
    item.target,
    item.path,
    `${relative(cwd, item.path)} must contain structured Icon Composer metadata and all referenced assets`,
  ));
}

function validateArtifact(cwd, item, diagnostics) {
  let stat;
  try {
    stat = fs.statSync(item.path);
  } catch (err) {
    const code = err && err.code === 'ENOENT' ? 'artifact-missing' : 'artifact-unreadable';
    diagnostics.push(diagnostic(
      'error',
      code,
      item.target,
      item.path,
      `${relative(cwd, item.path)} ${code === 'artifact-missing' ? 'is missing' : 'could not be inspected'}`,
    ));
    return;
  }
  if (item.spec.format === 'icon-composer') {
    validateIconComposerArtifact(cwd, item, stat, diagnostics);
    return;
  }
  if (!stat.isFile()) {
    diagnostics.push(diagnostic(
      'error',
      'artifact-not-file',
      item.target,
      item.path,
      `${relative(cwd, item.path)} is not a regular file`,
    ));
    return;
  }

  let buffer;
  try {
    buffer = fs.readFileSync(item.path);
  } catch (_err) {
    diagnostics.push(diagnostic(
      'error',
      'artifact-unreadable',
      item.target,
      item.path,
      `${relative(cwd, item.path)} could not be read`,
    ));
    return;
  }

  const validators = {
    png: () => validatePng(buffer, item.target, item.path, item.spec, cwd, diagnostics),
    svg: () => validateSvg(buffer, item.target, item.path, cwd, diagnostics),
    ico: () => validateIco(buffer, item.target, item.path, item.spec, cwd, diagnostics),
    icns: () => validateIcns(buffer, item.target, item.path, item.spec, cwd, diagnostics),
    json: () => validateJson(buffer, item.target, item.path, cwd, diagnostics),
    xml: () => validateXml(buffer, item.target, item.path, item.spec, cwd, diagnostics),
  };
  const validate = validators[item.spec.format];
  if (validate) validate();
  else {
    diagnostics.push(diagnostic(
      'warning',
      'artifact-validation-unsupported',
      item.target,
      item.path,
      `${relative(cwd, item.path)} uses unsupported validation format ${item.spec.format}`,
    ));
  }
}

function resolveAppleContext(cwd, opts, config, discovery, diagnostics) {
  const warnings = [];
  const scanned = projectScan(cwd, discovery);
  const deliveryMode = resolveAppleDeliveryMode(cwd, config, warnings, scanned);
  if (deliveryMode === 'icon-composer') {
    const iconComposer = resolveAppleIconComposer(cwd, config, warnings, scanned);
    for (const warning of warnings) {
      diagnostics.push(diagnostic('warning', warning.code, 'apple', iconComposer, warning.message));
    }
    return { deliveryMode, iconComposer };
  }
  const appIconSet = resolveAppleAppIconSet(cwd, config, warnings, scanned);
  const catalog = opts.outDir
    ? path.resolve(cwd, opts.outDir, 'apple', 'Assets.xcassets')
    : resolveAppleAssetCatalog(cwd, config, warnings, scanned);
  for (const warning of warnings) {
    diagnostics.push(diagnostic('warning', warning.code, 'apple', catalog, warning.message));
  }
  return { deliveryMode, appIconSet, catalog };
}

function resolveAndroidContext(cwd, opts, config, discovery) {
  const project = resolveAndroidProject(cwd, config, androidProjectScan(cwd, discovery));
  const manifest = path.resolve(cwd, project.relativeManifest);
  const resDir = path.join(path.dirname(manifest), 'res');
  const configured = config.android || {};
  const normalizedBackground = toHex(config.mark?.background || '#FFFFFF');
  const backgroundColor = configured.backgroundColor
    || (normalizedBackground === 'transparent' ? '#FFFFFF' : normalizedBackground);
  const resourceName = configured.resourceName || 'ic_launcher';
  const outputRoot = opts.outDir ? path.resolve(cwd, opts.outDir, 'android') : resDir;
  const hasGeneratedMonochrome = fs.existsSync(path.join(
    outputRoot,
    'mipmap-anydpi-v33',
    `${resourceName}.xml`,
  ));
  const files = planAndroidIconFiles({
    ...configured,
    backgroundColor,
    includeMonochrome: Boolean(sourcePathFromConfig(config, 'monochrome')) || hasGeneratedMonochrome,
  });
  assertContainedOutputPath(cwd, path.join(outputRoot, 'values', 'icon-maker-probe.xml'));
  return { ...project, manifest, resDir, files };
}

function outputPath(cwd, opts, target, relativePath, targetContexts) {
  if (target === 'apple') {
    const appleContext = targetContexts.get('apple');
    const prefix = 'Assets.xcassets/AppIcon.appiconset/';
    if (!appleContext || !relativePath.startsWith(prefix)) {
      const err = new Error(`invalid ${target} output path: ${relativePath}`);
      err.exitCode = 2;
      throw err;
    }
    return path.resolve(
      appleContext.catalog,
      `${appleContext.appIconSet}.appiconset`,
      relativePath.slice(prefix.length),
    );
  }
  if (opts.outDir) return path.resolve(cwd, opts.outDir, target, relativePath);
  if (target === 'pwa') {
    const pwaContext = targetContexts.get('pwa');
    const prefix = 'public/';
    if (!pwaContext?.publicRoot || !relativePath.startsWith(prefix)) {
      const err = new Error(`invalid ${target} output path: ${relativePath}`);
      err.exitCode = 2;
      throw err;
    }
    return path.resolve(pwaContext.publicRoot, relativePath.slice(prefix.length));
  }
  if (target === 'android') {
    const androidContext = targetContexts.get('android');
    if (!androidContext) {
      const err = new Error(`missing ${target} output context`);
      err.exitCode = 2;
      throw err;
    }
    return path.resolve(androidContext.resDir, relativePath);
  }
  return path.resolve(cwd, relativePath);
}

function prepareCheckContext(inputConfig, opts) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const presetTargets = opts.targets?.length ? opts.targets : inputConfig?.targets || [];
  const config = inputConfig
    ? mergeConfig(defaultConfig(cwd, presetTargets), inputConfig)
    : loadConfig(cwd, opts.config, opts.targets || []).config;
  const discovery = {};
  const targets = resolveTargets(opts.targets || [], cwd, config.targets, discovery);
  return { cwd, config, discovery, targets };
}

function readOptionalJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_err) {
    return null;
  }
}

function pwaOptionalRoles(context, opts) {
  const resolved = context.targetContexts.get('pwa');
  const manifest = !opts.outDir && resolved?.manifestPath ? readOptionalJson(resolved.manifestPath) : null;
  const purposes = Array.isArray(manifest?.icons)
    ? manifest.icons.flatMap((entry) => String(entry?.purpose || 'any').split(/\s+/))
    : [];
  const publicRoot = opts.outDir ? path.resolve(context.cwd, opts.outDir, 'pwa', 'public')
    : resolved?.publicRoot || path.join(context.cwd, 'public');
  return {
    includeMaskable: Boolean(sourcePathFromConfig(context.config, 'maskable'))
      || purposes.includes('maskable')
      || ['icon-maskable-192.png', 'icon-maskable-512.png'].some((name) => (
        fs.existsSync(path.join(publicRoot, name))
      )),
    includeMonochrome: Boolean(sourcePathFromConfig(context.config, 'monochrome'))
      || purposes.includes('monochrome')
      || fs.existsSync(path.join(publicRoot, 'icon-monochrome.svg')),
  };
}

function expoIncludesMonochrome(cwd, config, opts) {
  const app = opts.outDir ? null : readOptionalJson(path.join(cwd, 'app.json'));
  const outputRoot = opts.outDir ? path.resolve(cwd, opts.outDir, 'expo') : cwd;
  return Boolean(sourcePathFromConfig(config, 'monochrome'))
    || typeof app?.expo?.android?.adaptiveIcon?.monochromeImage === 'string'
    || fs.existsSync(path.join(outputRoot, 'assets', 'monochrome-icon.png'));
}

function buildCheckPlan(context, opts, diagnostics) {
  const targetContexts = new Map();
  if (context.targets.includes('apple')) {
    targetContexts.set(
      'apple',
      resolveAppleContext(context.cwd, opts, context.config, context.discovery, diagnostics),
    );
  }
  if (context.targets.includes('android')) {
    targetContexts.set(
      'android',
      resolveAndroidContext(context.cwd, opts, context.config, context.discovery),
    );
  }
  if (context.targets.includes('pwa')) {
    const resolved = resolvePwaManifest(context.cwd, context.config, []);
    targetContexts.set('pwa', { ...resolved, publicRoot: resolved.publicRoot || path.join(context.cwd, 'public') });
  }
  return context.targets.flatMap((target) => {
    if (target === 'apple' && targetContexts.get('apple')?.deliveryMode === 'icon-composer') {
      const iconComposer = assertContainedExistingPath(
        context.cwd,
        targetContexts.get('apple').iconComposer,
        'apple.iconComposer',
      );
      return [{
        target,
        path: iconComposer,
        spec: { format: 'icon-composer', role: 'passthrough' },
      }];
    }
    let files = TARGETS[target].files;
    if (target === 'android') files = targetContexts.get('android').files;
    if (target === 'pwa') {
      files = planPwaIconFiles(pwaOptionalRoles({ ...context, targetContexts }, opts));
    }
    if (target === 'expo' && expoIncludesMonochrome(context.cwd, context.config, opts)) {
      files = [
        ...files,
        {
          path: 'assets/monochrome-icon.png',
          size: 1024,
          format: 'png',
          transparentBackground: true,
          role: 'monochrome',
          sourceRole: 'monochrome',
        },
      ];
    }
    return files.map((spec) => {
      const file = outputPath(context.cwd, opts, target, spec.path, targetContexts);
      assertContainedOutputPath(context.cwd, file);
      return { target, path: file, spec };
    });
  });
}

function loadWiringJson(cwd, target, file, diagnostics) {
  if (!fs.existsSync(file)) {
    diagnostics.push(diagnostic(
      'warning',
      `${target}-wiring-missing`,
      target,
      file,
      `${relative(cwd, file)} is missing; generated files exist but project wiring could not be verified`,
    ));
    return null;
  }
  try {
    assertContainedExistingPath(cwd, file, 'wiring file');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('JSON root must be an object');
    return json;
  } catch (_err) {
    diagnostics.push(diagnostic(
      'error',
      `${target}-wiring-invalid`,
      target,
      file,
      `${relative(cwd, file)} must be a readable, contained JSON object`,
    ));
    return null;
  }
}

function planItem(plan, target, predicate) {
  return plan.find((item) => item.target === target && predicate(item));
}

function wiringMismatch(cwd, target, file, details, diagnostics) {
  diagnostics.push(diagnostic(
    'error',
    `${target}-wiring-mismatch`,
    target,
    file,
    `${relative(cwd, file)} does not point to the generated ${details}`,
  ));
}

function validateBrowserExtensionWiring(cwd, plan, diagnostics) {
  const file = path.join(cwd, 'manifest.json');
  const json = loadWiringJson(cwd, 'browser-extension', file, diagnostics);
  if (!json) return;
  for (const size of [16, 32, 48, 128]) {
    const item = planItem(plan, 'browser-extension', (candidate) => (
      candidate.spec.format === 'png' && candidate.spec.size === size
    ));
    const expected = item ? relative(cwd, item.path) : null;
    if (!expected || json.icons?.[String(size)] !== expected) {
      wiringMismatch(cwd, 'browser-extension', file, `${size}px icon path ${expected}`, diagnostics);
    }
  }
}

function expoBackground(config = {}) {
  const configured = config.android?.backgroundColor;
  if (/^#[0-9a-fA-F]{6}$/.test(configured || '')) return configured;
  if (/^#[0-9a-fA-F]{8}$/.test(configured || '')) return `#${configured.slice(3)}`;
  const normalized = toHex(config.mark?.background || '#FFFFFF');
  return normalized === 'transparent' ? '#FFFFFF' : normalized;
}

function validateExpoWiring(cwd, plan, diagnostics, config) {
  const file = path.join(cwd, 'app.json');
  const dynamicConfig = ['app.config.js', 'app.config.ts']
    .find((name) => fs.existsSync(path.join(cwd, name)));
  if (dynamicConfig) {
    diagnostics.push(diagnostic(
      'warning',
      'expo-dynamic-config-unverified',
      'expo',
      path.join(cwd, dynamicConfig),
      `${dynamicConfig} may override app.json; icon wiring must be verified manually`,
    ));
  }
  const json = loadWiringJson(cwd, 'expo', file, diagnostics);
  if (!json) return;
  const icon = planItem(plan, 'expo', (item) => item.spec.path.endsWith('/icon.png'));
  const adaptive = planItem(plan, 'expo', (item) => item.spec.role === 'adaptive-foreground');
  const monochrome = planItem(plan, 'expo', (item) => item.spec.role === 'monochrome');
  const expectedIcon = icon ? `./${relative(cwd, icon.path)}` : null;
  const expectedAdaptive = adaptive ? `./${relative(cwd, adaptive.path)}` : null;
  if (!expectedIcon || json.expo?.icon !== expectedIcon) {
    wiringMismatch(cwd, 'expo', file, `app icon path ${expectedIcon}`, diagnostics);
  }
  if (!expectedAdaptive || json.expo?.android?.adaptiveIcon?.foregroundImage !== expectedAdaptive) {
    wiringMismatch(cwd, 'expo', file, `adaptive foreground path ${expectedAdaptive}`, diagnostics);
  }
  if (json.expo?.android?.adaptiveIcon?.backgroundColor !== expoBackground(config)) {
    wiringMismatch(cwd, 'expo', file, `adaptive background color ${expoBackground(config)}`, diagnostics);
  }
  if (monochrome) {
    const expectedMonochrome = `./${relative(cwd, monochrome.path)}`;
    if (json.expo?.android?.adaptiveIcon?.monochromeImage !== expectedMonochrome) {
      wiringMismatch(cwd, 'expo', file, `monochrome foreground path ${expectedMonochrome}`, diagnostics);
    }
  }
}

function appendDiagnosticsOnce(diagnostics, additions) {
  for (const item of additions) {
    if (!diagnostics.some((current) => current.code === item.code && current.message === item.message)) {
      diagnostics.push(item);
    }
  }
}

function validatePwaWiring(cwd, plan, diagnostics, config) {
  const artifacts = plan
    .filter((item) => item.target === 'pwa')
    .map((item) => ({
      target: item.target,
      path: item.path,
      format: item.spec.format,
      size: item.spec.size,
      role: item.spec.role,
    }));
  const patchPlan = planPwaManifestPatch({
    cwd,
    config,
    assets: pwaAssetsFromArtifacts(artifacts),
  });
  appendDiagnosticsOnce(diagnostics, patchPlan.diagnostics);
  if (patchPlan.status === 'planned') {
    wiringMismatch(
      cwd,
      'pwa',
      patchPlan.manifestPath,
      'PWA any, maskable, and monochrome icon entries',
      diagnostics,
    );
  }
}

function validateVscodeWiring(cwd, plan, diagnostics) {
  const file = path.join(cwd, 'package.json');
  const json = loadWiringJson(cwd, 'vscode', file, diagnostics);
  if (!json) return;
  const icon = planItem(plan, 'vscode', (item) => item.spec.path.endsWith('/icon.png'));
  const expected = icon ? relative(cwd, icon.path) : null;
  if (!expected || json.icon !== expected) {
    wiringMismatch(cwd, 'vscode', file, `extension icon path ${expected}`, diagnostics);
  }
}

function validateAndroidWiring(cwd, _plan, diagnostics, config) {
  const project = resolveAndroidProject(cwd, config, androidProjectScan(cwd, {}));
  const file = path.resolve(cwd, project.relativeManifest);
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (_err) {
    diagnostics.push(diagnostic(
      'error',
      'android-wiring-missing',
      'android',
      file,
      `${relative(cwd, file)} could not be read`,
    ));
    return;
  }
  const patchPlan = planAndroidManifestPatch(contents, config.android || {});
  for (const error of patchPlan.errors || []) {
    diagnostics.push(diagnostic('error', error.code, 'android', file, error.message));
  }
  for (const warning of patchPlan.warnings) {
    diagnostics.push(diagnostic('warning', warning.code, 'android', file, warning.message));
  }
  if (patchPlan.changed) {
    wiringMismatch(cwd, 'android', file, 'launcher icon and roundIcon resources', diagnostics);
  }
}

function validateElectronWiring(cwd, plan, diagnostics) {
  const file = path.join(cwd, 'package.json');
  const json = loadWiringJson(cwd, 'electron', file, diagnostics);
  if (!json) return;
  const proposed = JSON.parse(JSON.stringify(json));
  const warnings = [];
  const result = planElectronWiring(cwd, proposed, plan, warnings);
  const errorCodes = new Set(['electron-icon-unmanaged', 'electron-icon-output-missing']);
  for (const warning of warnings) {
    diagnostics.push(diagnostic(
      errorCodes.has(warning.code) ? 'error' : 'warning',
      warning.code,
      'electron',
      file,
      warning.message,
    ));
  }
  if (result.changed) {
    wiringMismatch(cwd, 'electron', file, `${result.provider} platform icon fields`, diagnostics);
  } else if (!result.complete && !warnings.length) {
    diagnostics.push(diagnostic(
      'warning',
      'electron-wiring-unverified',
      'electron',
      file,
      'Electron packager wiring could not be verified',
    ));
  }
}

const WIRING_VALIDATORS = {
  android: validateAndroidWiring,
  'browser-extension': validateBrowserExtensionWiring,
  expo: validateExpoWiring,
  electron: validateElectronWiring,
  pwa: validatePwaWiring,
  vscode: validateVscodeWiring,
};

function validateTargetWiring(cwd, targets, plan, diagnostics, config) {
  for (const target of targets) {
    const validate = WIRING_VALIDATORS[target];
    if (validate) validate(cwd, plan, diagnostics, config);
  }
}

function validateAppleContents(cwd, plan, diagnostics) {
  const contentsItem = planItem(plan, 'apple', (item) => item.spec.format === 'json');
  if (!contentsItem || !fs.existsSync(contentsItem.path)) return;
  let contents;
  try {
    contents = JSON.parse(fs.readFileSync(contentsItem.path, 'utf8'));
  } catch (_err) {
    return;
  }
  if (!contents || typeof contents !== 'object' || !Array.isArray(contents.images)) {
    diagnostics.push(diagnostic(
      'error',
      'apple-contents-images',
      'apple',
      contentsItem.path,
      `${relative(cwd, contentsItem.path)} does not contain an images array`,
    ));
    return;
  }

  const expected = new Set(plan
    .filter((item) => item.target === 'apple' && item.spec.format === 'png')
    .map((item) => path.basename(item.path)));
  const referenced = contents.images
    .map((image) => image?.filename)
    .filter((filename) => typeof filename === 'string' && filename.length > 0);
  const counts = new Map();
  for (const filename of referenced) counts.set(filename, (counts.get(filename) || 0) + 1);

  for (const filename of expected) {
    if (counts.get(filename) !== 1) {
      diagnostics.push(diagnostic(
        'error',
        'apple-contents-reference-mismatch',
        'apple',
        contentsItem.path,
        `${relative(cwd, contentsItem.path)} must reference ${filename} exactly once`,
      ));
    }
  }

  const expectedImages = contentsItem.spec.contents.images;
  for (const expectedImage of expectedImages) {
    const image = contents.images.find((entry) => entry?.filename === expectedImage.filename);
    if (!image) continue; // Missing references are reported above.
    const fields = ['idiom', 'platform', 'size', 'scale'];
    if (fields.some((field) => image[field] !== expectedImage[field])
      || (image.appearances !== undefined && JSON.stringify(image.appearances) !== '[]')) {
      diagnostics.push(diagnostic('error', 'apple-contents-slot-mismatch', 'apple', contentsItem.path,
        `${expectedImage.filename} must occupy its generated idiom/platform/size/scale slot without appearances`));
    }
  }

  const setDirectory = path.dirname(contentsItem.path);
  for (const filename of new Set(referenced)) {
    if (path.basename(filename) !== filename) {
      diagnostics.push(diagnostic(
        'error',
        'apple-contents-reference-unsafe',
        'apple',
        contentsItem.path,
        `${relative(cwd, contentsItem.path)} contains a non-local filename reference: ${filename}`,
      ));
      continue;
    }
    if (!expected.has(filename)) {
      diagnostics.push(diagnostic(
        'error',
        'apple-contents-reference-unexpected',
        'apple',
        contentsItem.path,
        `${relative(cwd, contentsItem.path)} unexpectedly references ${filename}`,
      ));
    }
    const referencedFile = path.join(setDirectory, filename);
    let referencedStat;
    try {
      referencedStat = fs.statSync(referencedFile);
    } catch (_err) {
      referencedStat = null;
    }
    if (!referencedStat?.isFile()) {
      diagnostics.push(diagnostic(
        'error',
        'apple-contents-file-missing',
        'apple',
        referencedFile,
        `${relative(cwd, contentsItem.path)} references missing file ${filename}`,
      ));
    }
  }
}

function validateAppleIconComposerReference(cwd, plan, diagnostics, discovery) {
  const composer = planItem(plan, 'apple', (item) => item.spec.format === 'icon-composer');
  if (!composer) return;
  const projectFiles = projectScan(cwd, discovery).projects
    .filter((project) => project.toLowerCase().endsWith('.xcodeproj'))
    .map((project) => path.join(project, 'project.pbxproj'))
    .filter((file) => fs.existsSync(file));
  const basename = path.basename(composer.path);
  const iconName = path.basename(basename, path.extname(basename));
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const referencePattern = new RegExp(
    `\\b(?:path|name)\\s*=\\s*(?:"[^"]*${escapeRegex(basename)}"|[^;\\n]*${escapeRegex(basename)})\\s*;`,
  );
  const settingPattern = new RegExp(
    `\\bASSETCATALOG_COMPILER_APPICON_NAME\\s*=\\s*"?${escapeRegex(iconName)}"?\\s*;`,
  );
  const referenced = projectFiles.some((file) => {
    try {
      const project = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\r\n]*/g, '');
      return referencePattern.test(project) && settingPattern.test(project);
    } catch (_err) {
      return false;
    }
  });
  if (!referenced) {
    diagnostics.push(diagnostic(
      'warning',
      'apple-icon-composer-reference-unverified',
      'apple',
      composer.path,
      `${relative(cwd, composer.path)} exists, but its Xcode file reference and App Icon build setting could not both be verified`,
    ));
  }
}

function checkIcons(inputConfig = null, opts = {}) {
  const context = prepareCheckContext(inputConfig, opts);
  const diagnostics = [];
  const plan = buildCheckPlan(context, opts, diagnostics);
  for (const item of plan) validateArtifact(context.cwd, item, diagnostics);
  if (context.targets.includes('apple')) {
    validateAppleContents(context.cwd, plan, diagnostics);
    validateAppleIconComposerReference(context.cwd, plan, diagnostics, context.discovery);
  }
  const wiredTargets = context.targets.filter((target) => WIRING_VALIDATORS[target]);
  if (opts.outDir && wiredTargets.length) {
    for (const target of wiredTargets) {
      diagnostics.push(diagnostic(
        'warning',
        'wiring-check-skipped-out-dir',
        target,
        path.resolve(context.cwd, opts.outDir),
        `${target} project wiring was not checked because --out-dir selects staged artifacts`,
      ));
    }
  } else {
    validateTargetWiring(context.cwd, context.targets, plan, diagnostics, context.config);
  }

  const errors = diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = diagnostics.filter((item) => item.severity === 'warning').length;
  const strict = opts.strict === true;
  return {
    schemaVersion: CHECK_SCHEMA_VERSION,
    kind: 'check',
    ok: errors === 0 && (!strict || warnings === 0),
    cwd: context.cwd,
    targets: context.targets,
    strict,
    checked: plan.map((item) => ({
      target: item.target,
      path: item.path,
      format: item.spec.format,
      size: item.spec.size,
      sizes: item.spec.sizes,
      role: item.spec.role,
    })),
    diagnostics,
    summary: {
      artifacts: plan.length,
      errors,
      warnings,
    },
  };
}

module.exports = { CHECK_SCHEMA_VERSION, checkIcons };
