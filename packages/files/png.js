// A PNG written, in Node: one IDAT chunk, deflated, no filtering. From rows of pixels, each [r, g, b] or
// [r, g, b, a] (with its alpha), or from RGBA bytes as a canvas or the machines' screens give them.
//
//   png(rows)                        a PNG's bytes from rows of [r, g, b] or [r, g, b, a]
//   pngOfRGBA(rgba, width, height, { alpha })   a PNG's bytes from RGBA bytes, four a pixel, row by row; alpha
//                                    false, written as RGB, its alpha left out (a picture with none to show)
//   sheet(pictures, { across, gap, scale })   pictures (rows) on one sheet, `gap` gray dots between
//   padded(pictures, fill)           pictures of different sizes padded to the largest, top left
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
}

// (the rows as PNG wants them, each a filter byte, 0, then its pixels; n bytes a pixel, 3 or 4)
function encode(raw, w, h, n) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, n === 4 ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function png(pixels) {
  const h = pixels.length, w = pixels[0].length, n = pixels[0][0].length;
  const raw = Buffer.alloc(h * (w * n + 1));
  pixels.forEach((row, y) => row.forEach((c, x) => raw.set(c, y * (w * n + 1) + 1 + x * n)));
  return encode(raw, w, h, n);
}

export function pngOfRGBA(rgba, w, h, { alpha = true } = {}) {
  const n = alpha ? 4 : 3, raw = Buffer.alloc(h * (w * n + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + n), y * (w * n + 1) + 1 + x * n);
  return encode(raw, w, h, n);
}

// Pictures scaled by `scale`, with `gap` gray dots between them, `across` to a row.
export function sheet(pictures, { across = 3, gap = 8, scale = 1 } = {}) {
  const GRAY = [60, 60, 60];
  const w = pictures[0][0].length * scale, h = pictures[0].length * scale;
  const out = [];
  for (let r = 0; r * across < pictures.length; r++) {
    if (r) for (let g = 0; g < gap; g++) out.push(Array((w + gap) * across - gap).fill(GRAY));
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let c = 0; c < across; c++) {
        if (c) for (let g = 0; g < gap; g++) row.push(GRAY);
        const p = pictures[r * across + c];
        if (!p) { for (let x = 0; x < w; x++) row.push(GRAY); continue; }
        for (const px of p[Math.floor(y / scale)]) for (let s = 0; s < scale; s++) row.push(px);
      }
      out.push(row);
    }
  }
  return png(out);
}

export function padded(pictures, fill = [60, 60, 60]) {
  const w = Math.max(...pictures.map(p => p[0].length)), h = Math.max(...pictures.map(p => p.length));
  return pictures.map(p => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (p[y] && p[y][x]) || fill)));
}
