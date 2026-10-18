// The engine's objects: the things drawn over a picture and moved about, a wheel, a troll, an
// animal.
//
// A scene points the engine at a table of objects, a list of two-byte addresses, through $685A
// with the address in X and Y. It then draws an object by its number, counted from 2, at a
// column and row: through $686D, or through $686F when the ground under it is to be kept so
// that it can be put back. Numbers 0 and 1 put back the ground kept.
//
// An object is four bytes, its flags, the bytes to a row, its width in dots and its height in
// rows, then its rows, packed one of two ways.
// - With bit 6 of the flags clear, the rows are double hi-res bytes, seven dots of a bit each,
//   and a byte with its high bit set is a run: the byte less the bit, repeated as many times as
//   the byte after it says.
// - With bit 6 set, the rows are a nibble a dot, high nibble first, a dot's nibble being its
//   color, and the first byte of all is an escape: where it appears, the two bytes after it are
//   a count and a pair of nibbles to repeat.
// A run may carry over a row's end.
//
// With bit 7 of the flags clear, the color in the low four bits is the object's clear color:
// where one of its own dots is that color, the ground under it shows through. The routine takes
// that dot from the ground it kept ($6A7D), and so only when it keeps the ground: through $686F,
// for object 0 to put back, or through $6863, row by row in a buffer of its own ($6C12).
// Through $686D it goes from $69C8 straight to putting the object down whole, its clear color
// and all: PROB6's car, gray where the road is, wipes out where it was as it moves. PROB2's
// elephants are drawn in black boxes and flagged black, so only the elephants show. With bit 7
// set the object is put down whole.

// the object at `at` in `bytes`: { flags, stride, width, height, packed, clear, rows, end }
export function decode(bytes, at) {
  const flags = bytes[at], stride = bytes[at + 1], width = bytes[at + 2], height = bytes[at + 3];
  let p = at + 4, run = 0, value = 0;
  const rows = [];
  if (flags & 0x40) {
    const escape = bytes[p++];
    const next = () => { if (run) { run--; return value; } const b = bytes[p++]; if (b === escape) { run = bytes[p] - 1; value = bytes[p + 1]; p += 2; return value; } return b; };
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let k = 0; k < (width + 1) >> 1; k++) { const b = next(); row.push(b >> 4, b & 15); }
      rows.push(row.slice(0, width));
    }
  } else {
    const next = () => { if (run) { run--; return value; } const b = bytes[p++]; if (b & 0x80) { value = b & 0x7f; run = bytes[p++] - 1; return value; } return b; };
    for (let y = 0; y < height; y++) {
      const bits = [];
      for (let k = 0; k < stride; k++) { const b = next(); for (let i = 0; i < 7; i++) bits.push((b >> i) & 1); }
      const row = [];
      for (let x = 0; x < width; x++) row.push(bits[x * 4] << 3 | bits[x * 4 + 1] << 2 | bits[x * 4 + 2] << 1 | bits[x * 4 + 3]);
      rows.push(row);
    }
  }
  return { flags, stride, width, height, packed: flags & 0x40 ? 'nibbles' : 'bytes', clear: flags & 0x80 ? undefined : flags & 15, rows, end: p };
}

// An object put on a screen of rows of colors at column x and row y: every dot where the object
// is put down, all but the dots of its clear color, where the screen stays as it was; or with
// `whole`, as $686D puts it, every dot.
export function put(scr, object, x, y, whole = false) {
  object.rows.forEach((row, dy) => row.forEach((c, dx) => {
    const r = scr[y + dy];
    if (!r || x + dx < 0 || x + dx >= r.length) return;
    if (whole || c !== object.clear) r[x + dx] = c;
  }));
  return scr;
}

// Every table the scenes point the engine at, with its objects. `files` is each code file's
// { name, bytes, origin }, and `setter` the routine a scene calls with the table's address in X
// and Y. A table's entries are read while each points inside the file that holds it, at four
// bytes that make sense as an object.
export function tables(files, setter) {
  const out = [];
  const word = (b, i) => b[i] | b[i + 1] << 8;
  const holder = address => files.find(f => address >= f.origin && address < f.origin + f.bytes.length);
  for (const f of files) {
    const b = f.bytes;
    for (let i = 0; i + 7 <= b.length; i++) {
      if (!(b[i] === 0xa2 && b[i + 2] === 0xa0 && b[i + 4] === 0x20 && word(b, i + 5) === setter)) continue;
      const address = b[i + 1] | b[i + 3] << 8;
      // the parts all load at one address, and so do the problems: a table is in the file that
      // sets it when it fits there, else in whichever file it does fit, PART0 for one Nature Park uses
      const h = address >= f.origin && address < f.origin + b.length ? f : holder(address);
      if (!h || out.some(t => t.file === h.name && t.address === address)) continue;
      const objects = [];
      for (let n = 2; ; n++) {
        const at = address - h.origin + (n - 2) * 2;
        if (at + 2 > h.bytes.length) break;
        const pointer = word(h.bytes, at);
        if (pointer < h.origin || pointer + 4 > h.origin + h.bytes.length) break;
        const o = pointer - h.origin, width = h.bytes[o + 2], height = h.bytes[o + 3];
        if (!h.bytes[o + 1] || !width || !height || width > 140 || height > 192) break;
        objects.push({ number: n, at: pointer, ...decode(h.bytes, o) });
      }
      if (objects.length) out.push({ file: h.name, setBy: f.name, address, objects });
    }
  }
  return out;
}

// The carry the object routine leaves, which a scene may add in without clearing it first, as the
// elephants' problem does when it beeps each apple onto Pip's island ($F47A). The routine builds
// the object in a buffer and copies it out a row at a time ($6B0F); its pointer starts at
// $D000 less twice the dot's byte column and one bit of its place in the column, and each row adds
// the object's bytes to a row and one, with the carry set first. The carry is the last add's.
export function carry(object, x) {
  const column = Math.floor(2 * x / 7), place = x % 7;   // the tables $17A0 and $182C that $5A17 builds
  let lo = -(2 * column + (place >> 1 & 1)) & 0xff, c = 0;
  for (let row = 0; row < object.height; row++) { const sum = lo + object.stride + 1; c = sum > 0xff ? 1 : 0; lo = sum & 0xff; }
  return c;
}
