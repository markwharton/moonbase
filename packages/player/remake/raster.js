// The original's screen, dot for dot, for the scenes that read it back. PROB6 steers Helen's car by
// the colors of the dots ahead of it, so the remake must know what the original's screen shows
// there, whatever the view draws. The raster is 192 rows of 140 colors, painted by each step as the
// original's routines paint the double hi-res screen, and read by read-dot. The view never sees it.
import { screen, draw, line as lineDots } from '@moonbase-machines/vector/draw.js';
import { put } from '@moonbase-machines/vector/objects.js';
import { width, dots } from '@moonbase-machines/vector/font.js';
import { LAYOUT } from './layout.js';

export class Raster {
  constructor() { this.dots = screen(15); this.kept = null; }   // $5BE1 clears the screen white
  // Nature Park's menus over a game: the screen kept and cleared to black ($4C5D), and put back
  // as it was ($4CFB), with what an object kept under it
  keepScreen() { this.screenKept = { dots: this.dots, kept: this.kept }; this.dots = screen(0); }
  putScreen() { if (this.screenKept) ({ dots: this.dots, kept: this.kept } = this.screenKept); this.screenKept = null; }
  // Animal Rescue's PART3 at $E000: rows 19 to 115 moved two bytes to the left in each half of the
  // screen. A row is 560 bits, aux and main bytes in turn, seven bits a byte and four a dot; bytes
  // 2 to 73 of the row, bits 14 to 517, take the bits 28 on, so the dots move seven, the ends half
  // way through a dot, and bytes 74 to 79 stay
  scroll() {
    for (let y = 19; y <= 115; y++) {
      const row = this.dots[y], bits = [];
      for (const c of row) bits.push(c >> 3 & 1, c >> 2 & 1, c >> 1 & 1, c & 1);
      for (let b = 14; b < 518; b++) bits[b] = bits[b + 28];
      for (let x = 0; x < 140; x++) row[x] = bits[4 * x] << 3 | bits[4 * x + 1] << 2 | bits[4 * x + 2] << 1 | bits[4 * x + 3];
    }
  }
  set(x, y, c) { if (x >= 0 && x < 140 && y >= 0 && y < 192) this.dots[y][x] = c & 15; }
  get(x, y) { return x >= 0 && x < 140 && y >= 0 && y < 192 ? this.dots[y][x] : 0; }
  // a run of a row, both ends drawn ($7947)
  span(c, left, right, y) { for (let x = left; x <= right; x++) this.set(x, y, c); }
  // rows filled across the screen, with white edge columns when `edges` ($5F4B)
  rows(c, count, first, edges) {
    for (let y = first; y < first + count; y++) { this.span(c, 0, 139, y); if (edges) { this.set(0, y, 15); this.set(139, y, 15); } }
  }
  whiteLines(y) { this.span(15, 0, 139, y); this.span(15, 0, 139, y + 1); }
  // $65D2: the window outlined in black and filled, and the two boxes, each two white rows and its
  // rows in its color with white edges; $80 leaves a part as it is
  box(layout, window, one, two) {
    const [bottom, top1, top2] = LAYOUT[layout] ?? LAYOUT[0x32];
    if (window !== 0x80) {
      this.span(0, 1, 138, 1); this.span(0, 1, 138, bottom - 1);
      for (let y = 2; y < bottom - 1; y++) { this.set(1, y, 0); this.set(138, y, 0); this.span(window, 2, 137, y); }
    }
    if (one !== 0x80) { this.whiteLines(top1); this.rows(one, top2 - top1 - 2, top1 + 2, true); }
    if (two !== 0x80) { this.whiteLines(top2); this.rows(two, 190 - top2 - 2, top2 + 2, true); }
  }
  // a panel: its box's two white rows and its rows in its color, with white edges
  panel(top, bottom, c) { this.whiteLines(top); this.rows(c, bottom - top - 1, top + 2, true); }
  picture(shapes) { draw(shapes, this.dots); }
  rectangle(c, x, y, w, h) { for (let r = y; r < y + h; r++) this.span(c, x, x + w - 1, r); }
  outline(c, x, y, w, h) { this.span(c, x, x + w - 1, y); this.span(c, x, x + w - 1, y + h - 1); for (let r = y; r < y + h; r++) { this.set(x, r, c); this.set(x + w - 1, r, c); } }
  line(c, x0, y0, x1, y1) { for (const [x, y] of lineDots(x0, y0, x1, y1)) this.set(x, y, c); }
  // An object: 'keep' keeps the ground under it, so that object 0 puts it back, and its clear
  // color shows the ground ($686F); 'clear' shows the ground and keeps none ($6863); 'whole' puts
  // it down whole, its clear color and all ($686D)
  object(o, x, y, how) {
    if (how === 'keep') this.kept = { x, y, rows: o.rows.map((row, dy) => row.map((_, dx) => this.get(x + dx, y + dy))) };
    put(this.dots, o, x, y, how === 'whole');
  }
  restore() { const k = this.kept; if (!k) return; k.rows.forEach((row, dy) => row.forEach((c, dx) => this.set(k.x + dx, k.y + dy, c))); }
  // a glyph's cell painted, ink on its dots and paper on the rest, `h` rows a glyph row, as many
  // glyph rows as the line is high; the cell takes in the spacing after the glyph, `space`
  glyph(ch, x, y, ink, paper, h = 1, height = 9, space = 0) {
    const w = width(ch);
    // a spacer, a code below $20, is that many dots of the paper
    if (ch.charCodeAt(0) < 0x20) { for (let gy = 0; gy < Math.min(9, height); gy++) for (let gx = 0; gx < w; gx++) for (let k = 0; k < h; k++) this.set(x + gx, y + gy * h + k, paper); return w; }
    const on = new Set(dots(ch).map(([gx, gy]) => gx + ',' + gy));
    for (let gy = 0; gy < Math.min(9, height); gy++) for (let gx = 0; gx < w + space; gx++) for (let k = 0; k < h; k++) this.set(x + gx, y + gy * h + k, on.has(gx + ',' + gy) ? ink : paper);
    return w;
  }
}
