// The engine's font, measured: the width in dots of each character from space to $7F, the first
// byte of each glyph, found through the tables of pointers at $7551 and $75BB in Animal Rescue's
// PART0. A line's width is each character's width and the spacing after it; a line is centred
// at (140 − its width) / 2, worked in a byte as the engine did ($6F4D).
export const WIDTHS = [
  3, 1, 3, 5, 5, 5, 4, 1, 3, 3, 5, 5, 2, 5, 1, 5, 4, 3, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 3, 3, 4,
  8, 4, 4, 4, 4, 4, 4, 4, 4, 3, 4, 4, 4, 5, 4, 4, 4, 4, 4, 4, 3, 4, 5, 5, 4, 5, 4, 5, 5, 5, 5, 5,
  3, 4, 4, 4, 4, 4, 3, 4, 4, 3, 4, 4, 3, 5, 4, 4, 4, 4, 4, 4, 3, 4, 5, 5, 4, 4, 4, 3, 1, 3, 4, 5,
];

// The text's code $10 turns to a second set of digits, bigger, read through the same tables at
// $80 to $89 (the digit plus $50, $63FD in Nature Park), and $11 back; each text starts with the
// first. Both engines have the same: six dots wide, the one four, nine rows.
const BIG = [[6, '78ccccdceccccccc78'], [4, '60e0606060606060f0'], [6, '78cc0c183060c0c0fc'], [6, '78cc0c0c380c0ccc78'], [6, '0c1c2c4cccfc0c0c0c'],
  [6, 'fcc0c0f80c0c0ccc78'], [6, '78ccc0c0f8cccccc78'], [6, 'fc0c0c181830303030'], [6, '78cccccc78cccccc78'], [6, '78cccccc7c0c0ccc78']];

// a character's width in dots; a byte below a space is a spacer that takes its own value
export const width = ch => { const c = ch.charCodeAt(0); return c < 0x20 ? c : c >= 0x80 ? BIG[c - 0x80]?.[0] ?? 6 : WIDTHS[c - 0x20] ?? 4; };

// where a line of characters starts, in dots: its own x, or centred as the engine centres
export function start(chars, spacing, x, centre) {
  if (!centre) return x;
  let sum = 0;
  for (const ch of chars) sum += ch.charCodeAt(0) < 0x20 ? width(ch) : width(ch) + spacing;
  return ((0x8c - sum) & 0xff) >> 1;
}

// Each character's glyph, space to $7F: nine rows from the top, a byte a row, its high bit the
// leftmost dot, as the glyph follows its width in PART0. Written in hexadecimal, two digits a row.
export const GLYPHS = [
  '000000000000000000', '808080808000800000', 'a0a0a0000000000000', '0050f850f850000000', '207080700870200000', '808810204088080000', '609060909090700000', '808080000000000000',
  '204080808040200000', '804020202040800000', '008850205088000000', '002020f82020000000', '000000000000408000', '000000f80000000000', '000000000080800000', '000810204080000000',
  '6090b0d09090600000', '40c040404040e00000', '609010608080f00000', '609010201090600000', '10305090f010100000', 'f080e0101090600000', '609080e09090600000', 'f01010202040400000',
  '609090609090600000', '609090701090600000', '000080800080800000', '000040400040404080', '002040804020000000', '0000e000e000000000', '008040204080000000', '609010204000400000',
  'ffffffffffffffffff', '609090f09090900000', 'e09090e09090e00000', '609080808090600000', 'e09090909090e00000', 'f08080c08080f00000', 'f08080c08080800000', '609080b09090700000',
  '909090f09090900000', 'e04040404040e00000', '301010101090600000', '90a0c0a0a090900000', '808080808080f00000', '88d8a8888888880000', '90d0b0909090900000', '609090909090600000',
  'e09090e08080800000', '60909090b0b0700000', 'e09090e09090900000', '609080601090600000', 'e04040404040400000', '909090909090600000', '888888888850200000', '88888888a8d8880000',
  '909090609090900000', '888850202020200000', 'f01020408080f00000', '002060f86020000000', '002030f83020000000', '002020f87020000000', '002070f82020000000', '0000000000000000f8',
  '804020000000000000', '0000709090b0500000', '8080e0909090e00000', '000060908090600000', '101070909090700000', '00006090f080600000', '2040e0404040400000', '0000709090907010e0',
  '8080e0909090900000', '4000c0404040e00000', '2000602020202020c0', '808090a0c0a0900000', '804040404040e00000', '0000d0a8a8a8a80000', '0000e0909090900000', '000060909090600000',
  '0000e0909090e08080', '000070909090701010', '0000e0908080800000', '000070806010e00000', '4040e0404040200000', '000090909090700000', '000088888850200000', '00008888a8d8880000',
  '000090906090900000', '0000909090907010e0', '0000f0106080f00000', '204040804040200000', '808080808080808080', '804040204040800000', '106080000000000000', 'ff0000000000000000',
];

// the dots of a character's glyph, as [x, y] from its top left
export function dots(ch) {
  const c = ch.charCodeAt(0), hex = c >= 0x80 ? BIG[c - 0x80]?.[1] : GLYPHS[c - 0x20], out = [];
  if (!hex) return out;
  for (let y = 0; y < 9; y++) { const row = parseInt(hex.slice(2 * y, 2 * y + 2), 16); for (let x = 0; x < 8; x++) if (row >> (7 - x) & 1) out.push([x, y]); }
  return out;
}

// A title's font: the engine's, these, but for any glyphs its own PART0 has otherwise, given as { character: [its
// width, its rows as hex] } (Nature Park's: a zero without the stroke, and the underline a band of seven dots, read
// through its tables at $6A32 and $6A9C). `useFont` makes them the ones these read; none, the engine's.
const BASE = { widths: WIDTHS.slice(), glyphs: GLYPHS.slice() };
export function useFont(variants = {}) {
  WIDTHS.splice(0, WIDTHS.length, ...BASE.widths); GLYPHS.splice(0, GLYPHS.length, ...BASE.glyphs);
  for (const [ch, [w, rows]] of Object.entries(variants)) { WIDTHS[ch.charCodeAt(0) - 0x20] = w; GLYPHS[ch.charCodeAt(0) - 0x20] = rows; }
}
