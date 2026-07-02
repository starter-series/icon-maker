const fs = require('fs');
const path = require('path');
const { encodeIco, encodeIcns } = require('./containers');
const { defaultConfig, loadConfig, mergeConfig, validateConfig } = require('./config');
const { rasterizePrimitives } = require('./png');
const { renderPreviewHtml } = require('./preview');
const { loadSourceSvg, renderSourceSvgToPng } = require('./source');
const { renderSvg } = require('./svg');
const { buildPrimitives } = require('./mark');
const { TARGETS, resolveTargets } = require('./targets');
const { applyPatches } = require('./patch');

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function outputPath(cwd, opts, target, relativePath) {
  const rel = opts.outDir ? path.join(opts.outDir, target, relativePath) : relativePath;
  return path.resolve(cwd, rel);
}

function fileConfig(config, file) {
  if (!file.transparentBackground) return config;
  return mergeConfig(config, { mark: { background: 'transparent' } });
}

function renderPng(config, file, size, source) {
  if (source) return renderSourceSvgToPng(source.svg, size);
  return rasterizePrimitives(size, buildPrimitives(size, fileConfig(config, file)));
}

function renderFile(config, file, source) {
  if (file.format === 'svg') return source ? source.svg : renderSvg(fileConfig(config, file), { size: file.size });
  if (file.format === 'png') return renderPng(config, file, file.size, source);
  if (file.format === 'ico') {
    return encodeIco(file.sizes.map((size) => ({ size, png: renderPng(config, file, size, source) })));
  }
  if (file.format === 'icns') {
    return encodeIcns(file.sizes.map((size) => ({ size, png: renderPng(config, file, size, source) })));
  }
  throw new Error(`Unsupported icon output format: ${file.format}`);
}

function previewPath(cwd, opts) {
  const rel = opts.outDir ? path.join(opts.outDir, 'icon-preview.html') : 'icon-preview.html';
  return path.resolve(cwd, rel);
}

function makeIcons(inputConfig = null, opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const { config } = inputConfig ? { config: mergeConfig(defaultConfig(cwd), inputConfig) } : loadConfig(cwd, opts.config);
  const targets = resolveTargets(opts.targets || [], cwd, config.targets);
  const warnings = validateConfig(config);
  const source = loadSourceSvg(cwd, config);
  const produced = [];
  const write = opts.write !== false;

  for (const target of targets) {
    const def = TARGETS[target];
    for (const file of def.files) {
      const absolutePath = outputPath(cwd, opts, target, file.path);
      const contents = renderFile(config, file, source);
      if (write) {
        ensureDir(absolutePath);
        fs.writeFileSync(absolutePath, contents);
      }
      produced.push({
        target,
        label: def.label,
        path: absolutePath,
        format: file.format,
        size: file.size,
        sizes: file.sizes,
        role: file.role || null,
      });
    }
  }

  const patches = write && opts.patch ? applyPatches(cwd, targets, produced, warnings) : [];
  let preview = null;
  if (write && opts.preview) {
    const absolutePath = previewPath(cwd, opts);
    ensureDir(absolutePath);
    fs.writeFileSync(absolutePath, renderPreviewHtml(cwd, absolutePath, config, produced));
    preview = { path: absolutePath, format: 'html' };
  }
  return { ok: true, cwd, targets, produced, patches, preview, warnings };
}

module.exports = { makeIcons };
