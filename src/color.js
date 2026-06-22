function parseHexColor(value, fallback = '#000000') {
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const raw = String(value || fallback).trim();
  const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    return {
      r: parseInt(normalized[0] + normalized[0], 16),
      g: parseInt(normalized[1] + normalized[1], 16),
      b: parseInt(normalized[2] + normalized[2], 16),
      a: 255,
    };
  }
  if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(normalized)) {
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
      a: normalized.length === 8 ? parseInt(normalized.slice(6, 8), 16) : 255,
    };
  }
  if (value !== fallback) return parseHexColor(fallback, '#000000');
  return { r: 0, g: 0, b: 0, a: 255 };
}

function toHex(color) {
  const c = typeof color === 'string' ? parseHexColor(color) : color;
  const pair = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  if (c.a === 0) return 'transparent';
  return `#${pair(c.r)}${pair(c.g)}${pair(c.b)}`;
}

function relativeLuminance(color) {
  const channel = (n) => {
    const v = n / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const c = typeof color === 'string' ? parseHexColor(color) : color;
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

module.exports = { parseHexColor, toHex, contrastRatio };
