const path = require('path');
const {
  mergeAppleContents,
  projectScan,
  resolveAppleAppIconSet,
  resolveAppleAssetCatalog,
  resolveAppleDeliveryMode,
} = require('./apple');
const { androidProjectScan, planAndroidIconFiles, resolveAndroidProject } = require('./android');
const { parseHexColor, toHex } = require('./color');
const { encodeIco, encodeIcns } = require('./containers');
const { defaultConfig, loadConfig, mergeConfig, validateConfig } = require('./config');
const { encodePng, encodeRgbPng, rasterizePrimitives, resizeRgba } = require('./png');
const { assertContainedOutputPath, sameRealFile } = require('./path-safety');
const { inspectPng } = require('./png-inspect');
const { renderPreviewHtml } = require('./preview');
const { planPwaIconFiles, resolvePwaManifest } = require('./pwa');
const { loadSource, renderSourceToPixels, renderSourceToPng, renderSourceToSvg } = require('./source');
const { renderSvg } = require('./svg');
const { buildPrimitives } = require('./mark');
const { TARGETS, resolveTargets } = require('./targets');
const { planPatches } = require('./patch');
const { commitWriteTransaction } = require('./write-transaction');
const { resolveSourceMode } = require('./workflow');

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
  if (target === 'pwa') {
    const context = targetContexts.get('pwa');
    const prefix = 'public/';
    if (!context?.publicRoot || !relativePath.startsWith(prefix)) {
      throw new Error(`invalid ${target} output path: ${relativePath}`);
    }
    return path.resolve(context.publicRoot, relativePath.slice(prefix.length));
  }
  if (target === 'android') {
    const context = targetContexts.get('android');
    if (!context) throw new Error(`missing ${target} output context`);
    return path.resolve(context.resDir, relativePath);
  }
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
  ...Object.values(TARGETS).flatMap((target) => (target.files || []).flatMap(rasterSizes)),
);

function sourceForFile(sources, file) {
  const role = file.sourceRole || file.role || 'default';
  if (role === 'adaptive-foreground') return sources.adaptiveForeground;
  if (role === 'maskable') return sources.maskable;
  if (role === 'round') return sources.round || sources.default;
  if (role === 'monochrome') return sources.monochrome;
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
  if (file.format === 'xml') return String(file.contents);
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

function addSourceWarnings(source, targets, warnings, explicitFiles = null) {
  if (!source || source.type !== 'png') return;
  const label = source.role === 'default' ? 'source PNG' : `${source.role} source PNG`;
  if (source.width !== source.height) {
    warnings.push({
      code: 'non-square-source',
      message: `${label} is ${source.width}x${source.height}; outputs use contain scaling on square canvases`,
    });
  }
  const files = explicitFiles || targets.flatMap((target) => TARGETS[target].files);
  const requestedSizes = files.flatMap((file) => (
    file.size ? [file.size] : file.sizes || []
  ));
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
  if (!opts.source && !opts.adaptiveSource && !opts.maskableSource && !opts.monochromeSource) return config;
  const source = sourceConfigObject(config.mark?.source || config.source);
  if (opts.source) source.default = opts.source;
  if (opts.adaptiveSource) source.adaptiveForeground = opts.adaptiveSource;
  if (opts.maskableSource) source.maskable = opts.maskableSource;
  if (opts.monochromeSource) source.monochrome = opts.monochromeSource;
  return mergeConfig(config, { mark: { source } });
}

function prepareAppleContext(cwd, opts, config, warnings, discovery) {
  const scanned = projectScan(cwd, discovery);
  const deliveryMode = resolveAppleDeliveryMode(cwd, config, warnings, scanned);
  if (deliveryMode === 'icon-composer') {
    const err = new Error(
      'icon-maker: Apple Icon Composer delivery uses the existing approved .icon artifact; ' +
      'run --check to verify it, or set apple.deliveryMode to legacy to compile an AppIcon asset catalog',
    );
    err.exitCode = 2;
    throw err;
  }
  const appIconSet = resolveAppleAppIconSet(cwd, config, warnings, scanned);
  const catalog = opts.outDir
    ? path.resolve(cwd, opts.outDir, 'apple', 'Assets.xcassets')
    : resolveAppleAssetCatalog(cwd, config, warnings, scanned);
  assertContainedOutputPath(cwd, path.join(catalog, `${appIconSet}.appiconset`, 'Contents.json'));
  const generatedContents = TARGETS.apple.files.find((file) => file.format === 'json').contents;
  const contents = mergeAppleContents(catalog, appIconSet, generatedContents);
  return { deliveryMode, appIconSet, catalog, contents };
}

function prepareAndroidContext(cwd, opts, config, discovery, sources) {
  const project = resolveAndroidProject(cwd, config, androidProjectScan(cwd, discovery));
  const manifest = path.resolve(cwd, project.relativeManifest);
  const resDir = path.join(path.dirname(manifest), 'res');
  const backgroundColor = config.android?.backgroundColor || opaqueBackground(config.mark?.background);
  const files = planAndroidIconFiles({
    ...(config.android || {}),
    backgroundColor,
    includeMonochrome: Boolean(sources.monochrome),
  });
  const outputRoot = opts.outDir
    ? path.resolve(cwd, opts.outDir, 'android')
    : resDir;
  assertContainedOutputPath(cwd, path.join(outputRoot, 'values', 'icon-maker-probe.xml'));
  return { ...project, manifest, resDir, backgroundColor, files };
}

function addWarningsOnce(warnings, additions) {
  for (const warning of additions) {
    if (!warnings.some((item) => item.code === warning.code && item.message === warning.message)) {
      warnings.push(warning);
    }
  }
}

function preparePwaContext(cwd, opts, config, warnings) {
  const diagnostics = [];
  const resolved = resolvePwaManifest(cwd, config, diagnostics);
  addWarningsOnce(
    warnings,
    diagnostics
      .filter((item) => item.severity === 'warning')
      .map(({ code, message }) => ({ code, message })),
  );
  const publicRoot = resolved.publicRoot || path.join(cwd, 'public');
  const outputRoot = opts.outDir
    ? path.resolve(cwd, opts.outDir, 'pwa', 'public')
    : publicRoot;
  assertContainedOutputPath(cwd, path.join(outputRoot, 'icon-maker-probe.png'));
  return { ...resolved, publicRoot };
}

function targetFiles(target, context) {
  if (target === 'android') return context.targetContexts.get('android').files;
  if (target === 'pwa') {
    return planPwaIconFiles({
      includeMaskable: Boolean(context.sources.maskable),
      includeMonochrome: Boolean(context.sources.monochrome),
    });
  }
  if (target === 'expo' && context.sources.monochrome) {
    return [
      ...TARGETS.expo.files,
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
  return TARGETS[target].files;
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
  const targetContexts = new Map();
  if (targets.includes('apple')) {
    targetContexts.set('apple', prepareAppleContext(cwd, opts, config, warnings, discovery));
  }
  const needsAdaptiveForeground = targets.includes('expo') || targets.includes('android');
  const sources = {
    default: loadSource(cwd, config),
    adaptiveForeground: needsAdaptiveForeground ? loadSource(cwd, config, 'adaptive-foreground') : null,
    maskable: targets.includes('pwa') ? loadSource(cwd, config, 'maskable') : null,
    round: targets.includes('android') ? loadSource(cwd, config, 'round') : null,
    monochrome: (targets.includes('android') || targets.includes('expo') || targets.includes('pwa'))
      ? loadSource(cwd, config, 'monochrome')
      : null,
  };
  if (opts.placeholder && Object.values(sources).some(Boolean)) {
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
  if (sourceMode === 'source' && needsAdaptiveForeground && !sources.adaptiveForeground) {
    const err = new Error(
      'icon-maker: Expo/Android source mode requires a transparent adaptive foreground; ' +
      'provide --adaptive-source or mark.source.adaptiveForeground',
    );
    err.exitCode = 2;
    throw err;
  }
  addSourceWarnings(sources.default, targets, warnings);
  if (sources.adaptiveForeground) addSourceWarnings(sources.adaptiveForeground, targets.filter((target) => target === 'expo' || target === 'android'), warnings);
  if (sources.maskable) {
    addSourceWarnings(
      sources.maskable,
      ['pwa'],
      warnings,
      planPwaIconFiles({ includeMaskable: true }).filter((file) => file.role === 'maskable'),
    );
  }
  if (sources.round) addSourceWarnings(sources.round, ['android'], warnings);
  if (sources.monochrome) addSourceWarnings(sources.monochrome, targets.filter((target) => target === 'expo' || target === 'android' || target === 'pwa'), warnings);
  if (targets.includes('android')) {
    targetContexts.set('android', prepareAndroidContext(cwd, opts, config, discovery, sources));
  }
  if (targets.includes('pwa')) targetContexts.set('pwa', preparePwaContext(cwd, opts, config, warnings));
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
    for (const file of targetFiles(target, context)) {
      const effectiveFile = target === 'apple' && file.format === 'json'
        ? { ...file, contents: targetContexts.get('apple').contents }
        : file;
      const absolutePath = outputPath(cwd, opts, target, file.path, targetContexts);
      assertContainedOutputPath(cwd, absolutePath);
      for (const source of Object.values(sources)) {
        if (source && sameRealFile(source.path, absolutePath)) {
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
    assertContainedOutputPath(cwd, plannedPreview);
    for (const source of Object.values(sources)) {
      if (source && sameRealFile(source.path, plannedPreview)) {
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
  for (const plan of renderedPlans) {
    if (plan.file.format !== 'png' || plan.file.transparentBackground !== true) continue;
    const inspected = inspectPng(plan.contents);
    if (!inspected.valid || inspected.colorType !== 6 || inspected.hasTransparency !== true) {
      const err = new Error(
        `icon-maker: ${plan.target} ${plan.file.role || 'foreground'} output must contain transparent pixels: ` +
        `${plan.absolutePath}`,
      );
      err.exitCode = 2;
      throw err;
    }
    if (inspected.hasVisiblePixels !== true) {
      const err = new Error(`icon-maker: ${plan.target} foreground output must contain visible pixels: ${plan.absolutePath}`);
      err.exitCode = 2;
      throw err;
    }
  }
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
  const { config, cwd, opts, targetContexts, targets, warnings, write } = context;
  const produced = renderedPlans.map((plan) => ({
    target: plan.target,
    label: plan.def.label,
    path: plan.absolutePath,
    format: plan.file.format,
    size: plan.file.size,
    sizes: plan.file.sizes,
    role: plan.file.role || null,
    sourceRole: plan.file.sourceRole || null,
    written: false,
  }));
  if (!write) return { produced, patches: [], preview: null };

  const patchPlan = opts.patch
    ? planPatches(cwd, targets, produced, warnings, { config, targetContexts })
    : { patches: [], writes: [] };
  const previewContents = plannedPreview
    ? renderPreviewHtml(cwd, plannedPreview, config, produced)
    : null;
  const writes = [
    ...renderedPlans.map((plan) => ({
      path: plan.absolutePath,
      contents: plan.contents,
      label: `${plan.target} output`,
    })),
    ...patchPlan.writes,
  ];
  if (plannedPreview) {
    writes.push({ path: plannedPreview, contents: previewContents, label: 'preview output' });
  }

  const results = commitWriteTransaction(cwd, writes);
  for (let index = 0; index < renderedPlans.length; index++) {
    produced[index].written = results[index].written;
  }
  const patchResults = results.slice(renderedPlans.length, renderedPlans.length + patchPlan.writes.length);
  const writtenPatches = new Set(
    patchResults.filter((result) => result.written).map((result) => result.path),
  );
  const patches = patchPlan.patches.filter((patch) => writtenPatches.has(path.resolve(patch.file)));
  const preview = plannedPreview
    ? { path: plannedPreview, format: 'html', written: results.at(-1).written }
    : null;
  return { produced, patches, preview };
}

function makeIcons(inputConfig = null, opts = {}) {
  const context = prepareCompileContext(inputConfig, opts);
  const { plans, plannedPreview } = buildOutputPlan(context);
  const renderedPlans = renderOutputPlan(context, plans);
  const { produced, patches, preview } = writeOutputPlan(context, renderedPlans, plannedPreview);
  return {
    schemaVersion: 1,
    kind: 'compile',
    ok: true,
    cwd: context.cwd,
    targets: context.targets,
    sourceMode: context.sourceMode,
    source: sourceSummary(context.sources.default),
    sourceVariants: {
      adaptiveForeground: sourceSummary(context.sources.adaptiveForeground),
      maskable: sourceSummary(context.sources.maskable),
      round: sourceSummary(context.sources.round),
      monochrome: sourceSummary(context.sources.monochrome),
    },
    produced,
    patches,
    preview,
    warnings: context.warnings,
  };
}

module.exports = { makeIcons };
