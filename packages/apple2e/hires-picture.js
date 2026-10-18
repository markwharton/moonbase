// An Apple II hi-res or double hi-res screen as a picture, in Node: the screen drawn as the machine draws it
// (screen.js: paintHires, and colors with COLORS), 560 by 384, then as a PNG (@moonbase-machines/files/png.js).
// A screen shorter than its 8,192 bytes, as a file saved short, reads as zeros after its end.
//
//   picture(screen)              a hi-res screen's PNG
//   doublePicture(aux, main)     a double hi-res screen's PNG, from its auxiliary and main halves
//   rows(screen)                 its pixels as rows of [r, g, b], for a sheet of pictures (files/png.js sheet)
//   doubleRows(aux, main)        the same of a double hi-res screen
import { paintHires, colors, COLORS } from './screen.js';
import { pngOfRGBA } from '@moonbase-machines/files/png.js';

const W = 560, H = 384;
const hires = screen => paintHires(new Uint8Array(W * H * 4), screen);

// (double hi-res: each of its 140 colours a column four pixels wide, each row two high)
function double(aux, main) {
  const c = colors(aux, main), rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = COLORS[c[(y >> 1) * 140 + (x >> 2)]]; rgba.set([r, g, b, 255], (y * W + x) * 4); }
  return rgba;
}

const asRows = rgba => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => [...rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)]));

export const picture = screen => pngOfRGBA(hires(screen), W, H);
export const doublePicture = (aux, main) => pngOfRGBA(double(aux, main), W, H);
export const rows = screen => asRows(hires(screen));
export const doubleRows = (aux, main) => asRows(double(aux, main));
