const zlib = require('zlib');
const { parseHexColor } = require('./color');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let crcTable = null;

function makeCrcTable() {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buffers) {
  if (!crcTable) crcTable = makeCrcTable();
  let crc = 0xffffffff;
  for (const buffer of buffers) {
    for (let i = 0; i < buffer.length; i++) {
      crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([typeBuffer, data]), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodeRawPng(width, height, pixels, channels, colorType) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodePng(width, height, rgba) {
  return encodeRawPng(width, height, rgba, 4, 6);
}

function encodeRgbPng(width, height, rgba, matte = { r: 255, g: 255, b: 255 }) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    const alpha = rgba[source + 3] / 255;
    rgb[target] = Math.round(rgba[source] * alpha + matte.r * (1 - alpha));
    rgb[target + 1] = Math.round(rgba[source + 1] * alpha + matte.g * (1 - alpha));
    rgb[target + 2] = Math.round(rgba[source + 2] * alpha + matte.b * (1 - alpha));
  }
  return encodeRawPng(width, height, rgb, 3, 2);
}

function blendPixel(rgba, width, x, y, color) {
  if (x < 0 || y < 0 || x >= width) return;
  const idx = (y * width + x) * 4;
  if (idx < 0 || idx >= rgba.length) return;
  const srcA = color.a / 255;
  if (srcA <= 0) return;
  const dstA = rgba[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  rgba[idx] = Math.round((color.r * srcA + rgba[idx] * dstA * (1 - srcA)) / outA);
  rgba[idx + 1] = Math.round((color.g * srcA + rgba[idx + 1] * dstA * (1 - srcA)) / outA);
  rgba[idx + 2] = Math.round((color.b * srcA + rgba[idx + 2] * dstA * (1 - srcA)) / outA);
  rgba[idx + 3] = Math.round(outA * 255);
}

function fillRect(rgba, width, height, primitive) {
  const color = parseHexColor(primitive.fill);
  const x0 = Math.max(0, Math.floor(primitive.x));
  const y0 = Math.max(0, Math.floor(primitive.y));
  const x1 = Math.min(width, Math.ceil(primitive.x + primitive.width));
  const y1 = Math.min(height, Math.ceil(primitive.y + primitive.height));
  const radius = Math.max(0, primitive.rx || 0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (radius) {
        const px = x + 0.5;
        const py = y + 0.5;
        const left = primitive.x + radius;
        const right = primitive.x + primitive.width - radius;
        const top = primitive.y + radius;
        const bottom = primitive.y + primitive.height - radius;
        const cx = px < left ? left : px > right ? right : px;
        const cy = py < top ? top : py > bottom ? bottom : py;
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      blendPixel(rgba, width, x, y, color);
    }
  }
}

function fillCircle(rgba, width, height, primitive) {
  const color = parseHexColor(primitive.fill);
  const r = primitive.r;
  const x0 = Math.max(0, Math.floor(primitive.cx - r));
  const y0 = Math.max(0, Math.floor(primitive.cy - r));
  const x1 = Math.min(width, Math.ceil(primitive.cx + r));
  const y1 = Math.min(height, Math.ceil(primitive.cy + r));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - primitive.cx;
      const dy = y + 0.5 - primitive.cy;
      if (dx * dx + dy * dy <= r * r) blendPixel(rgba, width, x, y, color);
    }
  }
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function fillPolygon(rgba, width, height, primitive) {
  const color = parseHexColor(primitive.fill);
  const xs = primitive.points.map((p) => p[0]);
  const ys = primitive.points.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(width, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(height, Math.ceil(Math.max(...ys)));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, primitive.points)) blendPixel(rgba, width, x, y, color);
    }
  }
}

function rasterizePrimitives(size, primitives, options = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  for (const primitive of primitives) {
    if (primitive.type === 'rect') fillRect(rgba, size, size, primitive);
    else if (primitive.type === 'circle') fillCircle(rgba, size, size, primitive);
    else if (primitive.type === 'polygon') fillPolygon(rgba, size, size, primitive);
  }
  return options.rgb ? encodeRgbPng(size, size, rgba) : encodePng(size, size, rgba);
}

function unpremultiplyRgba(rgba) {
  const output = Buffer.from(rgba);
  for (let index = 0; index < output.length; index += 4) {
    const alpha = output[index + 3];
    if (alpha === 0) {
      output[index] = 0;
      output[index + 1] = 0;
      output[index + 2] = 0;
    } else if (alpha < 255) {
      output[index] = Math.min(255, Math.round((output[index] * 255) / alpha));
      output[index + 1] = Math.min(255, Math.round((output[index + 1] * 255) / alpha));
      output[index + 2] = Math.min(255, Math.round((output[index + 2] * 255) / alpha));
    }
  }
  return output;
}

function resizeRgba(sourceWidth, sourceHeight, rgba, targetWidth, targetHeight) {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return Buffer.from(rgba);
  if (rgba.length !== sourceWidth * sourceHeight * 4) throw new Error('RGBA buffer size does not match its dimensions');
  const output = Buffer.alloc(targetWidth * targetHeight * 4);
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;

  for (let targetY = 0; targetY < targetHeight; targetY++) {
    const sourceY0 = targetY * scaleY;
    const sourceY1 = (targetY + 1) * scaleY;
    const startY = Math.floor(sourceY0);
    const endY = Math.min(sourceHeight, Math.ceil(sourceY1));
    for (let targetX = 0; targetX < targetWidth; targetX++) {
      const sourceX0 = targetX * scaleX;
      const sourceX1 = (targetX + 1) * scaleX;
      const startX = Math.floor(sourceX0);
      const endX = Math.min(sourceWidth, Math.ceil(sourceX1));
      let alphaWeight = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let area = 0;

      for (let sourceY = startY; sourceY < endY; sourceY++) {
        const yWeight = Math.min(sourceY1, sourceY + 1) - Math.max(sourceY0, sourceY);
        for (let sourceX = startX; sourceX < endX; sourceX++) {
          const xWeight = Math.min(sourceX1, sourceX + 1) - Math.max(sourceX0, sourceX);
          const weight = xWeight * yWeight;
          const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
          const alpha = rgba[sourceIndex + 3];
          area += weight;
          alphaWeight += alpha * weight;
          red += rgba[sourceIndex] * alpha * weight;
          green += rgba[sourceIndex + 1] * alpha * weight;
          blue += rgba[sourceIndex + 2] * alpha * weight;
        }
      }

      const targetIndex = (targetY * targetWidth + targetX) * 4;
      output[targetIndex + 3] = area ? Math.round(alphaWeight / area) : 0;
      if (alphaWeight) {
        output[targetIndex] = Math.round(red / alphaWeight);
        output[targetIndex + 1] = Math.round(green / alphaWeight);
        output[targetIndex + 2] = Math.round(blue / alphaWeight);
      }
    }
  }

  return output;
}

module.exports = {
  encodePng,
  encodeRgbPng,
  rasterizePrimitives,
  resizeRgba,
  unpremultiplyRgba,
  PNG_SIGNATURE,
};
