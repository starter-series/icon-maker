const zlib = require('zlib');
const { crc32, PNG_SIGNATURE } = require('./png');

const CHANNELS = new Map([
  [0, 1],
  [2, 3],
  [3, 1],
  [4, 2],
  [6, 4],
]);

const LEGAL_BIT_DEPTHS = new Map([
  [0, new Set([1, 2, 4, 8, 16])],
  [2, new Set([8, 16])],
  [3, new Set([1, 2, 4, 8])],
  [4, new Set([8, 16])],
  [6, new Set([8, 16])],
]);

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

const KNOWN_CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

function passSize(total, start, step) {
  return total <= start ? 0 : Math.ceil((total - start) / step);
}

function scanlineLayout(width, height, bitsPerPixel, interlaceMethod) {
  const passes = interlaceMethod === 0
    ? [[0, 0, 1, 1]]
    : ADAM7;
  return passes.map(([x, y, dx, dy]) => {
    const passWidth = passSize(width, x, dx);
    const passHeight = passSize(height, y, dy);
    return {
      width: passWidth,
      height: passHeight,
      rowBytes: Math.ceil((passWidth * bitsPerPixel) / 8),
    };
  }).filter((pass) => pass.width && pass.height);
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function unfilterRows(raw, width, height, bytesPerPixel) {
  const rowBytes = width * bytesPerPixel;
  const pixels = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let row = 0; row < height; row++) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    const rowOffset = row * rowBytes;
    for (let column = 0; column < rowBytes; column++) {
      const encoded = raw[sourceOffset + column];
      const left = column >= bytesPerPixel ? pixels[rowOffset + column - bytesPerPixel] : 0;
      const above = row > 0 ? pixels[rowOffset - rowBytes + column] : 0;
      const upperLeft = row > 0 && column >= bytesPerPixel
        ? pixels[rowOffset - rowBytes + column - bytesPerPixel]
        : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      pixels[rowOffset + column] = (encoded + predictor) & 0xff;
    }
    sourceOffset += rowBytes;
  }
  return pixels;
}

function inspectPng(buffer) {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { valid: false, reason: 'signature' };
  }

  let offset = PNG_SIGNATURE.length;
  let ihdr = null;
  let sawIdat = false;
  let idatEnded = false;
  let sawIend = false;
  let sawPlte = false;
  let plteEntries = 0;
  const idat = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) return { valid: false, reason: 'truncated chunk' };
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) return { valid: false, reason: 'truncated chunk data' };
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    if (crc32([type, buffer.subarray(dataStart, dataEnd)]) !== expectedCrc) {
      return { valid: false, reason: 'CRC mismatch' };
    }

    const name = type.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(name)) return { valid: false, reason: 'chunk type' };
    if (name[0] === name[0].toUpperCase() && !KNOWN_CRITICAL_CHUNKS.has(name)) {
      return { valid: false, reason: `unknown critical chunk ${name}` };
    }
    if (!ihdr) {
      if (name !== 'IHDR' || length !== 13) return { valid: false, reason: 'IHDR' };
      ihdr = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        compressionMethod: buffer[dataStart + 10],
        filterMethod: buffer[dataStart + 11],
        interlaceMethod: buffer[dataStart + 12],
      };
    } else if (name === 'IHDR') {
      return { valid: false, reason: 'duplicate IHDR' };
    }

    if (name === 'PLTE') {
      if (sawPlte || sawIdat) return { valid: false, reason: 'PLTE order' };
      if (!length || length > 768 || length % 3 !== 0) return { valid: false, reason: 'PLTE length' };
      if ([0, 4].includes(ihdr.colorType)) return { valid: false, reason: 'PLTE color type' };
      plteEntries = length / 3;
      if (ihdr.colorType === 3 && plteEntries > 2 ** ihdr.bitDepth) {
        return { valid: false, reason: 'PLTE entries' };
      }
      sawPlte = true;
    }
    if (name === 'IDAT') {
      if (ihdr.colorType === 3 && !sawPlte) return { valid: false, reason: 'palette missing' };
      if (idatEnded) return { valid: false, reason: 'non-consecutive IDAT' };
      sawIdat = true;
      idat.push(buffer.subarray(dataStart, dataEnd));
    } else if (sawIdat && name !== 'IEND') {
      idatEnded = true;
    }
    if (name === 'IEND') {
      if (length !== 0 || chunkEnd !== buffer.length) return { valid: false, reason: 'IEND' };
      sawIend = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }

  if (!ihdr || !ihdr.width || !ihdr.height || !sawIdat || !sawIend || offset !== buffer.length) {
    return { valid: false, reason: 'required chunks' };
  }
  const channels = CHANNELS.get(ihdr.colorType);
  if (!channels || !LEGAL_BIT_DEPTHS.get(ihdr.colorType)?.has(ihdr.bitDepth)) {
    return { valid: false, reason: 'unsupported color type or bit depth' };
  }
  if (ihdr.compressionMethod !== 0 || ihdr.filterMethod !== 0 || ![0, 1].includes(ihdr.interlaceMethod)) {
    return { valid: false, reason: 'IHDR methods' };
  }
  if (ihdr.colorType === 3 && (!sawPlte || !plteEntries)) {
    return { valid: false, reason: 'palette missing' };
  }

  const bitsPerPixel = channels * ihdr.bitDepth;
  const layout = scanlineLayout(ihdr.width, ihdr.height, bitsPerPixel, ihdr.interlaceMethod);
  const expectedLength = layout.reduce((sum, pass) => sum + (pass.rowBytes + 1) * pass.height, 0);
  if (!Number.isSafeInteger(expectedLength) || expectedLength > 128 * 1024 * 1024) {
    return { valid: false, reason: 'decoded size limit' };
  }

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expectedLength + 1 });
  } catch (_err) {
    return { valid: false, reason: 'IDAT decode' };
  }
  if (raw.length !== expectedLength) return { valid: false, reason: 'scanline length' };

  let rawOffset = 0;
  for (const pass of layout) {
    for (let row = 0; row < pass.height; row++) {
      const filter = raw[rawOffset];
      if (filter > 4) return { valid: false, reason: 'scanline filter' };
      rawOffset += pass.rowBytes + 1;
    }
  }

  let hasTransparency = null;
  let hasVisiblePixels = null;
  if (ihdr.interlaceMethod === 0 && ihdr.bitDepth === 8 && (ihdr.colorType === 4 || ihdr.colorType === 6)) {
    const bytesPerPixel = channels;
    const pixels = unfilterRows(raw, ihdr.width, ihdr.height, bytesPerPixel);
    const alphaOffset = bytesPerPixel - 1;
    hasTransparency = false;
    hasVisiblePixels = false;
    for (let index = alphaOffset; index < pixels.length; index += bytesPerPixel) {
      if (pixels[index] < 255) hasTransparency = true;
      if (pixels[index] > 0) hasVisiblePixels = true;
      if (hasTransparency && hasVisiblePixels) break;
    }
  }

  return { valid: true, ...ihdr, hasTransparency, hasVisiblePixels };
}

module.exports = { inspectPng };
