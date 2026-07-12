const fs = require('fs');
const path = require('path');
const {
  mergeAppleContents,
  projectScan,
  resolveAppleAppIconSet,
  resolveAppleAssetCatalog,
} = require('./apple');
const { parseHexColor, toHex } = require('./color');
const { encodeIco, encodeIcns } = require('./containers');
const { defaultConfig, loadConfig, mergeConfig, validateConfig } = require('./config');
const { encodePng, encodeRgbPng, rasterizePrimitives, resizeRgba } = require('./png');
const { renderPreviewHtml } = require('./preview');
const { loadSource, renderSourceToPixels, renderSourceToPng, renderSourceToSvg } = require('./source');
const { renderSvg } = require('./svg');
const { buildPrimitives } = require('./mark');
const { TARGETS, resolveTargets } = require('./targets');
const { applyPatches } = require('./patch');
const { resolveSourceMode } = require('./workflow');

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function isInsideDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafeOutputPath(cwd, candidate) {
  const logicalRoot = path.resolve(cwd);
  const logicalCandidate = path.resolve(candidate);
  if (!isInsideDirectory(logicalRoot, logicalCandidate)) {
    const err = new Error(`icon-maker: output path must stay inside the target directory: ${logicalCandidate}`);
    err.exitCode = 2;
    throw err;
  }
  const realRoot = fs.realpathSync(logicalRoot);
  let existing = logicalCandidate;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (!isInsideDirectory(realRoot, fs.realpathSync(existing))) {
    const err = new Error(`icon-maker: output path resolves outside the target directory: ${logicalCandidate}`);
    err.exitCode = 2;
    throw err;
  }
}

function sameFilePath(left, right) {
  if (!left || !right) return false;
  if (path.resolve(left) === path.resolve(right)) return true;
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false;
  return fs.realpathSync(left) === fs.realpathSync(right);
}

function writeFileIfChanged(file, contents) {
  const next = contentBuffer(contents);
  try {
    if (fs.readFileSync(file).equals(next)) return false;
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
  ensureDir(file);
  fs.writeFileSync(file, next);
  return true;
}

function contentBuffer(contents) {
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
}

function outputPath(cwd, opts, target, relativePath, targetContexts) {
  if (target === 'apple') {
    const context = targetContexts.get('apple');
    const prefix = 'Assets.xcassets/AppIcon.appiconset/';
    if (!context || !relativePath.startsWith(prefix)) {
      throw new Error(`invalid ${target} output path: ${relativePath}`);
    }
    return path.resolve(context.catalog, `${context.appIconSet}.appiconset`, relativePath.slice(prefix.length));
  }
  if (opts.outDir) return path.resolve(cwd, opts.outDir, target, relativePath);
  return path.resolve(cwd, relativePath);
}

function fileConfig(config, file) {
  const mark = { ...(file.mark || {}) };
  if (file.transparentBackground) mark.background = 'transparent';
  if (file.opaqueBackground) mark.background = opaqueBackground(config.mark?.background);
  return Object.keys(mark).length ? mergeConfig(config, { mark }) : config;
}

function renderPng(config, file, size, source) {
  if (source) {
    return renderSourceToPng(source, size, sourceRenderOptions(config, file));
  }
  return rasterizePrimitives(size, buildPrimitives(size, fileConfig(config, file)), { rgb: file.opaqueBackground });
}

function opaqueBackground(value) {
  const normalized = toHex(value || '#ffffff');
  return normalized === 'transparent' ? '#ffffff' : normalized;
}

function sourceRenderOptions(config, file) {
  const background = file.opaqueBackground ? opaqueBackground(config.mark?.background) : null;
  return { background };
}

function sourceVariantKey(config, file, source) {
  return `${source?.path || 'generated'}:${JSON.stringify(sourceRenderOptions(config, file))}`;
}

function pngCacheKey(config, file, size, source) {
  const sourceMode = source ? 'source' : 'generated';
  if (source) return `${sourceMode}:${sourceVariantKey(config, file, source)}:${size}`;
  const backgroundMode = file.transparentBackground ? 'transparent' : 'default';
  const opaqueMode = file.opaqueBackground ? 'opaque' : 'preserve-alpha';
  const markMode = file.mark ? JSON.stringify(file.mark) : 'default';
  return `${sourceMode}:${backgroundMode}:${opaqueMode}:${markMode}:${size}`;
}

function rasterSizes(file) {
  if (file.format === 'png') return [file.size];
  if (file.format === 'ico' || file.format === 'icns') return file.sizes;
  return [];
}

const SOURCE_MASTER_SIZE = Math.max(
  1024,
  ...Object.values(TARGETS).flatMap((target) => target.files.flatMap(rasterSizes)),
);

function sourceForFile(sources, file) {
  if (file.role === 'adaptive-foreground') return sources.adaptiveForeground || sources.default;
  return sources.default;
}

function createRenderer(config, sources) {
  const pngCache = new Map();
  const sourceMasters = new Map();

  function sourcePng(file, size, source) {
    const variant = sourceVariantKey(config, file, source);
    let master = sourceMasters.get(variant);
    if (!master) {
      const masterSize = Math.max(size, SOURCE_MASTER_SIZE);
      master = renderSourceToPixels(source, masterSize, sourceRenderOptions(config, file));
      sourceMasters.set(variant, master);
      const encoded = file.opaqueBackground
        ? encodeRgbPng(master.width, master.height, master.pixels)
        : master.png;
      pngCache.set(pngCacheKey(config, file, masterSize, source), encoded);
    }
    if (size === master.width && size === master.height) {
      return pngCache.get(pngCacheKey(config, file, size, source));
    }
    const pixels = resizeRgba(master.width, master.height, master.pixels, size, size);
    return file.opaqueBackground ? encodeRgbPng(size, size, pixels) : encodePng(size, size, pixels);
  }

  function cachedPng(file, size) {
    const source = sourceForFile(sources, file);
    const key = pngCacheKey(config, file, size, source);
    if (!pngCache.has(key)) pngCache.set(key, source ? sourcePng(file, size, source) : renderPng(config, file, size, source));
    return pngCache.get(key);
  }
  return (file) => renderFile(config, file, sourceForFile(sources, file), cachedPng);
}

function renderFile(config, file, source, renderCachedPng = (pngFile, size) => renderPng(config, pngFile, size, source)) {
  if (file.format === 'json') return `${JSON.stringify(file.contents, null, 2)}\n`;
  if (file.format === 'svg') return source ? renderSourceToSvg(source, file.size) : renderSvg(fileConfig(config, file), { size: file.size });
  if (file.format === 'png') return renderCachedPng(file, file.size);
  if (file.format === 'ico') {
    return encodeIco(file.sizes.map((size) => ({ size, png: renderCachedPng(file, size) })));
  }
  if (file.format === 'icns') {
    return encodeIcns(file.sizes.map((size) => ({ size, png: renderCachedPng(file, size) })));
  }
  throw new Error(`Unsupported icon output format: ${file.format}`);
}

function previewPath(cwd, opts) {
  const rel = opts.outDir ? path.join(opts.outDir, 'icon-preview.html') : 'icon-preview.html';
  return path.resolve(cwd, rel);
}

function addSourceWarnings(source, targets, warnings) {
  if (!source || source.type !== 'png') return;
  const label = source.role === 'adaptive-foreground' ? 'adaptive-foreground source PNG' : 'source PNG';
  if (source.width !== source.height) {
    warnings.push({
      code: 'non-square-source',
      message: `${label} is ${source.width}x${source.height}; outputs use contain scaling on square canvases`,
    });
  }
  const requestedSizes = targets.flatMap((target) => TARGETS[target].files.flatMap((file) => (
    file.size ? [file.size] : file.sizes || []
  )));
  const largest = requestedSizes.length ? Math.max(...requestedSizes) : 0;
  if (largest && source.width < largest && source.height < largest) {
    warnings.push({
      code: 'source-upscaled',
      message: `${label} is ${source.width}x${source.height} and will be upscaled for ${largest}x${largest} output`,
    });
  }
}

function addAppleWarnings(config, targets, warnings) {
  if (targets.includes('apple') && parseHexColor(config.mark?.background).a < 255) {
    warnings.push({
      code: 'apple-background-defaulted',
      message: `Apple app icons require an opaque canvas; ${config.mark?.background || 'transparent'} is flattened to ${opaqueBackground(config.mark?.background)}`,
    });
  }
}

function sourceSummary(source) {
  if (!source) return null;
  return {
    path: source.path,
    type: source.type,
    role: source.role,
    width: source.width,
    height: source.height,
  };
}

function sourceConfigObject(source) {
  if (!source) return {};
  if (typeof source === 'string') return { default: source };
  return { ...source };
}

function applySourceOverrides(config, opts) {
  if (!opts.source && !opts.adaptiveSource) return config;
  const source = sourceConfigObject(config.mark?.source || config.source);
  if (opts.source) source.default = opts.source;
  if (opts.adaptiveSource) source.adaptiveForeground = opts.adaptiveSource;
  return mergeConfig(config, { mark: { source } });
}

function prepareAppleContext(cwd, opts, config, warnings, discovery) {
  const scanned = projectScan(cwd, discovery);
  const appIconSet = resolveAppleAppIconSet(cwd, config, warnings, scanned);
  const catalog = opts.outDir
    ? path.resolve(cwd, opts.outDir, 'apple', 'Assets.xcassets')
    : resolveAppleAssetCatalog(cwd, config, warnings, scanned);
  assertSafeOutputPath(cwd, path.join(catalog, `${appIconSet}.appiconset`, 'Contents.json'));
  const generatedContents = TARGETS.apple.files.find((file) => file.format === 'json').contents;
  const contents = mergeAppleContents(catalog, appIconSet, generatedContents);
  return { appIconSet, catalog, contents };
}

function prepareCompileContext(inputConfig, opts) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const presetTargets = opts.targets?.length ? opts.targets : inputConfig?.targets || [];
  const loaded = inputConfig
    ? mergeConfig(defaultConfig(cwd, presetTargets), inputConfig)
    : loadConfig(cwd, opts.config, opts.targets || []).config;
  const config = applySourceOverrides(loaded, opts);
  const discovery = {};
  const targets = resolveTargets(opts.targets || [], cwd, config.targets, discovery);
  const warnings = validateConfig(config);
  addAppleWarnings(config, targets, warnings);
  const sources = {
    default: loadSource(cwd, config),
    adaptiveForeground: targets.includes('expo') ? loadSource(cwd, config, 'adaptive-foreground') : null,
  };
  if (opts.placeholder && sources.default) {
    const err = new Error('icon-maker: --placeholder cannot be used when config already provides mark.source');
    err.exitCode = 2;
    throw err;
  }
  const sourceMode = resolveSourceMode(sources.default, config, opts);
  if (sourceMode === 'placeholder') {
    warnings.push({
      code: 'placeholder-source',
      message: 'using the deterministic placeholder mark; replace it with an approved SVG or PNG before distribution',
    });
  }
  addSourceWarnings(sources.default, targets, warnings);
  addSourceWarnings(sources.adaptiveForeground, ['expo'], warnings);
  if (targets.includes('expo') && sources.default && !sources.adaptiveForeground) {
    warnings.push({
      code: 'adaptive-source-missing',
      message: 'Expo adaptive-icon foreground is reusing the default source; provide --adaptive-source or mark.source.adaptiveForeground for a transparent foreground',
    });
  }
  const targetContexts = new Map();
  if (targets.includes('apple')) targetContexts.set('apple', prepareAppleContext(cwd, opts, config, warnings, discovery));
  return {
    cwd,
    opts,
    config,
    targets,
    warnings,
    sources,
    sourceMode,
    targetContexts,
    write: opts.write !== false,
  };
}

function buildOutputPlan(context) {
  const { cwd, opts, sources, targetContexts, targets, write } = context;
  const plans = [];

  for (const target of targets) {
    const def = TARGETS[target];
    for (const file of def.files) {
      const effectiveFile = target === 'apple' && file.format === 'json'
        ? { ...file, contents: targetContexts.get('apple').contents }
        : file;
      const absolutePath = outputPath(cwd, opts, target, file.path, targetContexts);
      assertSafeOutputPath(cwd, absolutePath);
      for (const source of Object.values(sources)) {
        if (source && sameFilePath(source.path, absolutePath)) {
          const err = new Error(`icon-maker: refusing to overwrite source file with generated output: ${absolutePath}`);
          err.exitCode = 2;
          throw err;
        }
      }
      plans.push({ target, def, file, effectiveFile, absolutePath });
    }
  }

  const plannedPreview = write && opts.preview ? previewPath(cwd, opts) : null;
  if (plannedPreview) {
    assertSafeOutputPath(cwd, plannedPreview);
    for (const source of Object.values(sources)) {
      if (source && sameFilePath(source.path, plannedPreview)) {
        const err = new Error(`icon-maker: refusing to overwrite source file with preview output: ${plannedPreview}`);
        err.exitCode = 2;
        throw err;
      }
    }
  }
  return { plans, plannedPreview };
}

function renderOutputPlan(context, plans) {
  const render = createRenderer(context.config, context.sources);
  const renderedPlans = plans.map((plan) => ({ ...plan, contents: contentBuffer(render(plan.effectiveFile)) }));
  const outputsByPath = new Map();
  for (const plan of renderedPlans) {
    const previous = outputsByPath.get(plan.absolutePath);
    if (previous && !previous.contents.equals(plan.contents)) {
      const err = new Error(
        `icon-maker: ${previous.target} and ${plan.target} produce different files at ${plan.absolutePath}; ` +
        'use --out-dir to isolate target outputs',
      );
      err.exitCode = 2;
      throw err;
    }
    if (!previous) outputsByPath.set(plan.absolutePath, plan);
  }
  return renderedPlans;
}

function writeOutputPlan(context, renderedPlans, plannedPreview) {
  const { config, cwd, opts, targets, warnings, write } = context;
  const produced = [];
  for (const plan of renderedPlans) {
    const written = write ? writeFileIfChanged(plan.absolutePath, plan.contents) : false;
    produced.push({
      target: plan.target,
      label: plan.def.label,
      path: plan.absolutePath,
      format: plan.file.format,
      size: plan.file.size,
      sizes: plan.file.sizes,
      role: plan.file.role || null,
      written,
    });
  }

  const patches = write && opts.patch ? applyPatches(cwd, targets, produced, warnings) : [];
  let preview = null;
  if (plannedPreview) {
    const written = writeFileIfChanged(plannedPreview, renderPreviewHtml(cwd, plannedPreview, config, produced));
    preview = { path: plannedPreview, format: 'html', written };
  }
  return { produced, patches, preview };
}

function makeIcons(inputConfig = null, opts = {}) {
  const context = prepareCompileContext(inputConfig, opts);
  const { plans, plannedPreview } = buildOutputPlan(context);
  const renderedPlans = renderOutputPlan(context, plans);
  const { produced, patches, preview } = writeOutputPlan(context, renderedPlans, plannedPreview);
  return {
    ok: true,
    cwd: context.cwd,
    targets: context.targets,
    sourceMode: context.sourceMode,
    source: sourceSummary(context.sources.default),
    sourceVariants: { adaptiveForeground: sourceSummary(context.sources.adaptiveForeground) },
    produced,
    patches,
    preview,
    warnings: context.warnings,
  };
}

module.exports = { makeIcons };
