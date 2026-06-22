const fs = require('fs');
const path = require('path');

function sourcePathFromConfig(config) {
  const source = config.mark?.source || config.source;
  if (!source) return null;
  if (typeof source === 'string') return source;
  return source.path || source.svg || null;
}

function loadSourceSvg(cwd, config) {
  const sourcePath = sourcePathFromConfig(config);
  if (!sourcePath) return null;
  const absolutePath = path.resolve(cwd, sourcePath);
  const svg = fs.readFileSync(absolutePath, 'utf8');
  if (!/<svg[\s>]/i.test(svg)) throw new Error(`icon-maker: mark.source is not an SVG file: ${absolutePath}`);
  return { path: absolutePath, svg };
}

function renderSourceSvgToPng(svg, size) {
  let Resvg;
  try {
    ({ Resvg } = require('@resvg/resvg-js'));
  } catch (err) {
    throw new Error(`icon-maker: custom SVG PNG output needs @resvg/resvg-js (${err.message})`, { cause: err });
  }
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  return Buffer.from(resvg.render().asPng());
}

module.exports = { loadSourceSvg, renderSourceSvgToPng, sourcePathFromConfig };
