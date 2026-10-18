// The remake's view: it follows the engine's events and draws the screen as SVG, sharper than
// the original. The screen is the original's, 140 dots across and 192 down, each dot four
// pixels wide and two high, so the SVG is 560 by 384. Pictures are drawn from their shapes,
// smooth; objects from their own dots; text in a system font, laid out by the engine's codes.
//
// The screen is kept as the original painted it: each thing drawn covers some rows, and a
// window, a box, a panel or a fill that paints over those rows takes away what was there.
import { COLORS, rgb } from '@moonbase-machines/apple2e/colors.js';
import { pictures } from '@moonbase-machines/vector/pictures.js';
import { tables, put } from '@moonbase-machines/vector/objects.js';
import { codeFiles } from './vector.js';
import { elements } from '@moonbase-machines/vector/svg.js';
import { width, dots } from '@moonbase-machines/vector/font.js';
import { layout, resolve, LAYOUT, PANELS, textLayout, textPen, textPage } from './layout.js';
import { FONT } from '@moonbase-machines/charset/font.js';
import { colors } from '@moonbase-machines/apple2e/screen.js';

const NS = 'http://www.w3.org/2000/svg';
const X = x => x * 4, Y = y => y * 2;
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';

// The characters are the title's own. There was no Unicode in 1986: the engine's font has its
// arrows at $5B to $5E, left, right, down and up, where ASCII has [ \ ] and ^. The engine's own
// font draws those characters as they are. A modern font, a system font or one from Bunny Fonts,
// has no arrow there, so text drawn in one maps them to Unicode's arrows as it is drawn. A title's
// own glyphs that a modern font lacks are mapped the same way, as its title says (its map's `modern`):
// Nature Park's underline is a band of checked dots.
const ARROWS = ['[', '\\', ']', '^'];
const MODERN = { '[': '←', '\\': '→', ']': '↓', '^': '↑' };

export class View {
  // `svg` is the element to draw in; `disk` the title's disk from its game's data; `engine` the
  // running engine; `extra` the title's own drawing for its problems (titles/<title>/view.js)
  constructor(svg, { disk, volume, engine, extra = {}, press }) {
    this.svg = svg; this.engine = engine; this.extra = extra; this.press = press;
    svg.setAttribute('viewBox', '0 0 560 384');
    this.disk = disk.volumes[volume];
    this.pictures = new Map();
    for (const [name, f] of Object.entries(disk.volumes[volume])) if (/^PICS\d$/.test(name)) for (const p of pictures(Uint8Array.from(atob(f.data), c => c.charCodeAt(0)))) this.pictures.set(p.name, p.shapes);
    const map = engine.title.map;
    this.vars = map.vars;
    // the title's characters a modern font would draw wrongly, and what it draws instead
    const modern = { ...MODERN, ...map.modern };
    for (let d = 0; d < 10; d++) modern[String.fromCharCode(0x80 + d)] = String(d);   // the big digits
    const pattern = new RegExp('[' + Object.keys(modern).map(c => '\\' + c).join('') + ']', 'g');
    this.modern = s => s.replace(pattern, c => modern[c]);
    this.tables = new Map(tables(codeFiles(map, disk.volumes[volume]), map.objects).map(t => [t.address, t.objects]));
    this.items = [];       // what is on the screen: { top, bottom, el }
    this.pen = { x: 0, y: 0, margin: 0, centre: false, spacing: 1, gap: 0, ink: 15, paper: 10 };
    this.window = { color: 0, bottom: 116 };
    this.shapes = [];      // the shapes in the window now
    this.spaceBar = null;
    this.layer = this.el('g'); svg.append(this.layer);
    this.textScreen = this.el('g', { display: 'none' }); svg.append(this.textScreen);
    this.prompt = this.el('g'); svg.append(this.prompt);
    this.textPen = textPen(); this.textCells = textPage();
    this.rect(0, 0, 140, 192, 15, this.layer);
  }

  el(name, attrs = {}, parent) { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.append(e); return e; }
  // a flat rectangle, its edges on whole pixels: where two meet at a fraction of a pixel, the page
  // would otherwise show a hair of what lies under both
  rect(x, y, w, h, color, parent = this.layer) { return this.el('rect', { x: X(x), y: Y(y), width: X(w), height: Y(h), fill: rgb(color), 'shape-rendering': 'crispEdges' }, parent); }
  // something drawn over rows top to bottom: what it covers entirely is gone
  // Something drawn over the rows top to bottom and the columns left to right: what lies wholly
  // inside that, it covers, and is gone.
  add(top, bottom, el, { covers = true, left = 0, right = 139 } = {}) {
    if (covers) this.items = this.items.filter(i => { if (i.top >= top && i.bottom <= bottom && i.left >= left && i.right <= right) { i.el.remove(); return false; } return true; });
    this.items.push({ top, bottom, left, right, el }); this.layer.append(el);
    return el;
  }
  // something taken off the screen, and out of what the screen holds
  remove(el) { el.remove(); this.items = this.items.filter(i => i.el !== el); }
  fill(top, bottom, color, sides = true) {
    const g = this.el('g');
    this.rect(0, top, 140, bottom - top + 1, color, g);
    if (sides) { this.rect(0, top, 1, bottom - top + 1, 15, g); this.rect(139, top, 1, bottom - top + 1, 15, g); }
    this.add(top, bottom, g);
  }
  whiteLines(y) { this.add(y, y + 1, this.rect(0, y, 140, 2, 15, null)); }

  // What the view needs from memory as an event happens, since it draws the event later: the
  // layout, the difficulty, and the words code 6 takes from its tables.
  snapshot(e) {
    const mem = this.engine.mem;
    e.layout = mem[this.vars.layout]; e.difficulty = mem[this.vars.difficulty];
    if (e.step === 'text') e.words = resolve(e.words, mem);
    if (e.step === 'span') e.row = mem[this.vars.zero + 0x02];
    return e;
  }

  // an event from the engine
  apply(e) {
    this.difficulty = e.difficulty;
    if (this.spaceBar?.erase && !this.waiting()) { this.fill(this.spaceBar.y, this.spaceBar.y + 10, 5); this.spaceBar.el.remove(); this.spaceBar = null; }
    // a step the title draws itself comes first, so that no name of the view's own can take it
    const f = this.extra[e.step] ?? (typeof this[e.step] === 'function' ? this[e.step] : undefined);
    if (f) f.call(this, e);
  }
  waiting() { return this.engine.waitingOn; }

  // The text screen ($573D), where the menus are: 40 columns and 24 rows over the whole screen,
  // white on black. `show` ($5BA9) puts the graphics back as they were.
  'text-screen'() {
    this.textCells = textPage();
    this.textScreen.replaceChildren(); this.rect(0, 0, 140, 192, 0, this.textScreen);
    this.textScreen.setAttribute('display', 'inline'); this.layer.setAttribute('display', 'none');
  }
  show() { this.textScreen.setAttribute('display', 'none'); this.layer.setAttribute('display', 'inline'); }
  // a character of the text screen, 14 pixels by 16, in inverse or not
  textCell(row, col, ch, inverse) {
    const old = this.textCells[row][col];
    old.el?.remove();
    const g = this.el('g', { 'data-cell': row * 40 + col }, this.textScreen), x = col * 14, y = row * 16, ink = inverse ? '#000' : '#fff';
    if (inverse) this.el('rect', { x, y, width: 14, height: 16, fill: '#fff', 'shape-rendering': 'crispEdges' }, g);
    if (this.oldStyle) {
      // the emulator's own letters, five dots by seven in a cell of seven by eight, two pixels a dot
      const glyph = FONT[ch.charCodeAt(0) - 0x20] ?? FONT[0];
      let d = ''; for (let gx = 0; gx < 5; gx++) for (let gy = 0; gy < 7; gy++) if (glyph[gx] >> gy & 1) d += `M${x + 2 + gx * 2} ${y + gy * 2}h2v2h-2z`;
      if (d) this.el('path', { d, fill: ink }, g);
    } else if (ch !== ' ') {
      const t = this.el('text', { x: x + 7, y: y + 12, fill: ink, 'font-family': MONO, 'font-size': 15, 'text-anchor': 'middle' }, g);
      t.textContent = ch;
    }
    this.textCells[row][col] = { ch, inverse, el: g };
  }

  // The loader's splash: TITLE, a double hi-res screen, the auxiliary half then the main, drawn
  // dot for dot as it is
  splash() {
    const f = this.disk.TITLE;
    if (!f) return;
    const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0)), dots = colors(bytes.subarray(0, 0x2000), bytes.subarray(0x2000));
    const rows = []; for (let y = 0; y < 192; y++) rows.push(Array.from(dots.subarray(y * 140, y * 140 + 140)));
    this.clear();
    this.add(0, 191, this.el('image', { href: this.image(rows), x: 0, y: 0, width: 560, height: 384, preserveAspectRatio: 'none', style: 'image-rendering: pixelated' }));
  }
  // Nature Park's $4C00: the screen cleared to black
  'clear-screen'() { this.clear(); this.add(0, 191, this.rect(0, 0, 140, 192, 0, null)); }
  clear() { for (const i of this.items) i.el.remove(); this.items = []; }
  // Nature Park's menus over a game ($4C5D and $4CFB): the screen kept, cleared to black, and put
  // back as it was when they return
  'keep-screen'() {
    this.kept = { items: this.items, pen: { ...this.pen }, window: { ...this.window }, shapes: this.shapes, spaceBar: this.spaceBar };
    for (const i of this.items) i.el.remove();
    this.items = []; this.spaceBar = null;
    this['clear-screen']();
  }
  'put-screen'() {
    if (!this.kept) return;
    this.clear();
    const k = this.kept; this.kept = null;
    for (const i of k.items) this.layer.append(i.el);
    Object.assign(this, { items: k.items, pen: k.pen, window: k.window, shapes: k.shapes, spaceBar: k.spaceBar });
  }

  box({ a, x, y, layout }) {
    const [bottom, top1, top2] = LAYOUT[layout] ?? LAYOUT[0x32];
    // all three painted: the whole screen is, and nothing under it is left
    if (a !== 0x80 && x !== 0x80 && y !== 0x80) { for (const i of this.items) i.el.remove(); this.items = []; }
    if (a !== 0x80) {
      const g = this.el('g');
      this.rect(1, 1, 138, bottom - 1, a, g);
      this.el('rect', { x: X(1) + 2, y: Y(1) + 1, width: X(138) - 4, height: Y(bottom - 2) - 2, fill: 'none', stroke: 'black', 'stroke-width': 4 }, g);
      this.add(1, bottom - 1, g, { left: 1, right: 138 });
      this.window = { color: a, bottom }; this.shapes = [];
    }
    if (x !== 0x80) { this.whiteLines(top1); this.fill(top1 + 2, top2 - 1, x); }
    if (y !== 0x80) { this.whiteLines(top2); this.fill(top2 + 2, 189, y); }
  }
  panel({ n: [n] }) {
    const p = PANELS[n];
    if (!p) return;
    // the box's two white rows at its top, then the box under them
    this.whiteLines(p.rows[0]);
    this.fill(p.rows[0] + 2, p.rows[1], p.fill);
    for (const y of p.more ?? []) this.whiteLines(y);
    Object.assign(this.pen, { paper: p.paper, ink: p.ink, centre: true, spacing: 1, gap: p.gap, y: p.y });
  }
  // $E000, which PART3 writes: rows 19 to 115 moved two bytes to the left in each half of the
  // screen, four bytes of it, seven dots. Bytes 3 to 38 of a half go to 1 to 36, the dots from 3.5
  // to 129.5, and bytes 37 and 38 stay, so what is at the right is drawn again as it moves on.
  // The view draws what is in those rows again, cut to them, over them, and moves it on seven dots
  // each time; each time, the strip at the right that stays is drawn again where it came to.
  scroll() {
    const top = 19, bottom = 115, left = 3.5, right = 129.5, s = this.scrolling;
    const clipped = (x0, x1, parent) => {
      const id = 'scroll-' + (this.clipIds = (this.clipIds ?? 0) + 1);
      // from half a pixel above row 19, where a smooth line along the row reaches
      this.el('rect', { x: X(x0), y: Y(top) - 1, width: X(x1 - x0), height: Y(bottom - top + 1) + 1 }, this.el('clipPath', { id }, this.svg));
      return this.el('g', { 'clip-path': `url(#${id})` }, parent);
    };
    const under = (x0, x1) => this.items.filter(i => i !== s?.item && i.top <= bottom && i.bottom >= top && i.left <= x1 && i.right >= x0);
    if (s?.item.el.isConnected && this.items.at(-1) === s.item) {
      // the strip, where it now is in what moves: seven dots on from where it was last time
      const tile = clipped(right, right + 7, this.el('g', { transform: `translate(${X(7 * s.n)} 0)` }, s.moved));
      for (const i of under(right, right + 7)) tile.append(i.el.cloneNode(true));
      s.n++;
      s.moved.setAttribute('transform', `translate(${X(-7 * s.n)} 0)`);
      return;
    }
    const g = clipped(left, right), moved = this.el('g', { transform: `translate(${X(-7)} 0)` }, g);
    // under it all, the window's color, wide enough to lie under the strips drawn as it moves on
    this.rect(left, top, 140 * 8, bottom - top + 1, this.window.color, moved);
    for (const i of under(left, 139)) moved.append(i.el.cloneNode(true));
    this.add(top, bottom, g, { left: 4, right: 129 });
    this.scrolling = { item: this.items.at(-1), moved, n: 1 };
  }
  // Nature Park's PART3 at $9796: dots `left` to `right` of rows `top` to `bottom` copied `by`
  // rows down. As the scroll, the view draws what is in those rows again, cut to where they go and
  // moved down; at each pass after, it moves on, and the rows at the top that stay are drawn again
  // where they come to.
  'shift-down'({ left, right, top, bottom, by }) {
    const s = this.shifting, cut = (y0, y1, parent) => {
      const id = 'shift-' + (this.clipIds = (this.clipIds ?? 0) + 1);
      this.el('rect', { x: X(left), y: Y(y0), width: X(right - left + 1), height: Y(y1 - y0) }, this.el('clipPath', { id }, this.svg));
      return this.el('g', { 'clip-path': `url(#${id})` }, parent);
    };
    const under = (y0, y1) => this.items.filter(i => i !== s?.item && i.top <= y1 && i.bottom >= y0 && i.left <= right && i.right >= left);
    if (s?.item.el.isConnected && this.items.at(-1) === s.item) {
      const tile = cut(top, top + by, this.el('g', { transform: `translate(0 ${Y(-by * s.n)})` }, s.moved));
      for (const i of under(top, top + by - 1)) tile.append(i.el.cloneNode(true));
      s.n++;
      s.moved.setAttribute('transform', `translate(0 ${Y(by * s.n)})`);
      return;
    }
    const g = cut(top + by, bottom + by + 1), moved = this.el('g', { transform: `translate(0 ${Y(by)})` }, g);
    this.rect(left, top - by * 60, right - left + 1, bottom - top + 1 + by * 61, this.window.color, moved);
    for (const i of under(top, bottom)) moved.append(i.el.cloneNode(true));
    this.add(top + by, bottom + by, g, { left, right });
    this.shifting = { item: this.items.at(-1), moved, n: 1 };
  }

  // A run of a row ($7947), or a dot ($5AF4), in a color. Runs one under another, the same across
  // and in the same color, are one rectangle, which grows a row at a time and covers what lies
  // wholly inside it: the racing car's square cleared, a row or a column at a time, takes the car.
  paint(color, left, right, y) {
    this.hide(left, right, y, y);
    const last = this.painted;
    if (last?.el.isConnected && last.color === color && last.left === left && last.right === right && last.bottom === y - 1) {
      last.bottom = y; last.el.setAttribute('height', Y(y - last.top + 1));
      const item = this.items.find(i => i.el === last.el);
      this.items = this.items.filter(i => { if (i !== item && i.top >= last.top && i.bottom <= y && i.left >= left && i.right <= right) { i.el.remove(); return false; } return true; });
      if (item) item.bottom = y;
      return;
    }
    const el = this.add(y, y, this.rect(left, y, right - left + 1, 1, color, null), { left, right });
    this.painted = { el, color, left, right, top: y, bottom: y };
  }
  span({ a, x, y, row }) { this.paint(a & 15, x, y, row); }
  dot({ a, x, y }) { this.paint(a & 15, x, x, y); }
  'white-lines'({ y }) { this.whiteLines(y); }
  'fill-rows'({ a, x, y }) { this.fill(y, y + x - 1, a); }

  picture({ words }) {
    const shapes = this.pictures.get(words.toUpperCase().replace(/_/g, ' '));
    if (!shapes) return;   // part1.pic and the like: the loader's own names for a file of pictures
    // drawn smooth, its edges may reach past the window's rows, which the original's never do
    const id = 'window-' + this.window.bottom;
    this.clips ??= new Set();
    if (!this.clips.has(id)) this.clips.add(id), this.el('rect', { x: 0, y: 0, width: X(140), height: Y(this.window.bottom) }, this.el('clipPath', { id }, this.svg));
    const g = this.el('g', { 'clip-path': `url(#${id})` }), scaled = this.el('g', { transform: 'scale(4 2)' }, g);
    scaled.innerHTML = elements(shapes, { crisp: false });
    this.add(1, this.window.bottom - 1, g, { covers: false, left: 1, right: 138 });
    this.shapes = this.shapes.concat(shapes);
    this.picturesShapes = shapes;   // the last picture's, which a problem may draw again (PROB1's colouring)
  }
  objects({ table }) { this.table = parseInt(table.slice(1), 16); }
  // how: 'whole' ($686D), 'keep' ($686F) or 'clear' ($6863), as @moonbase-machines/vector/objects.js and raster.js say
  object({ a, x, y }, how = 'whole') {
    const keep = how === 'keep', whole = how === 'whole';
    const table = this.tables.get(this.table);
    // Object 0 puts back the ground kept under the latest object drawn keeping it ($686F), which
    // takes that object away. Once put back, the ground is put back again to no further effect.
    if (a < 2) { if (this.kept?.isConnected) this.remove(this.kept); this.kept = null; return; }
    const o = table?.find(o => o.number === a);
    if (!o) return;
    // the dots of the object's clear color are left out, so the screen shows through them, but for
    // an object put down whole
    const rows = o.rows.map(row => row.map(c => !whole && c === o.clear ? undefined : c));
    const right = x + o.width - 1, bottom = y + o.height - 1;
    // An object put down whole hides every dot under it. What it leaves showing of another put
    // down whole is all of that one that stays: PROB6's car, drawn a dot on each time, leaves a
    // column of the one before, as the original's screen does, and no hair of the rest at the
    // edges of the page's pixels.
    if (whole) this.hide(x, right, y, bottom);
    const el = this.el('image', { href: this.image(rows), x: X(x), y: Y(y), width: X(o.width), height: Y(o.height), preserveAspectRatio: 'none', style: 'image-rendering: pixelated' });
    // put down whole, it hides for good whatever lies wholly inside it, as the crane its rope's dots
    this.add(y, bottom, el, { covers: whole, left: x, right });
    if (keep) this.kept = el;
    if (whole) this.items.at(-1).whole = { x, y, rows };
  }
  // The dots of objects put down whole that something opaque now covers, from column x0 to x1 and
  // row y0 to y1, taken out of their pictures: what is left of each is all of it that shows, and
  // none of what is covered shows at the edges of the page's pixels.
  hide(x0, x1, y0, y1) {
    for (const i of [...this.items]) {
      const w = i.whole;
      if (!w || w.x > x1 || w.x + w.rows[0].length - 1 < x0 || w.y > y1 || w.y + w.rows.length - 1 < y0) continue;
      let changed = false;
      const left = w.rows.map((row, dy) => row.map((c, dx) => {
        const px = w.x + dx, py = w.y + dy;
        if (c !== undefined && px >= x0 && px <= x1 && py >= y0 && py <= y1) { changed = true; return undefined; }
        return c;
      }));
      if (!changed) continue;
      if (left.every(row => row.every(c => c === undefined))) { this.remove(i.el); continue; }
      i.el.setAttribute('href', this.image(left)); w.rows = left;
    }
  }
  // rows of colors as a picture, undefined where nothing is drawn
  image(rows) {
    const canvas = document.createElement('canvas'); canvas.width = rows[0].length; canvas.height = rows.length;
    const cx = canvas.getContext('2d'), img = cx.createImageData(canvas.width, canvas.height);
    rows.forEach((row, dy) => row.forEach((c, dx) => {
      if (c === undefined) return;
      const [r, g, b] = COLORS[c]; img.data.set([r, g, b, 255], (dy * canvas.width + dx) * 4);
    }));
    cx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }
  'object-keep'(e) { this.object(e, 'keep'); }
  'object-mode'(e) { this.object(e, 'clear'); }
  // $76ED and $76F3: a key cap at the pen, which is left past it (vector.js)
  'key-at'({ a, x, y }) { this.pen.x = x; this.pen.y = y; this.key({ a }); }
  key({ a }) {
    const w = width(a);
    this.cap(a, this.pen.x, this.pen.y, this.layer, true, undefined, Math.max(4, w) + 4);
    this.pen.x += 1 + (w < 4 ? 4 - w : 0) + 1 + w + 3;
  }

  // a key cap: outlined in blue, filled magenta, its letter white
  cap(ch, x, y, parent, add, key, wide) {
    const label = { '\r': 'RETURN', '\x7f': 'DELETE' }[ch] ?? ch;
    const w = wide ?? (label.length > 1 ? 32 : 7);
    const g = this.el('g', key !== undefined ? { class: 'key', 'data-key': key } : {});
    this.el('rect', { x: X(x), y: Y(y - 2), width: X(w), height: Y(11), rx: 3, fill: rgb(1), stroke: rgb(13), 'stroke-width': 3 }, g);
    if (this.oldStyle) {
      // the engine's cap: the glyph a dot in from the left, or RETURN and DELETE spelt out
      let tw = 0; for (const c of label) tw += width(c) + 1;
      this.glyphs(g, label, x + Math.max(1, Math.round((w - tw + 1) / 2)), y, 15);
    } else {
      const t = this.el('text', { x: X(x + w / 2), y: Y(y + 7), fill: rgb(15), 'font-family': SANS, 'font-size': label.length > 1 ? 13 : 16, 'font-weight': 600, 'text-anchor': 'middle' }, g);
      t.textContent = this.modern(label);
    }
    if (add) { this.add(y - 2, y + 8, g, { covers: false, left: x, right: x + w }); this.items.at(-1).cap = true; } else parent.append(g);
    return g;
  }

  // Text, laid out as the engine lays it out (layout.js). A line is drawn a word at a time, each
  // word where the engine's font puts it and as wide, in dots, as the engine made it: the words
  // sit where the original's did, and read sharper.
  text({ words }) {
    if (this.textScreen.getAttribute('display') !== 'none') {
      for (const c of textLayout(words, this.textPen)) if (this.textCells[c.row]?.[c.col]) this.textCell(c.row, c.col, c.ch, c.inverse);
      return;
    }
    for (const line of layout(words, this.pen)) {
      const { top, tall } = line, size = tall ? 32 : 19;
      // the paper of the line's glyphs' cells, first, as the engine paints it: a text written
      // over another takes it away
      const cells = line.chars.filter(c => c.ch.charCodeAt(0) >= 0x20);
      if (cells.length) {
        const from = Math.min(...cells.map(c => c.x)), to = Math.max(...cells.map(c => c.x + width(c.ch))) - 1, rows = Math.min(9, line.height ?? 9) * (tall ? 2 : 1);
        this.add(top, top + rows - 1, this.rect(from, top, to - from + 1, rows, line.paper, null), { left: from, right: to });
      }
      const g = this.el('g', { 'font-family': SANS, 'font-size': size, 'font-weight': tall ? 700 : 500 });
      let word = null, left = 139, right = 0;
      const end = () => {
        if (!word) return;
        left = Math.min(left, word.x); right = Math.max(right, word.x + word.width);
        if (this.oldStyle) { this.glyphs(g, word.chars, word.x, top, line.ink, tall, line.paper); word = null; return; }
        const el = this.el('text', { y: Y(top + (tall ? 15 : 7)), 'data-x': X(word.x), 'data-width': X(word.width) }, g);
        // the part of a line before its first color is drawn in the ink the whole line ends with
        for (const c of word.chars) { const span = this.el('tspan', { fill: rgb(c.ink ?? line.ink) }, el); span.textContent = this.modern(c.ch); }
        word = null;
      };
      for (const c of line.chars) {
        if (c.ch.charCodeAt(0) <= 0x20) { end(); continue; }
        word ??= { x: c.x, width: 0, chars: [] };
        word.chars.push(c); word.width = c.x + width(c.ch) - word.x;
      }
      end();
      if (g.childNodes.length) { this.add(top, top + (tall ? 16 : 8), g, { covers: false, left, right }); this.fit(g); }
    }
  }
  // Each word of a line, drawn at x 0, is measured once it is on the page and then moved to its
  // place and scaled to the width the engine gave it. Browsers differ in how they stretch text to
  // a length, and a measured scale looks the same in all of them.
  fit(g) {
    for (const el of g.querySelectorAll('text[data-width]')) {
      const natural = el.getComputedTextLength();
      if (natural > 0) el.setAttribute('transform', `translate(${el.dataset.x} 0) scale(${el.dataset.width / natural} 1)`);
    }
  }
  // The old style: the engine's own glyphs, each set dot a square, over the glyph's cell in the
  // paper color. `chars` is a string, or the characters of a line with the ink each was given
  // (the part of a line before its first color takes the ink the line ends with). Returns the
  // dot after the last glyph.
  glyphs(parent, chars, x, y, ink, tall = false, paper) {
    const list = typeof chars === 'string' ? [...chars].map(ch => ({ ch })) : chars, h = tall ? 2 : 1;
    const paths = new Map();
    for (const c of list) {
      const w = width(c.ch), colour = c.ink ?? ink;
      if (paper !== undefined) this.rect(x, y, w, 9 * h, paper, parent);
      let d = paths.get(colour) ?? '';
      for (const [gx, gy] of dots(c.ch)) d += `M${X(x + gx)} ${Y(y + gy * h)}h4v${2 * h}h-4z`;
      paths.set(colour, d);
      x += w + 1;
    }
    for (const [colour, d] of paths) if (d) this.el('path', { d, fill: rgb(colour) }, parent);
    return x;
  }

  // plain words at dot x and row y, in the engine's font widths with spacing 1, fitted as a text's
  write(parent, text, x, y, ink = 15) {
    if (this.oldStyle) return this.glyphs(parent, text, x, y, ink);
    const g = this.el('g', { 'font-family': SANS, 'font-size': 19, 'font-weight': 500, fill: rgb(ink) }, parent);
    for (const part of text.split(' ')) {
      if (part) {
        let w = 0; for (const ch of part) w += width(ch) + 1;
        const el = this.el('text', { y: Y(y + 7), 'data-x': X(x), 'data-width': X(w - 1) }, g);
        el.textContent = this.modern(part);
        x += w;
      }
      x += width(' ') + 1;
    }
    this.fit(g);
    return x;
  }


  line({ x0, x1, y0, y1, color }) {
    this.add(Math.min(y0, y1), Math.max(y0, y1), this.el('line', { x1: X(x0 + 0.5), y1: Y(y0 + 0.5), x2: X(x1 + 0.5), y2: Y(y1 + 0.5), stroke: rgb(color), 'stroke-width': 3, 'stroke-linecap': 'round' }), { covers: false, left: Math.min(x0, x1), right: Math.max(x0, x1) });
  }
  // $67B9 fills from column x to x + width, both ends, down `height` rows; $677E draws its four
  // lines from corner to corner, x to x + width and y to y + height
  rectangle({ a, x, y, width, height }) { this.solid(a, x, y, width + 1, height); }
  'rectangle-outline'({ a, x, y, width, height }) {
    const w = width + 1, h = height + 1;
    this.add(y, y + h - 1, this.el('rect', { x: X(x) + 2, y: Y(y) + 1, width: X(w) - 4, height: Y(h) - 2, fill: 'none', stroke: rgb(a), 'stroke-width': 3 }), { covers: false, left: x, right: x + w - 1 });
  }
  // a rectangle w dots across and h down, filled
  solid(a, x, y, w, h) { this.add(y, y + h - 1, this.rect(x, y, w, h, a, null), { left: x, right: x + w - 1 }); }

  // what the view shows while the engine waits: the space bar's button, or the keys it asks for
  prompts() {
    this.prompt.replaceChildren();
    const e = this.engine, step = e.waitingOn;
    if (!step) return;
    const name = step.words?.[0] ?? step.name;
    if (name === 'wait' || name === 'wait-erase' || name === 'wait-or-escape') {
      const y = (e.mem[this.vars.layout] & 15) === 1 ? 178 : 170;
      const g = this.el('g', { class: 'key', 'data-key': 32 }, this.prompt);
      this.el('rect', { x: X(46), y: Y(y), width: X(47), height: Y(11), rx: 4, fill: rgb(1), stroke: rgb(13), 'stroke-width': 3 }, g);
      if (this.oldStyle) this.glyphs(g, 'SPACE BAR', 48, y + 2, 15);
      else { const t = this.el('text', { x: X(69.5), y: Y(y + 8), fill: rgb(15), 'font-family': SANS, 'font-size': 15, 'font-weight': 600, 'text-anchor': 'middle' }, g); t.textContent = 'SPACE BAR'; }
      this.spaceBar = { y, erase: name === 'wait-erase', el: g };
    } else if (name === 'ask' || name === 'ask-mode' || name === 'ask-escape') {
      this.rect(1, 162, 138, 28, 5, this.prompt);   // box 2 inside its white edges, as panel 5 clears it
      const mode = e.askMode, keys = [];
      if (mode === 0x80) ARROWS.forEach((a, i) => keys.push([a, [8, 21, 10, 11][i]]));
      else if (mode >= 0xb1 && mode < 0xba) for (let k = 0x31; k <= (mode & 0x7f); k++) keys.push([String.fromCharCode(k), k]);
      else for (let k = 0x41; k <= (mode & 0x5f); k++) keys.push([String.fromCharCode(k), k]);
      const label = (s, x, y) => this.write(this.prompt, s, x, y);
      if (e.asked === null) {
        label('Press', 4, 166);
        keys.forEach(([s, k], i) => { if (i === keys.length - 1 && mode !== 0x80 && keys.length > 1) label('or', 31 + 10 * i, 166); this.cap(s, 31 + 10 * i + (i === keys.length - 1 && mode !== 0x80 && keys.length > 1 ? 10 : 0), 166, this.prompt, false, k); });
        if (mode === 0x80) [[58, 62], [74, 62], [66, 71], [66, 53]].forEach(([x, y], i) => this.cap(ARROWS[i], x, y, this.prompt, false, keys[i][1]));
      } else {
        const [s] = keys[e.asked.place];
        this.cap(s, 31 + 10 * e.asked.place, 166, this.prompt, false);   // the chosen key stays, the rest of its row goes
        label('Press', 4, 179); this.cap('\r', 31, 179, this.prompt, false, 13); label('or', 67, 179); this.cap('\x7f', 78, 179, this.prompt, false, 127);
        if (mode === 0x80) this.cap(ARROWS[e.asked.place], [58, 74, 66, 66][e.asked.place], [62, 62, 71, 53][e.asked.place], this.prompt, false);
      }
    }
  }
}
