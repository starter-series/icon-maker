function clamp01(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function addBackground(primitives, size, mark) {
  const background = mark.background || '#111827';
  const shape = mark.shape || 'squircle';
  const inset = Math.round(size * clamp01(mark.backgroundInset, 0));
  const box = size - inset * 2;
  if (shape === 'circle') {
    primitives.push({ type: 'circle', cx: size / 2, cy: size / 2, r: box / 2, fill: background });
    return;
  }
  const rx = shape === 'square' ? 0 : Math.round(box * clamp01(mark.radius, 0.24));
  primitives.push({ type: 'rect', x: inset, y: inset, width: box, height: box, rx, fill: background });
}

function addSpark(primitives, size, mark) {
  const accent = mark.accent || '#38bdf8';
  const foreground = mark.foreground || '#f8fafc';
  const cx = size / 2;
  const cy = size / 2;
  const big = size * 0.155;
  const small = size * 0.06;
  primitives.push({
    type: 'polygon',
    fill: accent,
    points: [
      [cx, cy - big],
      [cx + big * 0.48, cy],
      [cx, cy + big],
      [cx - big * 0.48, cy],
    ],
  });
  primitives.push({ type: 'circle', cx: size * 0.32, cy: size * 0.32, r: small, fill: foreground });
  primitives.push({ type: 'circle', cx: size * 0.68, cy: size * 0.68, r: small * 0.72, fill: foreground });
}

function addBolt(primitives, size, mark) {
  const foreground = mark.foreground || '#f8fafc';
  primitives.push({
    type: 'polygon',
    fill: foreground,
    points: [
      [size * 0.56, size * 0.18],
      [size * 0.31, size * 0.53],
      [size * 0.48, size * 0.53],
      [size * 0.41, size * 0.82],
      [size * 0.69, size * 0.43],
      [size * 0.52, size * 0.43],
    ],
  });
}

function addBraces(primitives, size, mark) {
  const foreground = mark.foreground || '#f8fafc';
  const accent = mark.accent || '#38bdf8';
  const stroke = Math.round(size * 0.078);
  const arm = Math.round(size * 0.13);
  const top = Math.round(size * 0.27);
  const middle = Math.round(size * 0.49);
  const bottom = Math.round(size * 0.71);
  const left = Math.round(size * 0.28);
  const right = Math.round(size * 0.72);
  const rx = Math.max(1, Math.round(stroke / 2));

  const rect = (x, y, width, height, fill = foreground) => {
    primitives.push({ type: 'rect', x, y, width, height, rx, fill });
  };

  rect(left, top, stroke, bottom - top);
  rect(left, top, arm, stroke);
  rect(left, middle - stroke / 2, arm * 0.86, stroke);
  rect(left, bottom - stroke, arm, stroke);

  rect(right - stroke, top, stroke, bottom - top);
  rect(right - arm, top, arm, stroke);
  rect(right - arm * 0.86, middle - stroke / 2, arm * 0.86, stroke);
  rect(right - arm, bottom - stroke, arm, stroke);

  const cx = size / 2;
  const cy = size / 2;
  const diamond = size * 0.075;
  primitives.push({
    type: 'polygon',
    fill: accent,
    points: [
      [cx, cy - diamond],
      [cx + diamond, cy],
      [cx, cy + diamond],
      [cx - diamond, cy],
    ],
  });
}

function buildPrimitives(size, config) {
  const mark = config.mark || {};
  const primitives = [];
  addBackground(primitives, size, mark);
  const glyph = String(mark.glyph || 'braces').toLowerCase();
  if (glyph === 'spark' || glyph === 'star') addSpark(primitives, size, mark);
  else if (glyph === 'bolt' || glyph === 'lightning') addBolt(primitives, size, mark);
  else addBraces(primitives, size, mark);
  return primitives;
}

module.exports = { buildPrimitives };
