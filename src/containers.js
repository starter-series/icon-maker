function pngWidthByte(size) {
  return size >= 256 ? 0 : size;
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = pngWidthByte(image.size);
    entry[1] = pngWidthByte(image.size);
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

function icnsType(size) {
  if (size === 128) return 'ic07';
  if (size === 256) return 'ic08';
  if (size === 512) return 'ic09';
  if (size === 1024) return 'ic10';
  throw new Error(`Unsupported ICNS PNG size: ${size}`);
}

function encodeIcns(images) {
  const chunks = images.map((image) => {
    const payload = image.png;
    const chunk = Buffer.alloc(8 + payload.length);
    chunk.write(icnsType(image.size), 0, 4, 'ascii');
    chunk.writeUInt32BE(chunk.length, 4);
    payload.copy(chunk, 8);
    return chunk;
  });
  const total = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks], total);
}

module.exports = { encodeIco, encodeIcns };
