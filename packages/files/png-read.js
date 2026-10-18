// A PNG read, in Node: its size and each pixel's colour as six hex digits, for pictures such as
// c64gfx's (paletted, 1 to 8 bits a pixel) and ordinary ones (RGB or RGBA, 8 bits a channel).
//
//   readPng(bytes)   { width, height, palette (hex strings, or null), at(x, y) -> 'rrggbb' }
import { inflateSync } from 'node:zlib';

export function readPng(b) {
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let i = 8, width, height, depth, type, palette = null;
  const idat = [];
  while (i < b.length) {
    const n = b.readUInt32BE(i), t = b.toString('ascii', i + 4, i + 8), d = b.subarray(i + 8, i + 8 + n);
    if (t === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); depth = d[8]; type = d[9]; if (d[12]) throw new Error('an interlaced PNG'); }
    if (t === 'PLTE') { palette = []; for (let k = 0; k < n; k += 3) palette.push(d.subarray(k, k + 3).toString('hex')); }
    if (t === 'IDAT') idat.push(d);
    i += 12 + n;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || (type !== 3 && depth !== 8)) throw new Error(`a PNG of type ${type}, depth ${depth}: not read here`);
  const raw = inflateSync(Buffer.concat(idat)), bpp = Math.max(1, (channels * depth) >> 3), stride = Math.ceil(width * channels * depth / 8);
  const out = Buffer.alloc(stride * height);
  // (each row unfiltered: none, sub, up, average, Paeth)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = out.subarray(y * stride, (y + 1) * stride), up = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, u = up ? up[x] : 0, c = up && x >= bpp ? up[x - bpp] : 0;
      const p = a + u - c, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c);
      row[x] = (src[x] + [0, a, u, (a + u) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? u : c][f]) & 0xff;
    }
  }
  const hex = (r, g, bl) => ((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0');
  const at = (x, y) => {
    const row = y * stride;
    if (type === 3) { const bit = x * depth, v = (out[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1); return palette[v]; }
    const p = row + x * channels;
    return channels >= 3 ? hex(out[p], out[p + 1], out[p + 2]) : hex(out[p], out[p], out[p]);
  };
  return { width, height, palette, at };
}
