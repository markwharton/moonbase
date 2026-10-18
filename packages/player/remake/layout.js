// A text laid out as the engine's text routine ($6CE2) lays it out, for the view to draw and for
// the screen model to paint. `pen` is the text state that lasts from text to text: the pen's x and
// y, the margin, centring, the spacing, the gap between lines, the ink and the paper. It is changed
// here as the engine changes it.
//
//   {0:x} the pen's x and the margin   {1:y} its y, or from $C0 the line height
//   {2:n} the spacing   {3:n} the gap between lines   {4:c} the ink   {5:c} the paper
//   {7} and {8} centring on and off   {9} and {a} tall on and off   {f:ch,n} a character n times
//   {d} and {e} ink 0 and ink 1 from here on   {10} and {11} the big digits and back
//
// Returns the lines, each { top, tall, height, paper, ink, chars }, and each character { ch, x, ink },
// its x in dots. A character's ink is undefined before the line's first color: the engine draws
// that part in the ink the whole line ends with, which is the line's `ink`. A byte below a space
// is a spacer, a few dots of room and nothing drawn.
import { width, start } from '@moonbase-machines/vector/font.js';

// the screen's layout by $03E3: the window's last row, and the tops of the two boxes below it
export const LAYOUT = { 0x41: [116, 116, 174], 0x32: [116, 116, 160], 0x31: [130, 130, 174], 0x22: [130, 130, 160], 0x11: [158, 158, 174] };
// the panels: the layout they set, the rows of the box they clear, from its two white rows down,
// and its color, and the text state they leave; `more`, white rows drawn below as well. 1 to 6 are
// Animal Rescue's, $6299 to $6395; Nature Park has the same six and eighteen more, $5712 to $58A6,
// in families that share a body and differ in the gap and the row they leave (its title's map).
const gray = (layout, rows, gap, y, more) => ({ layout, rows, fill: 10, paper: 10, ink: 0, gap, y, more });
const blue = (layout, rows, gap, y) => ({ layout, rows, fill: 5, paper: 5, ink: 15, gap, y });
export const PANELS = {
  1: gray(0x32, [116, 159], 7, 128), 2: gray(0x32, [116, 159], 33, 135),
  3: gray(0x22, [130, 159], 5, 135), 4: gray(0x22, [130, 159], 19, 142),
  5: blue(0x22, [160, 189], 5, 166), 6: blue(0x22, [160, 189], 19, 172),
  7: gray(0x41, [116, 173], 5, 121), 8: gray(0x41, [116, 173], 6, 128), 9: gray(0x41, [116, 173], 7, 134), 10: gray(0x41, [116, 173], 47, 142),
  11: gray(0x32, [116, 159], 5, 121),
  12: gray(0x31, [130, 173], 5, 135), 13: gray(0x31, [130, 173], 7, 142), 14: gray(0x31, [130, 173], 33, 149),
  15: gray(0x11, [158, 173], 5, 163, [174]),
  16: blue(0x32, [160, 189], 19, 172), 17: blue(0x42, [160, 189], 19, 172),
  18: blue(0x32, [160, 189], 5, 166), 19: blue(0x42, [160, 189], 5, 166),
  20: blue(0x23, [160, 189], 0, 163), 21: blue(0x33, [160, 189], 0, 163), 22: blue(0x43, [160, 189], 0, 163),
  23: blue(0x31, [174, 189], 5, 179), 24: blue(0x41, [174, 189], 5, 179),
};

// code 6: a word from a table of words, each its length then its letters, the index given or
// read from memory
export function word(mem, [lo, hi, vlo, vhi]) {
  let at = lo | hi << 8, n = vhi === 0xff ? vlo : mem[vlo | vhi << 8];
  while (n-- > 0) at += mem[at] + 1;
  let s = ''; for (let k = 1; k <= mem[at]; k++) s += String.fromCharCode(mem[at + k] & 0x7f);
  return s;
}
// a text's words with the words code 6 takes put in, from memory as it is now
export const resolve = (words, mem) => words.replace(/\{6:([0-9a-f,]+)\}/g, (all, b) => word(mem, b.split(',').map(v => parseInt(v, 16))));

export function layout(words, pen) {
  const t = pen, lines = [];
  t.tall = false; t.margin = t.x; let height = 9, big = false;
  let line = [], ink = t.ink, marked = false;
  const flush = newline => {
    if (line.length) {
      let x = start(line.map(c => c.ch), t.spacing, t.x, t.centre);
      const chars = [];
      for (const c of line) {
        const w = width(c.ch);
        chars.push({ ch: c.ch, x, ink: c.ink });
        x += c.ch.charCodeAt(0) < 0x20 ? w : w + t.spacing;
      }
      lines.push({ top: t.y, tall: t.tall, height, paper: t.paper, ink: t.ink, chars });
      t.x = x;
    }
    line = [];
    if (newline) { t.y += (t.tall ? 2 * height : height) + t.gap; t.x = t.margin; }
  };
  // a digit in the big set is its own character, $80 and on (@moonbase-machines/vector/font.js)
  const put = ch => line.push({ ch: big && ch >= '0' && ch <= '9' ? String.fromCharCode(0x80 + ch.charCodeAt(0) - 0x30) : ch, ink: marked ? ink : undefined });
  for (let i = 0; i < words.length; i++) {
    const c = words[i];
    if (c === '\n') { flush(true); continue; }
    if (c === '{') {
      const end = words.indexOf('}', i), [code, rest] = words.slice(i + 1, end).split(':'), b = (rest ?? '').split(',').map(v => parseInt(v, 16));
      i = end;
      switch (parseInt(code, 16)) {
        case 0: t.x = t.margin = b[0]; break;
        case 1: if (b[0] < 0xc0) t.y = b[0]; else height = b[0] - 0xc0; break;
        case 2: t.spacing = b[0]; break;
        case 3: t.gap = b[0]; break;
        case 4: t.ink = ink = b[0]; marked = true; break;
        case 5: t.paper = b[0]; break;
        case 7: t.centre = true; break;
        case 8: t.centre = false; break;
        case 9: t.tall = true; break;
        case 10: t.tall = false; break;
        case 13: ink = 0; marked = true; break;
        case 14: ink = 1; marked = true; break;
        case 16: big = true; break;
        case 17: big = false; break;
        case 15: for (let k = 0; k < (b[1] || 256); k++) put(String.fromCharCode(b[0] & 0x7f)); break;
      }
      continue;
    }
    put(c);
  }
  flush(false);
  return lines;
}

// The same codes on the text screen, where the menus and the teacher's controls are ($573D puts
// the machine in 40 columns of text): {0:x} is the column and the margin, {1:y} the row, a new
// line the next row at the margin, {7} centres each line in the 40 columns, and {d} and {e} turn
// inverse on and off. Inverse has capitals only, as the text page's inverse codes do. The
// spacing, the gap, the colors and tall mean nothing there.
// Returns the characters as { row, col, ch, inverse }, and leaves the pen where the text ended.
export function textLayout(words, pen) {
  const cells = [];
  pen.inverse = false;   // each text starts out of inverse ($6D02)
  let line = [];
  const flush = newline => {
    const col = pen.centre ? (40 - line.length) >> 1 : pen.x;
    line.forEach((c, k) => cells.push({ row: pen.y, col: col + k, ch: c.ch, inverse: c.inverse }));
    if (line.length) pen.x = col + line.length;
    line = [];
    if (newline) { pen.y++; pen.x = pen.margin; }
  };
  const put = ch => line.push({ ch: pen.inverse ? ch.toUpperCase() : ch, inverse: pen.inverse });
  for (let i = 0; i < words.length; i++) {
    const c = words[i];
    if (c === '\n') { flush(true); continue; }
    if (c === '{') {
      const end = words.indexOf('}', i), [code, rest] = words.slice(i + 1, end).split(':'), b = (rest ?? '').split(',').map(v => parseInt(v, 16));
      i = end;
      switch (parseInt(code, 16)) {
        case 0: flush(false); pen.x = pen.margin = b[0]; break;
        case 1: flush(false); if (b[0] < 0xc0) pen.y = b[0]; break;
        case 7: pen.centre = true; break;
        case 8: pen.centre = false; break;
        case 13: pen.inverse = true; break;
        case 14: pen.inverse = false; break;
        case 15: for (let k = 0; k < (b[1] || 256); k++) put(String.fromCharCode(b[0] & 0x7f)); break;
      }
      continue;
    }
    put(c);
  }
  flush(false);
  return cells;
}
// the text state at the start, and the empty screen
export const textPen = () => ({ x: 0, y: 0, margin: 0, centre: false, inverse: false });
export const textPage = () => Array.from({ length: 24 }, () => Array.from({ length: 40 }, () => ({ ch: ' ', inverse: false })));
