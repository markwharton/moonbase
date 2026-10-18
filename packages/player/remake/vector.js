// The routines of a vector engine title, for the remake engine, as its title.js `map` names them: what each step
// of a scene does. Each gives the event the original's routine gives
// (events.js), does what the original did to the registers, the flags and the memory that the
// scenes read, and paints the original's screen for the scenes that read it back. The rules for
// the keys, the random numbers and the waits are the original's, from PART0 (docs in
// @moonbase-machines/vector's README).
import { describe, result, TAKES, nothing } from './events.js';
import { helpers } from './problems.js';
import { tables, carry } from '@moonbase-machines/vector/objects.js';
import { pictures } from '@moonbase-machines/vector/pictures.js';
import { width, useFont } from '@moonbase-machines/vector/font.js';
import { Raster } from './raster.js';
import { Files } from '@moonbase-machines/apple2e/mli.js';
import { layout, resolve, PANELS, textLayout, textPen, textPage } from './layout.js';

// A vector title's map (its title.js `map`): `volume`, its disk's volume; `objects`, the routine that sets the table
// of objects; `seed` ({ at, used }), where the random routine keeps its seed and the byte that is $FF until its first
// call; `menu`, the Main Menu, which the key reader jumps to on control-E; `visit` ({ at, kept, back }), a way to its
// menus instead, the screen kept and put back (Nature Park's); `keyPanel`, the arrows' panel; `vars`, where the
// engine keeps what the remake reads (`zero`, how far up the zero page its routines' inputs are; the screen's
// layout; the difficulty; practice; repeats; the sound flag, on with its `soundOn` bit); `loads`, where its code
// files load when its catalog has lost it; `askClearsCarry`, `countInX`; `modern`, characters a modern font draws
// otherwise; `routines`, its engine's routines by address, each the name of its step; `problems`, each problem's own
// routines that draw, by the problem's number.

// A game's code files, PART0, the parts and the problems, each with the address it loads at: the map's `loads`, by
// the file's name or its name without the digit, or else the catalog's
export function codeFiles(map, volume) {
  const loads = map?.loads ?? {};
  return Object.entries(volume).filter(([n]) => /^(PART|PROB)\d$/.test(n))
    .map(([name, f]) => ({ name, bytes: Uint8Array.from(atob(f.data), c => c.charCodeAt(0)), origin: loads[name] ?? loads[name.slice(0, -1)] ?? f.aux }));
}

const KEY = { escape: 27, space: 32, return: 13, delete: 127, left: 8, right: 21, down: 10, up: 11, menu: 5 };

// the inputs of a step: numbers, a register's name, or an address for the table of objects
function inputs(e, name, args) {
  const takes = TAKES[name] || '', fixed = [];
  let k = 0;
  if (name === 'panel') fixed.push(args[k++]);
  const regs = { a: e.a, x: e.x, y: e.y };
  if (name === 'objects' && args[0]?.startsWith?.('$')) { const t = parseInt(args[k++].slice(1), 16); regs.x = t & 0xff; regs.y = t >> 8; }
  else for (const r of takes) {
    const v = args[k++];
    if (v === undefined || v === r) continue;
    regs[r] = typeof v === 'object' ? v.string.charCodeAt(0) | 0x80 : v.startsWith('$') ? e.mem[parseInt(v.slice(1), 16)] : +v;
  }
  e.a = regs.a & 0xff; e.x = regs.x & 0xff; e.y = regs.y & 0xff;
  return { fixed, rest: args.slice(k) };
}

// A step that takes a key: its event once, then it waits until a key comes. Control-E, at any
// key the original read, went to the Main Menu and dropped everything called.
function waiting(e, step, name, fixed, words, take) {
  if (e.waitingOn !== step) { e.emit(describe(name, fixed, e, words)); e.waitingOn = step; e.asked = null; }
  for (;;) {
    const k = e.key();
    if (k === undefined) return 'wait';
    if (k === KEY.menu && e.title.menu) e.leave(...e.title.menu);
    if (e.title.visit?.[k]) { e.visit(k); return 'wait'; }
    if (take(k)) { e.waitingOn = null; return; }
  }
}

// $6415 calls the problem's own routines as a choice is made and taken back ($F729 and $F74B,
// then $F776 and $F6CE, in PROB2): drawing that happens inside the ask. The problem gives them as
// generators in e.askHooks, which run to their end here, inside, so they are drawn and no step.
function quietly(e, run) {
  if (!run) return;
  e.inside++;
  try { for (let r = run.next(); !r.done; r = run.next()) if (r.value === 'wait') throw new Error('a choice drawn inside the ask cannot wait'); }
  finally { e.inside--; }
}

// The disk's objects, by the address of their table, for the carry the object routine leaves.
// `title.disk` is the title's disk from its game's data.
function objectsOf(title) {
  if (title.objectTables || !title.disk) return title.objectTables;
  const files = codeFiles(title.map, Object.values(title.disk.volumes)[0]);
  return title.objectTables = new Map(tables(files, title.map.objects).map(t => [t.address, t.objects]));
}

// The disk's pictures, by name, for the screen model
function picturesOf(title) {
  if (title.pictureShapes || !title.disk) return title.pictureShapes;
  const volume = Object.values(title.disk.volumes)[0], map = new Map();
  for (const [name, f] of Object.entries(volume)) if (/^PICS\d$/.test(name)) for (const p of pictures(Uint8Array.from(atob(f.data), c => c.charCodeAt(0)))) map.set(p.name, p.shapes);
  return title.pictureShapes = map;
}

// a picture's shapes by its name, as the disk has them, for a problem that works with them
export const pictureShapes = (title, name) => picturesOf(title)?.get(name.toUpperCase().replace(/_/g, ' '));

export function vectorRoutines(title) {
  // where this engine keeps its variables, and its routines' inputs in the zero page
  const V = title.map.vars, Z = z => V.zero + z;
  useFont(title.font);
  // what an object's routine leaves: the carry, and in the row its rows were counted in (zero
  // page $02 from the engine's), the row past the object's bottom, which a span after it may take
  const objectCarry = e => {
    if (e.a < 2) return;   // putting ground back ends another way; no scene is known to use its carry
    const o = objectsOf(title)?.get(e.objectTable)?.find(o => o.number === e.a);
    if (o) { e.c = carry(o, e.x); e.mem[Z(0x02)] = (e.y + o.height) & 0xff; }
  };
  // The original's screen, dot for dot (raster.js), which each step paints as the original's
  // routine painted, for read-dot; and the text state that lasts from text to text.
  const raster = title.raster ??= new Raster();
  const pen = title.pen ??= { x: 0, y: 0, margin: 0, centre: false, spacing: 1, gap: 0, ink: 15, paper: 10 };
  // The text screen, where the menus are: its characters, its pen, and whether it is showing.
  // `show` ($5BA9) puts the graphics back.
  title.text ??= { showing: false, pen: textPen(), page: textPage() };
  const objectOf = (e, n) => objectsOf(title)?.get(e.objectTable)?.find(o => o.number === n);
  const drawObject = (e, how) => { if (e.a < 2) return raster.restore(); const o = objectOf(e, e.a); if (o) raster.object(o, e.x, e.y, how); };
  // a key cap at the pen, as $76F3 draws it: outlined in color 13 and filled with 1, four dots
  // wider than the glyph or than four, and the glyph in 15 from a dot on, after a spacer that
  // brings a narrow glyph to the cap's right; the pen is left two dots past the text's end
  const cap = ch => {
    const w = width(ch), x = pen.x, spacer = (w < 4 ? 4 - w : 0) + 1;
    raster.rectangle(1, x, pen.y - 2, Math.max(4, w) + 4, 11); raster.outline(13, x, pen.y - 2, Math.max(4, w) + 4, 11);   // ($5C83)
    raster.glyph(ch, x + 1 + spacer, pen.y, 15, 1, 1, 8);   // its text's lines are 8 high
    pen.x = x + 1 + spacer + w + 1 + 2;
  };
  // the arrows' panel, all four caps (n 0) or the nth, as the ask draws it in its arrow mode
  const keyPanel = n => {
    const k = title.map.keyPanel;
    if (!k) return;
    const c = raster.get(2, 2), { x, y } = pen;
    for (let r = k.top; r < k.top + k.rows; r++) raster.span(c, k.left, k.right, r);
    k.caps.forEach(([cx, cy, ch], i) => { if (!n || n === i + 1) { pen.x = cx; pen.y = cy; cap(String.fromCharCode(ch & 0x7f)); } });
    Object.assign(pen, { x, y });
  };
  // a text on the graphics screen, as $6CE2 paints it
  const print = (e, words) => { for (const line of layout(resolve(words, e.mem), pen)) for (const c of line.chars) raster.glyph(c.ch, c.x, line.top, c.ink ?? line.ink, line.paper, line.tall ? 2 : 1, line.height, pen.spacing); };
  // object n of the table set last, put as `how` ('whole', 'keep' or 'clear')
  const put = (e, n, x, y, how) => { const o = objectOf(e, n); if (o) raster.object(o, x, y, how); };
  // what a title's painters (titles/<title>/paint.js) paint the model with
  title.model = { raster, pen, cap, keyPanel, print, put };
  const simple = (name, draw) => (e, args, step) => {
    let { fixed, rest } = inputs(e, name, args);
    const words = rest.map(r => typeof r === 'object' ? r.string : r).join(' ');
    e.emit(describe(name, fixed, e, rest.length ? words : undefined, z => e.mem[Z(z)]));
    rest = rest.map(r => typeof r === 'object' ? r.string : r);
    draw?.(e, fixed, rest);
  };
  // $641B: A $80 asks for an arrow, $B1 to $B9 a digit from 1, any other a letter from A. The
  // key chosen is then confirmed with return, or taken back with delete or the left arrow.
  // Gives X the key's place from 0, Y twice that, and A the key, its high bit set from 'A' up.
  // Animal Rescue's leaves the carry set for a letter ($6572); Nature Park's clears it ($5A56).
  // Nature Park's $58DA, ask-escape, also takes escape, at either key, and gives A 27 and the
  // carry set, and X the keyboard's byte for it, $9B, as the key read left it ($5A58, a jump into
  // the middle of a BIT that leaves only SEC and RTS).
  const letterCarry = !title.map.askClearsCarry;
  const asking = name => (e, args, step) => {
    if (e.waitingOn !== step) inputs(e, name, args);
    const mode = e.waitingOn === step ? e.askMode : e.a;
    e.askMode = mode;
    const arrows = [KEY.left, KEY.right, KEY.down, KEY.up];
    if (mode === 0x80 && e.waitingOn !== step) keyPanel(0);
    const r = waiting(e, step, name, [], undefined, k => {
      if (name === 'ask-escape' && k === KEY.escape) { e.a = e.flags(27); e.x = 0x9b; e.c = 1; e.asked = null; return true; }
      if (e.asked === null) {
        let place = -1, key = k;
        if (mode === 0x80) { place = arrows.indexOf(k); key = 0xdb + place; if (place >= 0) keyPanel(place + 1); }
        else if (mode >= 0xb1 && mode < 0xba) { if (k >= 0x31 && k <= (mode & 0x7f)) place = k - 0x31; }
        else { key = k & 0x5f; if (key >= 0x41 && key <= (mode & 0x5f & 0x7f)) { place = key - 0x41; key |= 0x80; } }
        if (place >= 0) { e.asked = { place, key }; if (name === 'ask-mode') quietly(e, e.askHooks?.chose?.(place)); }
        return false;
      }
      if (k === KEY.return) { e.x = e.asked.place; e.y = 2 * e.x; e.a = e.asked.key; e.c = letterCarry && e.a >= 0xc1 ? 1 : 0; return true; }
      if (k === KEY.delete || k === KEY.left) { if (name === 'ask-mode') quietly(e, e.askHooks?.undo?.(e.asked.place)); if (mode === 0x80) keyPanel(0); e.asked = null; }
      return false;
    });
    if (r !== 'wait') { e.mem[V.layout] = 0x22; e.emit(result(name, e)); }   // $655E: panel 6, which sets $22
    return r;
  };

  const routines = {
    // graphics shown: $C01D reads with its high bit set, as a scene may test before it shows them
    show: simple('show', e => { title.text.showing = false; e.mem[0xc01d] = 0x80; }),
    // $573D: the text screen cleared ($7645) and shown ($5BCB), which the view draws and is no step
    'text-screen': e => {
      Object.assign(title.text, { showing: true, page: textPage() });
      e.mem[0xc01d] = 0;
      e.inside++; e.emit({ step: 'text-screen' }); e.inside--;
    },
    picture: simple('picture', (e, f, [name]) => { const shapes = picturesOf(title)?.get(name.toUpperCase().replace(/_/g, ' ')); if (shapes) raster.picture(shapes); }),
    box: simple('box', e => raster.box(e.mem[V.layout], e.a, e.x, e.y)),
    // a panel sets the layout it clears to, as the original's panels do ($6299 and the rest)
    panel: simple('panel', (e, [n]) => {
      const p = PANELS[n];
      if (!p) return;
      e.mem[V.layout] = p.layout;
      raster.panel(p.rows[0], p.rows[1], p.fill);
      for (const y of p.more ?? []) raster.whiteLines(y);
      Object.assign(pen, { paper: p.paper, ink: p.ink, centre: true, spacing: 1, gap: p.gap, y: p.y });
    }),
    // A code's byte may be written {3:$63D8}, and a character {$4DA5}, for a byte the scene's code
    // writes into its own text before printing it: it is read from memory when the text is shown.
    // On the text screen the text goes into its characters, and the graphics stay as they are.
    text: (e, args) => {
      const words = args[0].string
        .replace(/\{([0-9a-f]+):([^}]*)\}/g, (all, code, bytes) => '{' + code + ':' + bytes.split(',').map(b => b.startsWith('$') ? e.mem[parseInt(b.slice(1), 16)].toString(16) : b).join(',') + '}')
        .replace(/\{\$([0-9A-Fa-f]{4})\}/g, (all, at) => String.fromCharCode(e.mem[parseInt(at, 16)] & 0x7f));
      e.emit(describe('text', [], e, words));
      if (title.text.showing) { for (const c of textLayout(resolve(words, e.mem), title.text.pen)) if (title.text.page[c.row]?.[c.col]) title.text.page[c.row][c.col] = { ch: c.ch, inverse: c.inverse }; return; }
      print(e, words);
    },
    objects: simple('objects', e => { e.objectTable = e.x | e.y << 8; }),
    // an object drawn leaves the carry the original's routine left ($6B0F), which a scene may add in
    object: simple('object', e => { drawObject(e, 'whole'); objectCarry(e); }),
    'object-keep': simple('object-keep', e => { drawObject(e, 'keep'); objectCarry(e); }),
    // $6863: the clear color shows the ground, from a buffer of its own, and no ground is kept
    'object-mode': simple('object-mode', e => drawObject(e, 'clear')),
    // $76ED sets the pen to X and Y, and goes on into $76F3
    'key-at': simple('key-at', e => { pen.x = e.x; pen.y = e.y; cap(String.fromCharCode(e.a & 0x7f)); }),
    key: simple('key', e => cap(String.fromCharCode(e.a & 0x7f))),
    'white-lines': simple('white-lines', e => raster.whiteLines(e.y)),
    'fill-rows': simple('fill-rows', e => raster.rows(e.a, e.x, e.y, e.c)),
    span: simple('span', e => raster.span(e.a, e.x, e.y, e.mem[Z(0x02)])),
    // a dot, which returns with A its place in its group of seven times 16, and its color ($5B45)
    dot: simple('dot', e => { raster.set(e.x, e.y, e.a); e.a = (e.x % 7) << 4 | e.a & 15; }),
    line: simple('line', e => raster.line(e.mem[Z(0x11)], e.mem[Z(0x00)], e.mem[Z(0x02)], e.mem[Z(0x01)], e.mem[Z(0x03)])),
    // $67B9 fills columns x to x + $0E, both ends, down $0F rows; $677E's four lines go from x to
    // x + $0E and from y to y + $0F
    rectangle: simple('rectangle', e => raster.rectangle(e.a, e.x, e.y, e.mem[Z(0x0e)] + 1, e.mem[Z(0x0f)])),
    'rectangle-outline': simple('rectangle-outline', e => raster.outline(e.a, e.x, e.y, e.mem[Z(0x0e)] + 1, e.mem[Z(0x0f)] + 1)),
    flash: simple('flash'),
    // $5B4C: the color of a dot of the original's screen, from the screen model
    'read-dot': (e, args) => { inputs(e, 'read-dot', args); e.emit(describe('read-dot', [], e)); e.a = e.flags(raster.get(e.x, e.y)); e.emit(result('read-dot', e)); },
    'key-panel': simple('key-panel', e => keyPanel(e.a)), 'keep-span': simple('keep-span'), 'put-span': simple('put-span'), 'invert-span': simple('invert-span'),
    button: simple('button'),
    // a beep of 0 does nothing, and is no step (events.js)
    beep: (e, args) => { inputs(e, 'beep', args); if (!nothing('beep', e.a)) e.emit(describe('beep', [], e)); },
    // a sound's five bytes; a byte may be an address, for one the scene's code writes before it plays
    sound: (e, args) => e.emit(describe('sound', [], e, args.map(b => b.startsWith('$') ? e.mem[parseInt(b.slice(1), 16)].toString(16) : b).join(' '))),
    // PART3's own code, written at $E000, moves the picture a step to the left: drawn, and no step
    scroll: e => { raster.scroll(); e.inside++; e.emit({ step: 'scroll' }); e.inside--; },
    // Nature Park's PART3 at $9796: the dots from `left` to `right` of rows `top` to `bottom` copied
    // `by` rows down, from the bottom row up, so the rows at the top stay to be copied again:
    // drawing, and no step
    'shift-down': (e, args) => {
      const [left, right, top, bottom, by] = args.map(Number);
      for (let r = bottom; r >= top; r--) for (let x = left; x <= right; x++) raster.set(x, r + by, raster.get(x, r));
      e.inside++; e.emit({ step: 'shift-down', left, right, top, bottom, by }); e.inside--;
    },
    // a part's title marks where the original's loader starts a part
    part: simple('part'),

    // the waits, $5C23, $5C08 and $5C20: the space bar, or for the last escape too, which it
    // returns with the carry set
    wait: (e, args, step) => waiting(e, step, 'wait', [], undefined, k => k === KEY.space && (e.a = 32, e.c = 0, true)),
    'wait-erase': (e, args, step) => waiting(e, step, 'wait-erase', [], undefined, k => k === KEY.space),
    'wait-or-escape': (e, args, step) => {
      const r = waiting(e, step, 'wait-or-escape', [], undefined, k => (k === KEY.space || k === KEY.escape) && (e.c = k === KEY.escape ? 1 : 0, e.a = k, true));
      if (r !== 'wait') e.emit(result('wait-or-escape', e));
      return r;
    },

    // $641B, the ask for a key, above
    ask: asking('ask'),
    // $6415: the same, and the problem draws the choice as it is made, which is left to the view
    'ask-mode': asking('ask-mode'),
    'ask-escape': asking('ask-escape'),

    // $60C2: the seed times 259, divided by 65535 over n. The seed is at $6131 and $6130 says it is
    // in use; a pilot sets it at the first call, as it does on the original.
    random: (e, args) => {
      const { fixed } = inputs(e, 'random', args);
      e.emit(describe('random', fixed, e));
      const n = e.a;
      const { at, used } = title.map.seed;
      if (e.mem[used] === 0xff && title.seed !== undefined) { e.mem[at] = title.seed & 0xff; e.mem[at + 1] = title.seed >> 8; }
      let seed = e.mem[at] | e.mem[at + 1] << 8;
      seed = (seed * 259) & 0xffff;
      e.mem[at] = seed & 0xff; e.mem[at + 1] = seed >> 8; e.mem[used] = n;
      const q = n ? Math.floor(0xffff / n) : 0xffff;
      e.a = Math.floor(seed / q) & 0xff; e.c = 0;
      e.emit(result('random', e));
    },

    multiply: (e, args) => { inputs(e, 'multiply', args); e.emit(describe('multiply', [], e)); const p = e.a * e.x; e.a = p & 0xff; e.x = p >> 8; e.emit(result('multiply', e)); },
    divide: (e, args) => { inputs(e, 'divide', args); e.emit(describe('divide', [], e)); const d = e.x | e.y << 8, n = e.a || 1; e.a = Math.floor(d / n) & 0xff; e.x = d % n; e.emit(result('divide', e)); },

    // a problem, written by hand for the remake (its title's problems.js). It runs
    // as its own script or function and returns here; the carry comes back clear, as it does on
    // the original when the problem loaded. Nature Park's ($4DC3) takes the number of times from X
    // for a problem from the Problems menu, in place of the teacher's, until the problem is done.
    problem: (e, args, step) => {
      if (!e.problem) {
        inputs(e, 'problem', args); e.emit(describe('problem', [], e)); e.mem[V.practice] = e.c ? 0x80 : 0;
        e.repeats = e.mem[V.repeats];
        if (title.map.countInX && e.c) e.mem[V.repeats] = e.x;
        const run = title.problems?.[e.a];
        if (!run) throw new Error('problem ' + e.a + ' is not written yet');
        // the problem's file, where the loader puts it, for the tables a problem reads from it
        const file = title.disk && codeFiles(title.map, Object.values(title.disk.volumes)[0]).find(f => f.name === 'PROB' + e.a);
        if (file) e.mem.set(file.bytes, file.origin);
        e.problem = run(helpers(e, routines));
      }
      if (!e.problem.next().done) return 'wait';
      e.problem = null; e.c = 0; e.mem[V.repeats] = e.repeats; e.emit(result('problem', e));
    },

    // $5D66 and $5DA9: a key, as the title's own loops read it; A the key, the carry set for escape
    'read-key': (e, args, step) => {
      if (e.waitingOn !== step) { e.waitingOn = step; e.asked = null; }
      const k = e.key();
      if (k === undefined) return 'wait';
      if (title.visit?.[k]) { e.visit(k); return 'wait'; }
      e.waitingOn = null;
      if (k === KEY.menu && title.menu) e.leave(...title.menu);
      e.a = e.flags(k & 0x7f); e.c = k === KEY.escape ? 1 : 0;
      e.emit(result('read-key', e));
    },

    // The loader's splash, before PART0 runs: TITLE, a double hi-res picture, until a key. The
    // original's engine is not in yet, so it is no step; the view draws it.
    splash: (e, args, step) => {
      if (e.waitingOn !== step) { e.inside++; e.emit({ step: 'splash' }); e.inside--; e.waitingOn = step; }
      if (e.key() === undefined) return 'wait';
      e.waitingOn = null;
    },
    // Nature Park's $4C00: both halves of the graphics screen cleared to black, which is no step
    'clear-screen': e => {
      for (const row of raster.dots) row.fill(0);
      e.inside++; e.emit({ step: 'clear-screen' }); e.inside--;
    },

    // A delay the original made by counting X and Y down, given as the milliseconds it took: no
    // step, and nothing changes but the registers, both 0 when the count is done. The page waits.
    pause: (e, [ms]) => { e.x = 0; e.y = 0; e.flags(0); e.inside++; e.emit({ step: 'pause', ms: +ms }); e.inside--; },

    // End, on the Main Menu: ProDOS's quit, through $0200, and the title is over
    quit: e => { e.ended = true; },

    // a part of the title not written yet: the run stops here and says which
    unwritten: (e, [what]) => { throw new Error('not written yet: ' + (what?.string ?? what)); },

    // a jump or a call into PART0's own code, which the title's scripts have: the title's
    // `entries` say where each address is
    'goto-engine': (e, [at]) => { const to = title.entries?.[at]; if (!to) throw new Error('no script for ' + at); e.enter(...to); },
    'call-engine': (e, [at]) => { const to = title.entries?.[at]; if (!to) throw new Error('no script for ' + at); e.stack.push({ name: e.name, pc: e.pc }); e.enter(...to); },

    // the loader: part A's script, from its start, after the title has shown it
    // (and, with the disk out of its drive, it comes back, as the loader's read does with its error)
    'load-part': (e) => {
      const volume = Object.keys(title.disk?.volumes ?? {})[0]?.toUpperCase();
      if (title.files?.out?.has(volume)) { e.a = e.flags(0x45); e.c = 1; return; }
      e.stack = []; e.enter('part' + e.a, undefined, true);
    },

    // Nature Park's settings written to its own disk through the loader ($08E9): ProDOS's
    // SET_FILE_INFO, answered from the disks as @moonbase-machines/apple2e/mli.js answers the original's call: the
    // write-protect error ($2B) with the tab on, no volume ($45) with the disk out of its drive,
    // and the carry set for either; clear when it goes through
    'write-settings': e => {
      const files = title.files ??= new Files(title.disk), volume = Object.keys(title.disk.volumes)[0].toUpperCase();
      const err = files.out?.has(volume) ? 0x45 : files.disks[volume] === 'protected' ? 0x2b : 0;
      e.a = e.flags(err); e.c = err ? 1 : 0;
    },
  };
  return routines;
}
