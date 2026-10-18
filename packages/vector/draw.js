// The engine's drawing, dot for dot. Every rule here is the engine's own, read from PART0 and
// checked by running PART0's code on every shape of every picture of both games (test/).
// Addresses are Animal Rescue's; Nature Park's engine is the same code moved.
//
// A screen is 192 rows of 140 colors. Drawing a shape is its fill, then its outline.

// a screen of 192 rows of 140 dots, cleared to `background`
export const screen = (background = 0) => Array.from({ length: 192 }, () => new Array(140).fill(background));

// The line, $7A54: both ends drawn, and the major axis stepped every dot. The error starts at
// 2·minor − major; while it is negative only the major axis steps and it gains 2·minor,
// otherwise both axes step and it gains 2·minor − 2·major. Returns the dots in drawing order.
export function line(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x1 >= x0 ? 1 : -1, sy = y1 >= y0 ? 1 : -1;
  const xMajor = dx >= dy, major = xMajor ? dx : dy, minor = xMajor ? dy : dx;
  let err = 2 * minor - major, x = x0, y = y0;
  const out = [[x, y]];
  for (let k = 0; k < major; k++) {
    if (err < 0) { if (xMajor) x += sx; else y += sy; err += 2 * minor; }
    else { x += sx; y += sy; err += 2 * minor - 2 * major; }
    out.push([x, y]);
  }
  return out;
}

// The crossings of a polygon's edges with each row, $7C57 to $7E24. Each row's list is kept
// sorted, an equal x going after the ones already there ($7E87).
//
// - Each edge that is not level is walked with the line's own steps, and each time the walk
//   leaves a row, the x of its last dot on that row is kept for that row. So an edge gives
//   nothing to the row it ends on, and the fill meets the outline's dots exactly.
// - Where an edge goes the other way up or down from the last edge that was not level, its
//   first point is kept too. The direction starts at neither, so the first such edge always
//   keeps its first point. Level edges are passed over and change nothing.
// - The rows filled run from the first row with a crossing to the row before the next row with
//   none.
// - The shape is closed back to its first point, and a crossing is added there when that point
//   is strictly between its neighbours in height and not on the first or last row filled.
//
// Returns { rows, top, bottom }, or null for a shape that crosses no row.
export function crossings(points) {
  const rows = Array.from({ length: 192 }, () => []);
  const keep = (y, x) => { if (y < 0 || y >= 192) return; const l = rows[y]; let i = 0; while (i < l.length && x >= l[i]) i++; l.splice(i, 0, x); };
  const n = points.length;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const [xa, ya] = points[i], [xb, yb] = points[(i + 1) % n];
    if (ya === yb) continue;
    const dots = line(xa, ya, xb, yb);
    for (let k = 1; k < dots.length; k++) if (dots[k][1] !== dots[k - 1][1]) keep(dots[k - 1][1], dots[k - 1][0]);
    const way = yb > ya ? 1 : -1;
    if (way !== last) { last = way; keep(ya, xa); }
  }
  const top = rows.findIndex(l => l.length);
  if (top < 0) return null;
  let bottom = top;
  while (bottom + 1 < 192 && rows[bottom + 1].length) bottom++;
  const [x0, y0] = points[0], lo = Math.min(points[1][1], points[n - 1][1]), hi = Math.max(points[1][1], points[n - 1][1]);
  if (y0 !== top && y0 !== bottom && y0 > lo && y0 < hi) keep(y0, x0);
  return { rows, top, bottom };
}

// The spans the fill draws, $7E25: on each row the crossings are paired from the end of the
// list, so a row with an odd number of crossings leaves out its largest x. Calls `each(left,
// right, y)` for every span, in the engine's order.
export function spans(points, each) {
  const c = crossings(points);
  if (!c) return;
  for (let y = c.top; y <= c.bottom; y++) {
    const l = c.rows[y];
    for (let j = (l.length & ~1) - 2; j >= 0; j -= 2) each(l[j], l[j + 1], y);
  }
}

const set = (scr, x, y, c) => { if (x >= 0 && x < 140 && y >= 0 && y < 192) scr[y][x] = c & 15; };

// The fill. A span of one dot goes to the dot routine with the wrong color and is drawn black
// ($7955); the outline, drawn next, always covers it.
export function fill(scr, shape) {
  if (shape.points.length < 3) return scr;
  spans(shape.points, (a, b, y) => { if (a === b) set(scr, a, y, 0); else for (let x = a; x <= b; x++) set(scr, x, y, shape.fill); });
  return scr;
}

// The outline, $7BAA: every edge in the outline color, closing back to the first point. A shape
// of two points is one line in the outline color, and its fill color is not used.
export function outline(scr, shape) {
  const p = shape.points, n = p.length;
  if (n < 2) return scr;
  for (let i = 0; i < (n === 2 ? 1 : n); i++) for (const [x, y] of line(...p[i], ...p[(i + 1) % n])) set(scr, x, y, shape.line);
  return scr;
}

// a list of shapes, each filled and then outlined, as the loop at $7B8C draws a picture
export function draw(list, scr = screen()) {
  for (const shape of list) { fill(scr, shape); outline(scr, shape); }
  return scr;
}

// The point test, $7C54: the fill's own spans, with nothing drawn. A point is in a shape when
// a span on its row has it between its ends, both ends counted. Returns what the engine returns
// in A: $80 inside, 0 outside, and $FE for a shape of two points, which a caller takes as inside.
// Nature Park's colouring-in problem uses it to find the shape under the pointer.
export function inside(shape, x, y) {
  if (shape.points.length === 2) return 0xfe;
  let r = 0;
  spans(shape.points, (a, b, row) => { if (row === y && x >= a && x <= b) r = 0x80; });
  return r;
}

// The shape under a point: the last of `list` that the point is inside, since later shapes are
// drawn over earlier ones. Returns its index, or -1.
export function under(list, x, y) {
  let hit = -1;
  list.forEach((shape, i) => { if (inside(shape, x, y)) hit = i; });
  return hit;
}
