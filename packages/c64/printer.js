// A printer on the Commodore 64's serial bus, device 4, as the games print to it: OPEN 4,4 (or
// 4,4,7 for small letters), PRINT# and CLOSE. It keeps what it is sent as lines of characters, in
// the mode it was in for each (capitals and graphics, or small letters and capitals), for a page
// to show as a sheet of paper (`paper`). It is not on the bus unless it is switched on, as the
// machines were sold: with it off, a game finds DEVICE NOT PRESENT, as Goldfields does.
//
// The bus (`bus`) puts it beside the drive: LISTEN, SECOND, CIOUT and UNLISTEN go to every device,
// and each takes them only while it is the one listening; TALK and the rest, and LOAD and SAVE,
// are the drive's alone.
import { screenCode } from './kernal.js';

export const WIDTH = 80;   // the characters a line holds, as Commodore's printers had

export class Printer {
  constructor({ on = true } = {}) {
    this.on = on;
    this.listening = false; this.lower = false; this.wide = false; this.reverse = false;
    this.lines = []; this.line = [];
    this.changed = () => {};   // called when a line is finished, for a page to draw it
  }
  listen(device) { this.listening = this.on && device === 4; return this.listening; }
  talk() { return false; }
  // the secondary address: 7 is small letters and capitals, the rest capitals and graphics
  second(sa) { if (this.listening) this.lower = (sa & 15) === 7; }
  tksa() {}
  ciout(b) {
    if (!this.listening) return;
    switch (b) {
      case 13: this.feed(); return;                                         // a new line
      case 10: return;
      case 17: this.lower = true; return;                                   // small letters and capitals
      case 145: this.lower = false; return;                                 // capitals and graphics
      case 14: this.wide = true; return;                                    // double width
      case 15: this.wide = false; return;
      case 18: this.reverse = true; return;                                 // reversed
      case 146: this.reverse = false; return;
      case 29: b = 32; break;                                               // (cursor right: a space)
    }
    if ((b & 0x7f) < 32) return;                                            // the other controls
    if (this.line.length >= WIDTH) this.feed();
    this.line.push({ code: b, lower: this.lower, wide: this.wide, reverse: this.reverse });
  }
  feed() { this.lines.push(this.line); this.line = []; this.wide = false; this.reverse = false; this.changed(); }
  unlsn() { this.listening = false; }
  untlk() {}
  acptr() { return null; }
  tear() { this.lines = []; this.line = []; this.changed(); }   // the paper torn off
}

// the drive and the printer on one bus, as the KERNAL's serial routines reach them
export function bus(drive, printer) {
  const all = [drive, printer];
  return {
    drive, printer,
    listen: d => all.map(x => x.listen(d)).some(Boolean),
    talk: d => drive.talk(d),
    second: sa => all.forEach(x => x.second(sa)),
    tksa: sa => drive.tksa(sa),
    ciout: b => all.forEach(x => x.ciout(b)),
    unlsn: () => all.forEach(x => x.unlsn()),
    untlk: () => drive.untlk(),
    acptr: () => drive.acptr(),
    load: name => drive.load(name),
    save: (name, raw) => drive.save(name, raw),
    find: name => drive.find(name),
  };
}

// The sheet: what the printer has printed, drawn on a canvas in the 64's own characters (the
// character ROM, `chargen`), black on continuous paper with its feed holes down both sides
export function paper(canvas, printer, chargen, { scale = 2 } = {}) {
  // (a line a character and a half high, as a printer spaces them)
  const margin = 24, cell = 8 * scale, line = cell * 1.5, rows = Math.max(12, printer.lines.length + 2);
  canvas.width = (WIDTH * 8 + margin * 2) * scale / 2 * 2; canvas.height = rows * line + cell;
  const g = canvas.getContext('2d'), w = canvas.width;
  g.fillStyle = '#fbfaf3'; g.fillRect(0, 0, w, canvas.height);
  for (let r = 0; r < rows; r += 6) { g.fillStyle = '#e6f0e2'; g.fillRect(margin * scale / 2, r * line + cell / 2, w - margin * scale, line * 3); }   // the green bars
  g.fillStyle = '#d9d6c8';
  for (let y = cell / 2; y < canvas.height; y += cell * 2) for (const x of [margin * scale / 4, w - margin * scale / 4]) { g.beginPath(); g.arc(x, y, scale * 2.5, 0, Math.PI * 2); g.fill(); }
  const lines = [...printer.lines, printer.line], dot = scale;
  lines.forEach((chars, r) => {
    let x = margin * scale / 2 + cell / 2;
    for (const c of chars) {
      const sc = screenCode(c.code), base = (c.lower ? 0x800 : 0) + sc * 8, wide = c.wide ? 2 : 1;
      for (let py = 0; py < 8; py++) {
        const bits = chargen ? chargen[base + py] : 0;
        for (let px = 0; px < 8; px++) {
          const on = (bits >> (7 - px) & 1) ^ (c.reverse ? 1 : 0);
          if (on) { g.fillStyle = '#26241f'; g.fillRect(x + px * dot * wide, r * line + cell / 2 + py * dot, dot * wide, dot); }
        }
      }
      x += cell * wide;
    }
  });
}
