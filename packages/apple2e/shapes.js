// Applesoft's shapes, as DRAW and XDRAW walk them ($F601 to $F6E8; rom.js plots through this): a shape table
// starts with its count of shapes and a byte unused, then a two-byte offset from the table's start to each
// shape, shape 1 first. A shape is bytes of three vectors each, bits 0 to 2, 3 to 5 and 6 to 7, ending at a zero
// byte. A vector's low two bits are its direction, up, right, down, left, turned by the rotation's quarter
// turns, and its third bit plots the dot before moving; the top vector has no plot bit, and a byte's trailing
// empty vectors are skipped. Each move is made `scale` times (0, as the ROM has it, 256), plotting each time.
//
//   shapeAt(read, table, n)                       shape n's address (1 first), from the table at `table`
//   walk(read, at, { x, y, rot, scale, dot })     the shape at `at` walked from x, y: dot(x, y) for each plot,
//                                                 its place before the move, anywhere, not clipped; gives the
//                                                 pen's place after the last move, { x, y }
//   dots(bytes, n)                                shape n of a table in `bytes` from 0, 0 at scale 1:
//                                                 { dots: [[x, y], ...], end: [x, y] }
const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export const shapeAt = (read, table, n) => table + (read(table + 2 * n) | read(table + 2 * n + 1) << 8);

export function walk(read, at, { x = 0, y = 0, rot = 0, scale = 1, dot = () => {} } = {}) {
  const times = scale || 256;
  const step = (d, plot) => {
    const [dx, dy] = DIRECTIONS[(d + (rot >> 4)) & 3];
    for (let s = 0; s < times; s++) { if (plot) dot(x, y); x += dx; y += dy; }
  };
  for (let guard = 0; guard < 4096; guard++) {
    const b = read(at++);
    if (b === 0) break;
    const v = [b & 7, (b >> 3) & 7, (b >> 6) & 3];
    for (let i = 0; i < 3; i++) { const bits = v[i]; if (bits === 0 && (i === 2 || (i === 1 && v[2] === 0))) break; step(bits & 3, bits & 4); }
  }
  return { x, y };
}

export function dots(bytes, n) {
  const read = a => bytes[a] ?? 0, out = [];
  const end = walk(read, shapeAt(read, 0, n), { dot: (x, y) => out.push([x, y]) });
  return { dots: out, end: [end.x, end.y] };
}
