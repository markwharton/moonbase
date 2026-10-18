// moonbase's own characters for the Commodore 64's character ROM, apart from @moonbase-machines/c64/rom.js
// so that a page needing only the characters (a PET's screen) loads only them.
//
//   chargen()   the character ROM's 4K: the two sets, each 128 characters and their reverse
import { FONT } from './font.js';

// The two character sets, as the character ROM holds them, 8 bytes a character, from the font:
// the first upper case and graphics, the second lower and upper case, each 128 characters by
// screen code and the same 128 reversed after them. A glyph's five columns go one dot in from the
// left, its seven rows from the top. The graphics, and £, ↑ and ←, are moonbase's own, drawn
// below: each a symbol at the place the C64 keeps it, so a game's boxes, shading and card suits
// show, the lines and blocks where a line or a block must lie, the rest in moonbase's hand. The
// second set has the first's graphics at the same places, but for four of its own.
const GRAPHICS = (() => {
  const rows = (...r) => r.map(t => parseInt(t.replace(/\./g, '0').replace(/#/g, '1'), 2));
  const fill = (top, bottom, left, right) => [...Array(8).keys()].map(y => y >= top && y <= bottom ? (0xff >> left) & (0xff << (7 - right)) & 0xff : 0);
  const or = (...gs) => gs[0].map((_, y) => gs.reduce((v, g) => v | g[y], 0));
  const across = (top, bottom) => fill(top, bottom, 0, 7), down = (left, right) => fill(0, 7, left, right);
  const centre = { up: fill(0, 4, 3, 4), down: fill(3, 7, 3, 4), left: fill(3, 4, 0, 4), right: fill(3, 4, 3, 7) };
  const join = (...arms) => or(...arms.map(a => centre[a]));
  const checker = (phase, top = 0, bottom = 7, left = 0, right = 7) => [...Array(8).keys()].map(y => y < top || y > bottom ? 0 : ((y >> 1) + phase) & 1 ? 0x33 & (0xff >> left) & (0xff << (7 - right)) & 0xff : 0xcc & (0xff >> left) & (0xff << (7 - right)) & 0xff);
  return {
    // the first set's, by screen code
    first: {
      0x40: across(3, 4), 0x43: across(3, 4), 0x44: across(2, 3), 0x45: across(1, 2), 0x46: across(4, 5), 0x52: across(5, 6),
      0x42: down(3, 4), 0x5d: down(3, 4), 0x47: down(2, 3), 0x48: down(4, 5), 0x54: down(1, 2), 0x59: down(5, 6),
      0x41: rows('...##...', '..####..', '.######.', '########', '########', '##.##.##', '...##...', '..####..'),   // spade
      0x53: rows('.##..##.', '########', '########', '########', '.######.', '..####..', '...##...', '........'),   // heart
      0x58: rows('..####..', '..####..', '##.##.##', '########', '########', '##.##.##', '...##...', '..####..'),   // club
      0x5a: rows('...##...', '..####..', '.######.', '########', '.######.', '..####..', '...##...', '........'),   // diamond
      0x51: rows('........', '..####..', '.######.', '.######.', '.######.', '.######.', '..####..', '........'),   // a disc
      0x57: rows('........', '..####..', '.######.', '.##..##.', '.##..##.', '.######.', '..####..', '........'),   // a ring
      0x5e: rows('........', '........', '#######.', '.##.##..', '.##.##..', '.##.##..', '.##..##.', '........'),   // pi
      // rounded corners, the diagonals, the cross, the disc and the ring: drawn as Commodore's, so
      // PETSCII pictures, which lean on them, come out as they were made
      0x55: rows('........', '........', '........', '.....###', '....####', '...###..', '...##...', '...##...'),
      0x49: rows('........', '........', '........', '###.....', '####....', '..###...', '...##...', '...##...'),
      0x4a: rows('...##...', '...##...', '...###..', '....####', '.....###', '........', '........', '........'),
      0x4b: rows('...##...', '...##...', '..###...', '####....', '###.....', '........', '........', '........'),
      0x4d: rows('##......', '###.....', '.###....', '..###...', '...###..', '....###.', '.....###', '......##'),
      0x4e: rows('......##', '.....###', '....###.', '...###..', '..###...', '.###....', '###.....', '##......'),
      0x56: rows('##....##', '###..###', '.######.', '..####..', '..####..', '.######.', '###..###', '##....##'),
      // the cell's edges, and corners on them
      0x63: across(0, 0), 0x64: across(7, 7), 0x65: down(0, 1), 0x74: down(0, 1), 0x67: down(6, 7), 0x6a: down(6, 7),
      0x4c: or(down(0, 1), across(6, 7)), 0x4f: or(across(0, 1), down(0, 1)), 0x50: or(across(0, 1), down(6, 7)), 0x7a: or(down(6, 7), across(6, 7)),
      // box lines through the middle: corners, T-junctions and the cross
      0x6b: join('up', 'down', 'right'), 0x73: join('up', 'down', 'left'), 0x71: join('up', 'left', 'right'), 0x72: join('down', 'left', 'right'), 0x5b: join('up', 'down', 'left', 'right'),
      0x6d: join('up', 'right'), 0x7d: join('up', 'left'), 0x70: join('down', 'right'), 0x6e: join('down', 'left'),
      // blocks, by halves, thirds and quarters, and the quadrants
      0x61: fill(0, 7, 0, 3), 0x62: fill(4, 7, 0, 7), 0x6f: fill(6, 7, 0, 7), 0x77: fill(0, 1, 0, 7), 0x78: fill(0, 2, 0, 7), 0x79: fill(5, 7, 0, 7),
      0x75: fill(0, 7, 0, 2), 0x76: fill(0, 7, 5, 7),
      0x7e: fill(0, 3, 0, 3), 0x7c: fill(0, 3, 4, 7), 0x7b: fill(4, 7, 0, 3), 0x6c: fill(4, 7, 4, 7), 0x7f: or(fill(0, 3, 0, 3), fill(4, 7, 4, 7)),
      // shading, and the triangles
      0x66: checker(0), 0x5c: checker(0, 0, 7, 0, 3), 0x68: checker(0, 4, 7),
      0x5f: [...Array(8).keys()].map(y => 0xff >> y), 0x69: [...Array(8).keys()].map(y => (0xff << y) & 0xff),
    },
    // the second set's own, where it does not have the first's: the shading the other way about,
    // stripes each way, and a tick
    second: {
      0x5e: checker(1),
      0x5f: rows('..##..##', '#..##..#', '##..##..', '.##..##.', '..##..##', '#..##..#', '##..##..', '.##..##.'),
      0x69: rows('##..##..', '#..##..#', '..##..##', '.##..##.', '##..##..', '#..##..#', '..##..##', '.##..##.'),
      0x7a: rows('........', '......##', '.....##.', '....##..', '##.##...', '.###....', '..#.....', '........'),
    },
    // £, ↑ and ←, in both
    signs: {
      0x1c: rows('...###..', '..##..#.', '..##....', '######..', '..##....', '.##...#.', '#######.', '........'),
      0x1e: rows('...##...', '..####..', '.######.', '...##...', '...##...', '...##...', '...##...', '........'),
      0x1f: rows('........', '..##....', '.##.....', '#######.', '.##.....', '..##....', '........', '........'),
    },
  };
})();
export function chargen() {
  const out = new Uint8Array(0x1000);
  const glyph = (ascii, at) => {
    const g = FONT[ascii - 0x20]; if (!g) return;
    for (let row = 0; row < 7; row++) { let bits = 0; for (let col = 0; col < 5; col++) if (g[col] >> row & 1) bits |= 0x40 >> col; out[at + row] = bits; }
  };
  const OTHERS = { 0x00: 0x40, 0x1b: 0x5b, 0x1c: 0x23, 0x1d: 0x5d, 0x1e: 0x5e, 0x1f: 0x3c };   // @ [ £ ] ↑ ←
  for (const set of [0, 1]) {
    const base = set * 0x800;
    for (let code = 0; code < 64; code++) {
      const ascii = code >= 0x20 ? code : code >= 1 && code <= 26 ? (set ? 0x60 : 0x40) + code : OTHERS[code];
      glyph(ascii, base + code * 8);
    }
    if (set) for (let code = 0x41; code <= 0x5a; code++) glyph(code, base + code * 8);   // the second set's capitals
    for (const [code, g] of Object.entries(GRAPHICS.signs)) out.set(g, base + code * 8);
    for (const [code, g] of Object.entries(GRAPHICS.first)) if (!set || !(code >= 0x41 && code <= 0x5a)) out.set(g, base + code * 8);
    if (set) for (const [code, g] of Object.entries(GRAPHICS.second)) out.set(g, base + code * 8);
    for (let i = 0; i < 0x400; i++) out[base + 0x400 + i] = out[base + i] ^ 0xff;   // reversed
  }
  return out;
}
