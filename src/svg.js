const { buildPrimitives } = require('./mark');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function primitiveToSvg(primitive) {
  if (primitive.type === 'rect') {
    return `<rect x="${primitive.x}" y="${primitive.y}" width="${primitive.width}" height="${primitive.height}" rx="${primitive.rx || 0}" fill="${escapeXml(primitive.fill)}"/>`;
  }
  if (primitive.type === 'circle') {
    return `<circle cx="${primitive.cx}" cy="${primitive.cy}" r="${primitive.r}" fill="${escapeXml(primitive.fill)}"/>`;
  }
  if (primitive.type === 'polygon') {
    const points = primitive.points.map((p) => `${p[0]},${p[1]}`).join(' ');
    return `<polygon points="${points}" fill="${escapeXml(primitive.fill)}"/>`;
  }
  return '';
}

function renderSvg(config, opts = {}) {
  const size = opts.size || 1024;
  const title = escapeXml(config.project?.name || 'Icon Maker icon');
  const primitives = buildPrimitives(size, config).map(primitiveToSvg).join('\n  ');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${title}">`,
    `  <title>${title}</title>`,
    `  ${primitives}`,
    '</svg>',
    '',
  ].join('\n');
}

module.exports = { renderSvg };
