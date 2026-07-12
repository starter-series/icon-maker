const fs = require('fs');
const path = require('path');
const { toHex } = require('./color');
const { assertContainedExistingPath } = require('./path-safety');
const { PNG_SIGNATURE, unpremultiplyRgba } = require('./png');

function sourcePathFromConfig(config, role = 'default') {
  const source = config.mark?.source || config.source;
  if (!source) return null;
  if (typeof source === 'string') return role === 'default' ? source : null;
  if (role === 'adaptive-foreground') return source.adaptiveForeground || source.adaptive || null;
  return source.default || source.path || source.svg || source.png || null;
}

function resolveSourcePath(cwd, sourcePath) {
  const absolutePath = path.resolve(cwd, sourcePath);
  return assertContainedExistingPath(cwd, absolutePath, 'mark.source');
}

function pngDimensions(buffer, absolutePath) {
  const hasHeader = buffer.length >= 24
    && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    && buffer.subarray(12, 16).toString('ascii') === 'IHDR';
  if (!hasHeader) {
    throw new Error(`icon-maker: source is not a valid PNG file: ${absolutePath}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) throw new Error(`icon-maker: source PNG has invalid dimensions: ${absolutePath}`);
  if (width > 16384 || height > 16384) {
    throw new Error(`icon-maker: source PNG dimensions exceed the 16384px safety limit: ${absolutePath}`);
  }
  return { width, height };
}

function unwrapSvgFence(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return text;
  const match = trimmed.match(/^```(?:svg|xml)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  if (!match) return null;
  return `${match[1].trim()}\n`;
}

function beginsWithSvg(text) {
  const normalized = text.replace(/^\uFEFF/, '').trimStart();
  return /^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[\s\S]*?>\s*)?<svg[\s>]/i.test(normalized);
}

function loadSource(cwd, config, role = 'default') {
  const sourcePath = sourcePathFromConfig(config, role);
  if (!sourcePath) return null;
  const absolutePath = resolveSourcePath(cwd, sourcePath);
  const buffer = fs.readFileSync(absolutePath);
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { type: 'png', role, path: absolutePath, buffer, ...pngDimensions(buffer, absolutePath) };
  }
  const text = buffer.toString('utf8');
  const svg = unwrapSvgFence(text);
  if (svg && beginsWithSvg(svg)) return { type: 'svg', role, path: absolutePath, svg };
  throw new Error(`icon-maker: source must be an SVG or PNG file: ${absolutePath}`);
}

function loadSourceSvg(cwd, config) {
  const source = loadSource(cwd, config);
  if (source && source.type !== 'svg') {
    throw new Error(`icon-maker: mark.source is not an SVG file: ${source.path}`);
  }
  return source;
}

function wrapSource(source, size, options = {}) {
  const mime = source.type === 'png' ? 'image/png' : 'image/svg+xml';
  const contents = source.type === 'png' ? source.buffer : Buffer.from(source.svg);
  const encoded = contents.toString('base64');
  const normalizedBackground = options.background
    ? options.background === 'transparent' ? '#ffffff' : toHex(options.background)
    : null;
  const opaqueBackground = normalizedBackground === 'transparent' ? '#ffffff' : normalizedBackground;
  const background = options.background
    ? `  <rect width="${size}" height="${size}" fill="${opaqueBackground}"/>\n`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${background}  <image x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${encoded}"/>
</svg>`;
}

function renderSourceToSvg(source, size) {
  return source.type === 'svg' ? source.svg : wrapSource(source, size);
}

function renderSourceToPng(source, size, options = {}) {
  return Buffer.from(renderSource(source, size, options).asPng());
}

function renderSource(source, size, options = {}) {
  let Resvg;
  try {
    ({ Resvg } = require('@resvg/resvg-js'));
  } catch (err) {
    throw new Error(`icon-maker: custom source PNG output needs @resvg/resvg-js (${err.message})`, { cause: err });
  }
  const resvg = new Resvg(wrapSource(source, size, options), {
    fitTo: { mode: 'width', value: size },
  });
  return resvg.render();
}

function renderSourceToPixels(source, size, options = {}) {
  const rendered = renderSource(source, size, options);
  return {
    width: rendered.width,
    height: rendered.height,
    pixels: unpremultiplyRgba(Buffer.from(rendered.pixels)),
    png: Buffer.from(rendered.asPng()),
  };
}

function renderSourceSvgToPng(svg, size) {
  return renderSourceToPng({ type: 'svg', svg }, size);
}

module.exports = {
  loadSource,
  loadSourceSvg,
  renderSourceToPng,
  renderSourceToPixels,
  renderSourceToSvg,
  renderSourceSvgToPng,
  sourcePathFromConfig,
};
