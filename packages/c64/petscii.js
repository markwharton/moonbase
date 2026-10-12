// PETSCII as text that can be typed and read, as moonbase's listings write it: the control
// characters by their names in braces, {CLR}, {RVS ON}, and any other byte as {$xx}; for game
// documents and a BASIC page.
//
//   bytes('{CLR}HELLO', { lower })   the bytes a C64 prints: with lower, the second character
//                                    set's (a small letter $41 to $5A, a capital $C1 to $DA);
//                                    without, the first's (letters typed either way, $41 to $5A)
//   text(bytes, { lower })           back again: with lower, the second character set's way
//                                    ($41 to $5A small letters, $C1 to $DA capitals)

export const CONTROLS = { WHT: 0x05, 'DISABLE SHIFT': 0x08, 'ENABLE SHIFT': 0x09, RETURN: 0x0d, LOWER: 0x0e, DOWN: 0x11, 'RVS ON': 0x12, HOME: 0x13, DEL: 0x14,
  RED: 0x1c, RIGHT: 0x1d, GRN: 0x1e, BLU: 0x1f, ORNG: 0x81, F1: 0x85, F3: 0x86, F5: 0x87, F7: 0x88, F2: 0x89, F4: 0x8a, F6: 0x8b, F8: 0x8c,
  UPPER: 0x8e, BLK: 0x90, UP: 0x91, 'RVS OFF': 0x92, CLR: 0x93, INST: 0x94, BRN: 0x95,
  LRED: 0x96, GRY1: 0x97, GRY2: 0x98, LGRN: 0x99, LBLU: 0x9a, GRY3: 0x9b, PUR: 0x9c, LEFT: 0x9d, YEL: 0x9e, CYN: 0x9f, 'SHIFT SPACE': 0xa0, PI: 0xff };
const NAMES = Object.fromEntries(Object.entries(CONTROLS).map(([n, b]) => [b, n]));

export function bytes(t, { lower = false } = {}) {
  const out = [];
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === '{') {
      const end = t.indexOf('}', k), name = t.slice(k + 1, end);
      if (end < 0) throw new Error('a { with no }: ' + t);
      const n = /^\$([0-9A-F]{2})$/i.exec(name) ? parseInt(name.slice(1), 16) : CONTROLS[name.toUpperCase()];
      if (n === undefined) throw new Error(`no control character {${name}}`);
      out.push(n); k = end; continue;
    }
    const v = c.charCodeAt(0);
    if (c === '£') out.push(0x5c);
    else if (c === '↑') out.push(0x5e);
    else if (c === '←') out.push(0x5f);
    else if (c === 'π') out.push(0xff);
    else if (v >= 0x61 && v <= 0x7a) out.push(v - 0x20);
    else if (lower && v >= 0x41 && v <= 0x5a) out.push(v + 0x80);
    else out.push(v & 0xff);
  }
  return out;
}

export function text(b, { lower = false } = {}) {
  let out = '';
  for (const v of b) {
    if (lower && v >= 0x41 && v <= 0x5a) out += String.fromCharCode(v + 0x20);
    else if (lower && v >= 0xc1 && v <= 0xda) out += String.fromCharCode(v - 0x80);
    else if (v === 0x0d) out += '\r';
    else if (v >= 0x20 && v < 0x5b || v === 0x5d) out += String.fromCharCode(v);
    else if (v === 0x5c) out += '£';
    else if (v === 0x5e) out += '↑';
    else if (v === 0x5f) out += '←';
    else if (v === 0x5b) out += '[';
    else out += `{${NAMES[v] ?? '$' + v.toString(16).toUpperCase().padStart(2, '0')}}`;
  }
  return out;
}
