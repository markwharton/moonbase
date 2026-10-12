// The VIC-II, drawn a raster line at a time into a frame of 384 by 272: the 320 by 200 screen
// with the border around it. Text in the standard, multicolor and extended modes, bitmaps in
// hi-res and multicolor, the eight sprites with their expansion, priority and multicolor, and
// the raster interrupt. The VIC-II reads memory in the 16K bank CIA2 selects, and sees the
// character ROM at $1000 in the first and third banks.
export const PALETTE = [[0, 0, 0], [255, 255, 255], [136, 0, 0], [170, 255, 238], [204, 68, 204], [0, 204, 85], [0, 0, 170], [238, 238, 119],
  [221, 136, 85], [102, 68, 0], [255, 119, 119], [51, 51, 51], [119, 119, 119], [170, 255, 102], [0, 136, 255], [187, 187, 187]];

export const WIDTH = 384, HEIGHT = 272, LEFT = 32, TOP = 35;   // where the 320 by 200 screen sits in the frame
const FIRST_LINE = 16, LAST_LINE = 287;   // the raster lines of the frame's 272, out of 312

export class VIC {
  constructor(m) {
    this.m = m; this.r = new Uint8Array(0x40); this.r[0x11] = 0x1b; this.r[0x16] = 0xc8; this.r[0x18] = 0x14;
    this.frame = new Uint8Array(WIDTH * HEIGHT);   // a color a pixel
    this.rasterIrq = false; this.spriteHits = 0; this.spriteBackground = 0; this.inside = [0, WIDTH - 1];
    this.priority = new Uint8Array(WIDTH);   // this line: 1 where the background's foreground is
  }
  read(r) {
    if (r === 0x11) return (this.r[0x11] & 0x7f) | ((this.m.line >> 1) & 0x80);
    if (r === 0x12) return this.m.line & 0xff;
    if (r === 0x19) return this.r[0x19] | 0x70;
    if (r === 0x1e) { const v = this.spriteHits; this.spriteHits = 0; return v; }
    if (r === 0x1f) { const v = this.spriteBackground; this.spriteBackground = 0; return v; }
    if (r >= 0x20 && r < 0x2f) return this.r[r] | 0xf0;
    return this.r[r];
  }
  write(r, v) {
    if (r === 0x19) { this.r[0x19] &= ~(v & 0x0f); return; }   // acknowledged by writing the bit
    this.r[r] = v;
  }
  irq() {
    const line = this.m.line, target = this.r[0x12] | (this.r[0x11] & 0x80) << 1;
    if (line === target && !this.rasterIrq) { this.rasterIrq = true; this.r[0x19] |= 1; }
    if (line !== target) this.rasterIrq = false;
    if (this.r[0x19] & this.r[0x1a] & 0x0f) { this.r[0x19] |= 0x80; return true; }
    return false;
  }
  // the VIC-II's view of memory
  bank() { return (~this.m.cia2.pra & 3) << 14; }
  fetch(a) { const b = this.bank(), full = b | (a & 0x3fff); if ((full & 0x7000) === 0x1000 && !(b & 0x4000)) return this.m.chargen[full & 0xfff]; return this.m.ram[full]; }

  // the raster line `y` of the frame, into the pixels
  line(y) {
    if (y < FIRST_LINE || y > LAST_LINE) return;
    const py = y - FIRST_LINE, out = this.frame, row = py * WIDTH, r = this.r;
    const border = r[0x20] & 15, bg = r[0x21] & 15;
    const den = r[0x11] & 0x10, rsel = r[0x11] & 8, csel = r[0x16] & 8;
    const top = rsel ? 51 : 55, bottom = rsel ? 250 : 246, left = csel ? 24 : 31, right = csel ? 343 : 334;
    const prio = this.priority; prio.fill(0);
    for (let x = 0; x < WIDTH; x++) out[row + x] = border;
    if (!den || y < top || y > bottom) { this.sprites(y, row, true); return; }
    const yscroll = r[0x11] & 7, xscroll = r[0x16] & 7, bitmap = r[0x11] & 0x20, ecm = r[0x11] & 0x40, mcm = r[0x16] & 0x10;
    const screenBase = ((r[0x18] >> 4) & 15) << 10, charBase = ((r[0x18] >> 1) & 7) << 11, bitmapBase = (r[0x18] & 8) << 10;
    const sy = y - 48 - yscroll;   // the line within the 200 of the screen: with the usual scroll of 3, the first is raster 51
    if (sy < 0 || sy >= 200) { this.sprites(y, row, false); return; }
    const cy = sy >> 3, ly = sy & 7;
    for (let cx = 0; cx < 40; cx++) {
      const cell = cy * 40 + cx, code = this.fetch(screenBase + cell), color = this.m.color[cell] & 15;
      let bits, colors;
      if (bitmap) {
        bits = this.fetch(bitmapBase + cell * 8 + ly);
        colors = mcm ? [bg, code >> 4, code & 15, color] : [code & 15, code >> 4];
      } else {
        bits = this.fetch(charBase + ((ecm ? code & 0x3f : code) << 3) + ly);
        if (ecm) colors = [r[0x21 + (code >> 6)] & 15, color];
        else if (mcm && color & 8) colors = [bg, r[0x22] & 15, r[0x23] & 15, color & 7];
        else colors = [bg, color];
      }
      const multi = colors.length === 4 && (bitmap ? true : true);
      const x0 = LEFT + xscroll + cx * 8;
      if (multi && (bitmap || (mcm && (color & 8)))) {
        for (let k = 0; k < 4; k++) { const pair = (bits >> (6 - k * 2)) & 3, c = colors[pair]; const x = x0 + k * 2; if (x >= 0 && x + 1 < WIDTH) { out[row + x] = c; out[row + x + 1] = c; if (pair >= 2) { prio[x] = 1; prio[x + 1] = 1; } } }
      } else {
        for (let k = 0; k < 8; k++) { const set = (bits >> (7 - k)) & 1, x = x0 + k; if (x >= 0 && x < WIDTH) { out[row + x] = set ? colors[1] : colors[0]; if (set) prio[x] = 1; } }
      }
    }
    // the side borders over the screen's edge, and the whole border row outside it; the border over
    // the sprites too, as the 64's is (they show in it only where a program opens it)
    for (let x = 0; x < LEFT + left - 24; x++) out[row + x] = border;
    for (let x = LEFT + right - 24 + 1; x < WIDTH; x++) out[row + x] = border;
    this.inside = [LEFT + left - 24, LEFT + right - 24];
    this.sprites(y, row, false);
  }

  // the sprites on raster line `y`: each is 24 by 21 at its position, doubled when expanded,
  // its pixels from the 63 bytes its pointer names, over or under the background by priority. A
  // sprite shows from the line after its Y: the VIC-II reads its first line's data on line Y and
  // shows it on the next (as VICE shows it, held against it on Subway Arts' curtains)
  sprites(y, row, borderOnly) {
    const r = this.r, enabled = r[0x15];
    if (!enabled) return;
    const screenBase = ((r[0x18] >> 4) & 15) << 10, out = this.frame, prio = this.priority;
    const drawn = new Uint8Array(WIDTH);   // which sprite drew each pixel, plus one
    for (let s = 7; s >= 0; s--) {
      if (!(enabled & (1 << s))) continue;
      const sx = r[s * 2] | ((r[0x10] >> s) & 1) << 8, sy = r[s * 2 + 1], yx = r[0x17] & (1 << s), xx = r[0x1d] & (1 << s);
      const height = yx ? 42 : 21;
      const ry = y - sy - 1;   // the sprite is placed by raster line, from the one after its Y
      if (ry < 0 || ry >= height) continue;
      const line = yx ? ry >> 1 : ry, pointer = this.fetch(screenBase + 0x3f8 + s), data = pointer << 6;
      const multi = r[0x1c] & (1 << s), behind = r[0x1b] & (1 << s), color = r[0x27 + s] & 15;
      const px0 = LEFT + sx - 24;
      for (let byte = 0; byte < 3; byte++) {
        const bits = this.fetch(data + line * 3 + byte);
        if (multi) {
          for (let k = 0; k < 4; k++) { const pair = (bits >> (6 - k * 2)) & 3; if (!pair) continue; const c = pair === 1 ? r[0x25] & 15 : pair === 2 ? color : r[0x26] & 15; const base = (byte * 8 + k * 2) * (xx ? 2 : 1); for (let d = 0; d < (xx ? 4 : 2); d++) this.spritePixel(row, px0 + base + d, c, s, behind, drawn, borderOnly); }
        } else {
          for (let k = 0; k < 8; k++) { if (!((bits >> (7 - k)) & 1)) continue; const base = (byte * 8 + k) * (xx ? 2 : 1); for (let d = 0; d < (xx ? 2 : 1); d++) this.spritePixel(row, px0 + base + d, color, s, behind, drawn, borderOnly); }
        }
      }
    }
  }
  spritePixel(row, x, c, s, behind, drawn, borderOnly) {
    if (x < 0 || x >= WIDTH) return;
    if (drawn[x]) { this.spriteHits |= (1 << s) | (1 << (drawn[x] - 1)); }
    drawn[x] = s + 1;
    if (this.priority[x]) { this.spriteBackground |= 1 << s; if (behind) return; }
    if (borderOnly || x < this.inside[0] || x > this.inside[1]) return;
    this.frame[row + x] = c;
  }
}
