// A Commodore 64's frame painted from memory and the chips' registers, by the VIC-II as the
// emulator draws it (vic.js), for a remake: its memory, its I/O page's bytes ($D000 to
// $DFFF as the remake keeps them: the VIC's registers, the colours, CIA 2's bank) and the
// character ROM, which a text screen in the ROM's own characters needs. And `splits`, where a
// game's raster interrupt changes the VIC's registers partway down (Find Me's two character
// sets): each line's interrupt's writes, from the line after, and the last's from the top.
import { VIC } from './vic.js';

export function paint(mem, chip, chargen, vic, splits) {
  const m = { ram: mem, chargen: chargen ?? new Uint8Array(0x1000), color: chip.subarray(0x800, 0xc00), cia2: { pra: chip[0xd00] }, line: 0 };
  vic ??= new VIC(m);
  vic.m = m;
  vic.r.set(chip.subarray(0, 0x40));
  const at = splits?.size ? [...splits].sort((a, b) => a[0] - b[0]) : [];
  // (a split's $100 is CIA 2's first port, the VIC's bank)
  const set = (r, v) => { if (r === 0x100) m.cia2.pra = v; else vic.r[r] = v; };
  if (at.length) for (const [r, v] of at.at(-1)[1]) set(r, v);
  for (let y = 0, k = 0; y < 312; y++) {
    while (k < at.length && at[k][0] < y) { for (const [r, v] of at[k][1]) set(r, v); k++; }
    m.line = y; vic.line(y);
  }
  return vic.frame;
}
