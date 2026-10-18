// An Apple II hi-res or double hi-res screen as a picture, in Node: the screen drawn as the machine draws it
// (screen.js: paintHires, and colors with COLORS), 560 by 384, then as a PNG (@moonbase-machines/files/png.js), RGB:
// a screen has nothing to show through.
// A screen shorter than its 8,192 bytes, as a file saved short, reads as zeros after its end.
//
//   picture(screen)              a hi-res screen's PNG
//   doublePicture(aux, main)     a double hi-res screen's PNG, from its auxiliary and main halves
//   rows(screen)                 its pixels as rows of [r, g, b], for a sheet of pictures (files/png.js sheet)
//   doubleRows(aux, main)        the same of a double hi-res screen
//   colorRows(grid)              rows of double hi-res colors, 0 to 15 (a screen's 140 by 192, an object's own size),
//                                as pixels: each color four wide and two high, as the screen shows it
import { paintHires, colors, COLORS } from './screen.js';
import { pngOfRGBA, png } from '@moonbase-machines/files/png.js';

const W = 560, H = 384;
const hires = screen => paintHires(new Uint8Array(W * H * 4), screen);

export function colorRows(grid) {
  const out = [];
  for (const r of grid) { const row = []; for (const c of r) row.push(COLORS[c], COLORS[c], COLORS[c], COLORS[c]); out.push(row, row); }
  return out;
}
// (a double hi-res screen's 140 by 192 colors, as the machine reads them from its two halves)
const grid = (aux, main) => { const c = colors(aux, main); return Array.from({ length: 192 }, (_, y) => Array.from(c.subarray(y * 140, (y + 1) * 140))); };

const asRows = rgba => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => [...rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)]));

export const picture = screen => pngOfRGBA(hires(screen), W, H, { alpha: false });
export const doublePicture = (aux, main) => png(doubleRows(aux, main));
export const rows = screen => asRows(hires(screen));
export const doubleRows = (aux, main) => colorRows(grid(aux, main));
