// A character's eight bytes (its rows, the left dot the top bit) as a 32-bit FNV-1a hash: how
// glyph-hashes.js keeps the 64's characters, and how a cell of a picture is recognised as one of
// them.
export function glyphHash(rows) {
  let h = 0x811c9dc5;
  for (let i = 0; i < 8; i++) { h ^= rows[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
