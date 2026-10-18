// A picture of what the VIC-II shows, for a tool: a 64's memory and the chips' registers painted as the VIC-II
// paints them (paint.js, vic.js), a part of the screen cropped and its colours the 64's own (PALETTE), as rows of
// [r, g, b] (for @moonbase-machines/files/png.js: png, sheet). The screen's dots: a hi-res dot one pixel, a
// multicolour dot two wide, as the VIC-II makes them; `scale` repeats each pixel across and down.
//
//   rows({ mem, chip, chargen, crop: [x, y, width, height], scale })
//     mem       the 64K the VIC-II reads (in the bank CIA 2's port gives, chip[0xd00])
//     chip      the I/O page from $D000, 4K: the VIC-II's registers at 0 to $3F, colour memory at $800, CIA 2's
//               port A at $D00 (registers.chip() makes one from names)
//     chargen   the character ROM, where text in the ROM's own characters is shown; none, zeros
//     crop      a part of the 320 by 200 screen, from its top left; the whole of it unless given
//   chip({ registers, color, bank })   an I/O page: registers as { 0x11: 0x1b, ... }, colour memory's bytes from
//               $D800, and the VIC-II's bank ($0000, $4000, $8000 or $C000)
import { paint } from './paint.js';
import { PALETTE, LEFT, TOP, WIDTH } from './vic.js';

export function chip({ registers = {}, color = [], bank = 0 } = {}) {
  const page = new Uint8Array(0x1000);
  for (const [r, v] of Object.entries(registers)) page[+r] = v;
  page.set(color.slice(0, 0x400), 0x800);
  page[0xd00] = 3 - (bank >> 14);   // (CIA 2's port A, its two low bits the bank turned over)
  return page;
}

export function rows({ mem, chip: io, chargen, crop = [0, 0, 320, 200], scale = 1 }) {
  const frame = paint(mem, io, chargen), [cx, cy, w, h] = crop, out = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) { const c = PALETTE[frame[(TOP + cy + y) * WIDTH + LEFT + cx + x]]; for (let s = 0; s < scale; s++) row.push(c); }
    for (let s = 0; s < scale; s++) out.push(row);
  }
  return out;
}
