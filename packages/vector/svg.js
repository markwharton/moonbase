// The engine's shapes as SVG, which draws them at any size. A shape is a polygon in its fill
// color outlined in its outline color, or, with two points, a line. The coordinates are the
// engine's dots, 140 across and 192 down. A dot is four times as wide on the screen as the
// number of dots suggests and twice as high, so a whole screen is drawn 560 by 384.
import { rgb } from '@moonbase-machines/apple2e/colors.js';

// the columns and rows the shapes cover, a dot beyond them on each side
export function bounds(list) {
  let x0 = 140, y0 = 192, x1 = -1, y1 = -1;
  for (const sh of list) for (const [x, y] of sh.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x1 < 0 ? null : { x0: Math.max(0, x0 - 1), y0: Math.max(0, y0 - 1), x1: Math.min(139, x1 + 1), y1: Math.min(191, y1 + 1) };
}

// The SVG elements for the shapes, in the 140 by 192 space. A dot is a unit square, so the
// points are moved half a unit to the dots' centers and a stroke is a dot wide. With a
// background, a rectangle of it goes under the shapes where the engine's fills touch dots
// beside them. `crisp` keeps the edges hard, as the screen had them; without it the shapes are
// drawn smooth, which is what a sharper picture wants.
export function elements(list, { background, crisp = true } = {}) {
  const b = bounds(list), edge = crisp ? ' shape-rendering="crispEdges"' : '';
  let s = b && background !== undefined ? `<rect x="${Math.max(0, b.x0 - 1)}" y="${Math.max(0, b.y0 - 1)}" width="${b.x1 - b.x0 + 3}" height="${b.y1 - b.y0 + 3}" fill="${rgb(background)}"/>` : '';
  for (const sh of list) {
    const pts = sh.points.map(([x, y]) => (x + 0.5) + ',' + (y + 0.5)).join(' ');
    if (sh.points.length === 2) s += `<polyline points="${pts}" fill="none" stroke="${rgb(sh.line)}" stroke-width="1" stroke-linecap="square"${edge}/>`;
    else if (sh.points.length > 2) s += `<polygon points="${pts}" fill="${rgb(sh.fill)}" stroke="${rgb(sh.line)}" stroke-width="1" stroke-linejoin="round"${edge}/>`;
  }
  return s;
}

// a whole picture as an SVG document, `width` wide and in the screen's proportions, on its
// background color
export function document(list, { background = 0, width = 560, crisp = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 192" width="${width}" height="${width * 384 / 560}" preserveAspectRatio="none">` +
    `<rect width="140" height="192" fill="${rgb(background)}"/>` + elements(list, { crisp }) + '</svg>';
}
