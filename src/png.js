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

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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

function rasterizePrimitives(size, primitives) {
  const rgba = Buffer.alloc(size * size * 4);
  for (const primitive of primitives) {
    if (primitive.type === 'rect') fillRect(rgba, size, size, primitive);
    else if (primitive.type === 'circle') fillCircle(rgba, size, size, primitive);
    else if (primitive.type === 'polygon') fillPolygon(rgba, size, size, primitive);
  }
  return encodePng(size, size, rgba);
}

module.exports = { encodePng, rasterizePrimitives, PNG_SIGNATURE };
