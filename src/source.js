const fs = require('fs');
const path = require('path');

function sourcePathFromConfig(config) {
  const source = config.mark?.source || config.source;
  if (!source) return null;
  if (typeof source === 'string') return source;
  return source.path || source.svg || null;
}

function isInsideDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveSourcePath(cwd, sourcePath) {
  const root = fs.realpathSync(cwd);
  const absolutePath = path.resolve(cwd, sourcePath);
  const realPath = fs.realpathSync(absolutePath);
  if (!isInsideDirectory(root, realPath)) {
    throw new Error(`icon-maker: mark.source must stay inside the target directory: ${absolutePath}`);
  }
  return realPath;
}

function loadSourceSvg(cwd, config) {
  const sourcePath = sourcePathFromConfig(config);
  if (!sourcePath) return null;
  const absolutePath = resolveSourcePath(cwd, sourcePath);
  const svg = fs.readFileSync(absolutePath, 'utf8');
  if (!/<svg[\s>]/i.test(svg)) throw new Error(`icon-maker: mark.source is not an SVG file: ${absolutePath}`);
  return { path: absolutePath, svg };
}

function wrapSourceSvg(svg, size) {
  const encoded = Buffer.from(svg).toString('base64');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <image x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="data:image/svg+xml;base64,${encoded}"/>
</svg>`;
}

function renderSourceSvgToPng(svg, size) {
  let Resvg;
  try {
    ({ Resvg } = require('@resvg/resvg-js'));
  } catch (err) {
    throw new Error(`icon-maker: custom SVG PNG output needs @resvg/resvg-js (${err.message})`, { cause: err });
  }
  const resvg = new Resvg(wrapSourceSvg(svg, size), {
    fitTo: { mode: 'width', value: size },
  });
  return Buffer.from(resvg.render().asPng());
}

module.exports = { loadSourceSvg, renderSourceSvgToPng, sourcePathFromConfig };
