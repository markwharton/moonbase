// The double hi-res screen as pixels: 140 columns of 192 rows in sixteen colors, from the
// auxiliary and main halves of the page. Each column of 14 dots is the auxiliary byte's seven
// dots then the main byte's, and every four dots, first dot high, are one color.
import { COLORS } from './colors.js';
export { COLORS };

import { FONT } from '@moonbase/charset/font.js';

// the text page: 24 rows of 40 characters, a row's start being 0x400 * 0 + 0x80 * (r % 8) +
// 0x28 * (r / 8); in 80 columns the auxiliary bank holds the even columns
export const textRow = r => 0x400 + 0x80 * (r % 8) + 0x28 * ((r / 8) | 0);

// the text screen as pixels, 560 by 384, white on black: a character is 7 dots by 8 rows, its
// glyph 5 by 7 within, drawn two dots wide in 40 columns and one in 80. A code below $80 shows
// inverse, or flashes; here it is inverse.
export function paintText(rgba, main, aux, col80, rows = [0, 24]) {
  const cols = col80 ? 80 : 40, cw = col80 ? 7 : 14;
  for (let r = rows[0]; r < rows[1]; r++) for (let c = 0; c < cols; c++) {
    const a = textRow(r) + (col80 ? c >> 1 : c), code = col80 && !(c & 1) ? aux[a] : main[a];
    const inverse = !(code & 0x80), ch = (code & 0x7f) < 0x20 ? (code & 0x7f) + 0x40 : (code & 0x7f) === 0x7f ? 0x20 : code & 0x7f;
    const glyph = FONT[ch - 0x20] || FONT[0];
    for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 7; gx++) {
      const dot = gx >= 1 && gx <= 5 && gy < 7 ? (glyph[gx - 1] >> gy) & 1 : 0, on = dot !== (inverse ? 1 : 0);
      const v = on ? 255 : 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < cw / 7; dx++) { const o = ((r * 16 + gy * 2 + dy) * 560 + c * cw + gx * (cw / 7) + dx) * 4; rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255; }
    }
  }
  return rgba;
}

export const rowStart = y => 0x400 * (y % 8) + 0x80 * ((y >> 3) % 8) + 0x28 * (y >> 6);

// 192 rows of 140 color numbers
export function colors(aux, main, out = new Uint8Array(140 * 192)) {
  const dots = new Uint8Array(560);
  for (let y = 0; y < 192; y++) {
    const base = rowStart(y);
    let d = 0;
    for (let xb = 0; xb < 40; xb++) { let b = aux[base + xb]; for (let k = 0; k < 7; k++) dots[d++] = (b >> k) & 1; b = main[base + xb]; for (let k = 0; k < 7; k++) dots[d++] = (b >> k) & 1; }
    for (let x = 0; x < 140; x++) out[y * 140 + x] = dots[x * 4] << 3 | dots[x * 4 + 1] << 2 | dots[x * 4 + 2] << 1 | dots[x * 4 + 3];
  }
  return out;
}

// A single hi-res page as pixels, 560 by 384: 280 dots a row, seven a byte, low bit first, and
// the byte's high bit picking one of two pairs of colors. A lone dot on an even column is violet
// or blue, on an odd column green or orange, two side by side are white, and a dark dot between
// two lit dots takes their color. Each dot is two pixels wide and two high.
const PAIRS = [[[255, 68, 253], [20, 245, 60]], [[20, 207, 253], [255, 106, 60]]];
export function paintHires(rgba, page) {
  const dots = new Uint8Array(280), pal = new Uint8Array(280);
  for (let y = 0; y < 192; y++) {
    const base = rowStart(y);
    for (let xb = 0; xb < 40; xb++) { const b = page[base + xb]; for (let k = 0; k < 7; k++) { dots[xb * 7 + k] = (b >> k) & 1; pal[xb * 7 + k] = b >> 7; } }
    for (let x = 0; x < 280; x++) {
      const left = x > 0 && dots[x - 1], right = x < 279 && dots[x + 1];
      let c = [0, 0, 0];
      if (dots[x]) c = left || right ? [255, 255, 255] : PAIRS[pal[x]][x & 1];
      else if (left && right) c = PAIRS[pal[x]][(x + 1) & 1];
      for (let dy = 0; dy < 2; dy++) { let o = ((y * 2 + dy) * 560 + x * 2) * 4; for (let dx = 0; dx < 2; dx++) { rgba[o++] = c[0]; rgba[o++] = c[1]; rgba[o++] = c[2]; rgba[o++] = 255; } }
    }
  }
  return rgba;
}

// RGBA at four wide and two high a color, 560 by 384. With `owner`, who last changed each dot,
// a pixel is left clear, for the SVG under it to show, when one of its four dots was changed by
// the picture routine and none by anything since.
export function paint(cols, rgba, owner) {
  for (let y = 0; y < 192; y++) for (let x = 0; x < 140; x++) {
    const i = y * 140 + x, c = cols[i];
    let clear = false;
    if (owner) { const d = y * 560 + x * 4; let picture = false, other = false; for (let k = 0; k < 4; k++) { const o = owner[d + k]; if (o === 1) picture = true; else if (o === 2) other = true; } clear = picture && !other; }
    const [r, g, b] = COLORS[c];
    for (let dy = 0; dy < 2; dy++) { let o = ((y * 2 + dy) * 560 + x * 4) * 4; for (let dx = 0; dx < 4; dx++) { rgba[o++] = r; rgba[o++] = g; rgba[o++] = b; rgba[o++] = clear ? 0 : 255; } }
  }
  return rgba;
}

// The machine's screen as it shows now, 560 by 384, by its switches: double hi-res, single
// hi-res, or text, and the four rows of text under a mixed picture; `cols` to reuse, `owner` as
// paint's
export function screen(m, rgba = new Uint8ClampedArray(560 * 384 * 4), { cols, owner = null } = {}) {
  const s = m.screen(), text = m.sw.text;
  if (!text && m.sw.dhires && m.sw.col80) paint(colors(s.aux, s.main, cols), rgba, owner);
  else if (!text) paintHires(rgba, s.main);
  if (text || m.sw.mixed) paintText(rgba, m.main, m.aux, m.sw.col80, text ? [0, 24] : [20, 24]);
  return rgba;
}
