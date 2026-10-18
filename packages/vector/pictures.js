// The engine's pictures: named lists of shapes on the 140 by 192 double hi-res screen.
//
// PICS1 to PICS3 are each a list of pictures. A picture is its name in 14 bytes, padded with
// spaces (one, BREAK, has the high bit set on every byte), then two bytes for its length from
// the start of the name, then its shapes. A shape is two bytes, the color it is filled with and
// the color of its outline, then its points as (x, y) pairs, x from 1 to 138 and y from 1 down
// the screen. Shapes are separated by $FE, and $FE $FF ends the picture. A shape of two points
// is a line in its outline color and is not filled.
//
// The picture routine, $7AFE in Animal Rescue, takes a picture's name inline after the call,
// has the loader copy its shapes to $E000, and draws them from there.

const text = bytes => String.fromCharCode(...Array.from(bytes, b => b & 0x7f));

// shapes from `read`, a function of an address, starting at `at`, until $FF where the next shape
// would start: the form the drawing loop at $7B8C reads from $E000
export function shapes(read, at, limit = 0x2000) {
  const out = [];
  let shape = null;
  for (let i = at; i < at + limit; i++) {
    const b = read(i);
    if (b === 0xff && !shape) break;
    if (b === 0xfe) { if (shape) out.push(shape); shape = null; continue; }
    if (!shape) { shape = { fill: b, line: read(i + 1), points: [] }; i++; continue; }
    shape.points.push([b, read(i + 1)]); i++;
  }
  if (shape) out.push(shape);
  return out;
}

// every picture in one of PICS1 to PICS3, as { name, at, length, shapes }
export function pictures(bytes) {
  const out = [];
  for (let at = 0; at + 16 <= bytes.length; ) {
    const name = text(bytes.subarray(at, at + 14)).trimEnd();
    const length = bytes[at + 14] | bytes[at + 15] << 8;
    if (length < 18 || at + length > bytes.length) break;
    out.push({ name, at, length, shapes: shapes(i => bytes[i], at + 16, length - 16) });
    at += length;
  }
  return out;
}

// The color behind each picture, from the scenes' code. A scene calls the box routine with three
// colors in A, X and Y, the picture window's and then the two text boxes', and then the picture
// routine with the picture's name inline after the call: a length byte with its high bit set,
// then the name in small letters with underscores for spaces. `windows` reads every code file
// for those two calls and gives each name the window color set before it. A scene that draws
// TRACK 1 to 4 or COL PATTERN 1 to 6 writes `track_` with a byte left for the digit, filled in
// as it runs, so a name with a trailing digit falls back to the name without it.
export function windows(codes, { box, picture }) {
  const seen = new Map();
  const word = (b, i) => b[i] | b[i + 1] << 8;
  for (const code of codes) {
    let color;
    for (let i = 0; i + 8 < code.length; i++) {
      if (code[i] === 0xa9 && code[i + 2] === 0xa2 && code[i + 4] === 0xa0 && code[i + 6] === 0x20 && word(code, i + 7) === box) { color = code[i + 1]; i += 8; continue; }
      if (code[i] === 0x20 && word(code, i + 1) === picture && code[i + 3] & 0x80) {
        const n = code[i + 3] & 0x7f;
        const name = text(code.subarray(i + 4, i + 4 + n)).toUpperCase().replace(/_/g, ' ').replace(/[\x00-\x1f]/g, '').trimEnd();
        if (color !== undefined && !seen.has(name)) seen.set(name, color);
        i += 3 + n;
      }
    }
  }
  return name => seen.get(name) ?? seen.get(name.replace(/ ?\d$/, ''));
}
