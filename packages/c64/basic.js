// What Commodore BASIC does for a program, for a remake whose BASIC (or Blitz!'s code) is
// compiled to JavaScript (basic-compile.js): its variables and arrays, its numbers printed as it
// prints them, its strings as their bytes, its FOR and GOSUB on one stack, its DATA, and its
// statements' calls into the KERNAL, made as the original makes them, through the engine, so
// that they are the same events.
//
//   const b = new Basic(engine, { data, quiet })
//     data    where the program's DATA is in memory (Blitz!'s: each item its length and its text,
//             $FF at the end)
//     quiet   BASIC's own interpreter, in the ROM, ran the program: its calls into the KERNAL are
//             the ROM's, and no events (GOLDFIELDS, the boot)
//
// Numbers are JavaScript's; a whole-number variable (%) floors what is stored, as BASIC does, and
// BASIC's errors stop the remake with BASIC's own words. The rules for numbers (FOUT, VAL, RND,
// the errors) are BASIC's, kept once for every layer in numbers.js.

import { fail, int16, fout, val, scanNumber, seedRandom, nextRandom, BasicError } from './numbers.js';

export class Basic {
  constructor(e, { data = 0, quiet = false } = {}) {
    this.e = e; this.data = this.dataStart = data; this.quiet = quiet;
    this.v = Object.create(null); this.arrays = Object.create(null); this.stack = [];
    this.channel = 0;
  }
  // where the operation is that may fail next, as Blitz!'s program counter has it then: BASIC's
  // error gives it as its line (the engine's `error`)
  here(at) { this.at = at; }
  // a variable's value, 0 or "" until it is set
  get(n) { return this.v[n] ?? (n.endsWith('$') ? '' : 0); }
  set(n, x) {
    if (n.endsWith('$')) { if (typeof x !== 'string') fail('TYPE MISMATCH'); if (x.length > 255) fail('STRING TOO LONG'); this.v[n] = x; return; }
    if (typeof x !== 'number') fail('TYPE MISMATCH');
    this.v[n] = n.endsWith('%') ? int16(x) : x;
  }
  clr() { this.v = Object.create(null); this.arrays = Object.create(null); this.stack = []; this.fns = null; }
  // RUN: every file closed (the KERNAL's CLALL), the variables cleared and DATA from its start,
  // the program run again to its DIMs and on from `back`
  run(back) { const m = this.e.mem; m[0x98] = 0; m[0x99] = 0; m[0x9a] = 3; this.clr(); this.data = this.dataStart; this.datum = 0; this.resume = back; }

  // arrays: DIM's sizes are the last index of each dimension
  dim(n, sizes) { if (this.arrays[n]) fail('REDIM\'D ARRAY'); const dims = sizes.map(s => int16(s) + 1), size = dims.reduce((a, b) => a * b, 1); this.arrays[n] = { dims, data: new Array(size).fill(n.endsWith('$') ? '' : 0) }; }
  place(n, i) {
    const a = this.arrays[n] ?? (this.dim(n, i.map(() => 10)), this.arrays[n]);
    if (i.length !== a.dims.length) fail('BAD SUBSCRIPT');
    let k = 0; for (let d = 0; d < i.length; d++) { const x = int16(i[d]); if (x < 0 || x >= a.dims[d]) fail('BAD SUBSCRIPT'); k = k * a.dims[d] + x; }
    return [a, k];
  }
  elem(n, i) { const [a, k] = this.place(n, i); return a.data[k]; }
  setElem(n, i, x) {
    const [a, k] = this.place(n, i);
    if (n.endsWith('$') !== (typeof x === 'string')) fail('TYPE MISMATCH');
    a.data[k] = n.endsWith('%') ? int16(x) : x;
  }

  // operators: comparisons give -1 or 0, AND, OR and NOT work on whole numbers of 16 bits
  add(a, b) { if (typeof a !== typeof b) fail('TYPE MISMATCH'); if (typeof a === 'string' && a.length + b.length > 255) fail('STRING TOO LONG'); return a + b; }
  num(a) { if (typeof a !== 'number') fail('TYPE MISMATCH'); return a; }
  cmp(a, b, o) {
    if (typeof a !== typeof b) fail('TYPE MISMATCH');
    const c = a < b ? -1 : a > b ? 1 : 0;
    return ({ '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 })[o] ? -1 : 0;
  }
  and(a, b) { return int16(this.num(a)) & int16(this.num(b)); }
  or(a, b) { return int16(this.num(a)) | int16(this.num(b)); }
  not(a) { return ~int16(this.num(a)); }
  div(a, b) { if (this.num(b) === 0) fail('DIVISION BY ZERO'); return this.num(a) / b; }

  pow(a, b) { a = this.num(a); b = this.num(b); if (a < 0 && b !== Math.floor(b)) fail('ILLEGAL QUANTITY'); return a ** b; }

  // functions
  int(x) { return Math.floor(this.num(x)); }
  abs(x) { return Math.abs(this.num(x)); }
  sqr(x) { if (this.num(x) < 0) fail('ILLEGAL QUANTITY'); return Math.sqrt(x); }
  log(x) { if (this.num(x) <= 0) fail('ILLEGAL QUANTITY'); return Math.log(x); }
  exp(x) { return Math.exp(this.num(x)); }
  sin(x) { return Math.sin(this.num(x)); }
  cos(x) { return Math.cos(this.num(x)); }
  tan(x) { return Math.tan(this.num(x)); }
  atn(x) { return Math.atan(this.num(x)); }
  len(s) { if (typeof s !== 'string') fail('TYPE MISMATCH'); return s.length; }
  val(s) { if (typeof s !== 'string') fail('TYPE MISMATCH'); return val(s); }
  rnd() { return this.random(); }
  fre() { return 0; }
  usr() { fail('UNDEF\'D FUNCTION'); }
  sgn(x) { return Math.sign(this.num(x)); }
  chr(x) { const n = int16(x); if (n < 0 || n > 255) fail('ILLEGAL QUANTITY'); return String.fromCharCode(n); }
  asc(s) { if (!s.length) fail('ILLEGAL QUANTITY'); return s.charCodeAt(0); }
  str(x) { return fout(this.num(x)); }
  left(s, n) { n = int16(n); if (n < 0 || n > 255) fail('ILLEGAL QUANTITY'); return s.slice(0, n); }
  right(s, n) { n = int16(n); if (n < 0 || n > 255) fail('ILLEGAL QUANTITY'); return n ? s.slice(-n) : ''; }
  mid(s, from, n = 255) { from = int16(from); n = int16(n); if (from < 1 || from > 255 || n < 0 || n > 255) fail('ILLEGAL QUANTITY'); return s.substr(from - 1, n); }
  peek(a) { a = Math.floor(this.num(a)); if (a < 0 || a > 0xffff) fail('ILLEGAL QUANTITY'); return this.e.read(a); }
  // RND: the seed's numbers, the same on the original (basic-rom.js's RND draws them too)
  // (kept on the engine, one run of them for the boot and the game, as the ROM's is one)
  random() { const e = this.e; e.randomState = nextRandom(e.randomState ?? seedRandom(e.title.seed ?? 0x11)); return e.randomState / 2 ** 32; }
  // TI, the clock at $A0 to $A2; TI$ as its hours, minutes and seconds
  // (a program's read of the clock takes the interrupts first, as a poll of GETIN does, so that a
  // wait it counts out moves on, the same on the original)
  // (but only every so many reads, the title's `reads`, and not after a poll of GETIN has taken
  // them since the last read)
  ti() {
    const e = this.e, m = e.mem;
    if (!e.clock && !this.quiet) {
      if (e.polledSince) { e.polledSince = false; e.reads = 0; }
      else if ((e.reads = (e.reads ?? 0) + 1) >= (e.routines.reads ?? 1)) { e.reads = 0; e.routines.poll(e); }
    }
    return m[0xa0] * 65536 + m[0xa1] * 256 + m[0xa2];
  }
  tis() { const t = Math.floor(this.ti() / 60); return [Math.floor(t / 3600) % 24, Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(''); }
  // TI$ set: through the KERNAL's SETTIM, as the original sets it (A the clock's low byte, Y its high)
  setTis(s) { if (!/^\d{6}$/.test(s)) fail('ILLEGAL QUANTITY'); const t = ((+s.slice(0, 2) * 60 + +s.slice(2, 4)) * 60 + +s.slice(4)) * 60, e = this.e; e.a = t & 0xff; e.x = t >> 8 & 0xff; e.y = t >> 16 & 0xff; this.call('settim'); }
  st() { return this.e.mem[0x90]; }
  poke(a, v) { a = Math.floor(this.num(a)); v = Math.floor(this.num(v)); if (a < 0 || a > 0xffff || v < 0 || v > 255) fail('ILLEGAL QUANTITY'); this.e.write(a, v); }

  // the time a statement took on the original, in its cycles, for the page's clock
  cost(n) { const e = this.e; e.cycles += n; e.delay += n / 1022.727; }
  // SYS, and the statements that go through the KERNAL's files: the engine's
  sys(at, text, step) { return this.e.routines.sys(this.e, Math.floor(this.num(at)), text, step); }
  undef() { fail('UNDEF\'D STATEMENT'); }
  // READ from DATA in BASIC's own text (`items`, basic-lang.js `dataItems`): the next item, a
  // string as it is, a number as FIN reads it, anything else in it a SYNTAX ERROR IN the DATA's
  // line, as BASIC gives it; RESTORE, from the first again
  readText(string) {
    const item = this.items[this.datum ?? 0];
    if (!item) fail('OUT OF DATA');
    this.datum = (this.datum ?? 0) + 1;
    if (string) return item.text;
    const t = item.text.replace(/ /g, '');
    if (item.quoted || !/^[+-]?(\d+\.?\d*|\.\d*)?(E[+-]?\d*)?$/.test(t)) { const err = new BasicError('?SYNTAX ERROR'); err.basicLine = item.line; throw err; }
    return val(t);
  }
  restore() { this.datum = 0; this.data = this.dataStart; }
  // DEF FN and FN: a function of one variable, which while it is worked out holds the argument,
  // and then its own value again, as BASIC's FN does; one not defined, UNDEF'D FUNCTION; DEF only
  // in a program, not typed at once (ILLEGAL DIRECT)
  def(n, p, f) { if (this.e.mem[0x3a] === 0xff) fail('ILLEGAL DIRECT'); (this.fns ??= Object.create(null))[n] = { p, f }; }
  fn(n, x) {
    const d = this.fns?.[n];
    if (!d) fail('UNDEF\'D FUNCTION');
    const was = this.v[d.p], arg = this.num(x);
    this.set(d.p, arg);
    try { return d.f(this); } finally { if (was === undefined) delete this.v[d.p]; else this.v[d.p] = was; }
  }
  failWith(what) { fail(what); }
  statement(k, args, into, step) {
    const f = this.e.routines['basic-' + k];
    if (!f) throw new Error(k.toUpperCase() + ' is not handled');
    return f(this.e, args, into, step);
  }
  pos() { return this.e.mem[0xd3] % 40; }

  // FOR and GOSUB on one stack, as BASIC keeps them: a FOR of a variable already looping drops
  // that loop and what is above it; NEXT drops the loops above its own; RETURN, everything above
  // its GOSUB
  for(n, to, step, next) {
    const k = this.stack.findLastIndex(f => f.for === n);
    if (k >= 0) this.stack.length = k;
    this.stack.push({ for: n, to: this.num(to), step: this.num(step), next });
  }
  next(n) {
    const k = n ? this.stack.findLastIndex(f => f.for === n) : this.stack.findLastIndex(f => f.for !== undefined);
    if (k < 0 || (n === null && this.stack.slice(k + 1).some(f => f.gosub !== undefined))) fail('NEXT WITHOUT FOR');
    this.stack.length = k + 1;
    const f = this.stack[k], x = this.get(f.for) + f.step;
    this.set(f.for, x);
    if (f.step >= 0 ? x <= f.to : x >= f.to) return f.next;
    this.stack.length = k;
    return null;
  }
  gosub(back) { this.stack.push({ gosub: back }); }
  ret() { const k = this.stack.findLastIndex(f => f.gosub !== undefined); if (k < 0) fail('RETURN WITHOUT GOSUB'); const back = this.stack[k].gosub; this.stack.length = k; return back; }
  on(x) { const k = Math.floor(this.num(x)); if (k < 0 || k > 255) fail('ILLEGAL QUANTITY'); return k; }

  // READ, from DATA as Blitz! keeps it
  read(string) {
    if (this.items) return this.readText(string);
    const m = this.e.mem, n = m[this.data];
    if (n & 0x80) fail('OUT OF DATA');
    const s = String.fromCharCode(...m.subarray(this.data + 1, this.data + 1 + n));
    this.data += 1 + n;
    return string ? s : val(s);
  }

  // the KERNAL's calls, through the engine: CHROUT a byte at a time, GETIN
  out(ch) { const e = this.e; e.a = ch; this.call('chrout'); }
  call(name) { const e = this.e; if (this.quiet) e.inside++; try { e.routines[name](e, [], null); } finally { if (this.quiet) e.inside--; } }
  // PRINT: a number written as FOUT writes it, then a step right on the screen or a space to a
  // file; a string as it is
  print(x) {
    if (typeof x === 'number') { for (const c of fout(x)) this.out(c.charCodeAt(0)); this.out(this.e.mem[0x13] ? 0x20 : 0x1d); }
    else for (let k = 0; k < x.length; k++) this.out(x.charCodeAt(k));
  }
  // a new line: a carriage return, and a line feed after it to a file numbered from 128
  newline() { this.out(0x0d); if (this.e.mem[0x13] & 0x80) this.out(0x0a); }

  // files, through the KERNAL: OPEN's parameters (the file, the device, 1 if not given, the
  // secondary address, 0, or 255 below device 3, and the name) as BASIC sets them, then OPEN;
  // CLOSE; PRINT# and INPUT#, the output's or the input's file, which $13 notes for PRINT
  open([la, fa = 1, sa, name = '']) {
    const m = this.e.mem;
    m[0xb8] = int16(la) & 0xff; m[0xba] = int16(fa) & 0xff; m[0xb9] = sa === undefined ? (m[0xba] < 3 ? 0xff : 0) : int16(sa) & 0xff;
    // (a name through SETNAM, as Blitz!'s OPEN gives it, from a place of the remake's own)
    for (let k = 0; k < name.length; k++) m[0x200 + k] = name.charCodeAt(k);
    if (name.length) { Object.assign(this.e, { a: name.length, x: 0x00, y: 0x02 }); this.call('setnam'); }
    else m[0xb7] = 0;
    this.call('open');
    if (this.e.c) fail(['', 'TOO MANY FILES', 'FILE OPEN', 'FILE NOT OPEN'][this.e.a] ?? 'DEVICE NOT PRESENT');
  }
  close(la) { this.e.a = int16(la) & 0xff; this.call('close'); }
  output(n) { this.e.mem[0x13] = int16(n) & 0xff; this.e.x = this.e.mem[0x13]; this.call('chkout'); }
  input(n) { this.e.mem[0x13] = int16(n) & 0xff; this.e.x = this.e.mem[0x13]; this.call('chkin'); this.line = null; }
  clrchn() { this.call('clrchn'); this.e.mem[0x13] = 0; }
  // WAIT: whether the place's bits, flipped by `xor`, meet the mask yet, as the ROM's loop reads
  // them ($B840); a key pressed on the page goes into the KERNAL's buffer meanwhile, as the
  // keyboard puts it there
  wait(at, mask, xor = 0) {
    const e = this.e, m = e.mem;
    if (!m[0xc6] && e.keys.length) { const k = e.keys.shift(); if (k >= 0) { m[0x277] = k; m[0xc6] = 1; } }
    return ((this.peek(at) ^ int16(xor)) & int16(mask)) !== 0;
  }
  // INPUT from a file (Microsoft's GETAGN and INLOOP): a line read with CHRIN to its carriage
  // return, the first an INPUT# reads read again while it is empty, a later one empty its items
  // empty; a read timed out (ST bit 1), the INPUT given up, its variables as they were
  // (`given up`); then its items, each to a comma: a string quoted to its quote, or to a comma
  // or a colon; a number as FIN reads it, a comma, a colon or the line's end after it, or
  // ?FILE DATA ERROR
  readLine(first) {
    for (;;) {
      let s = '';
      for (;;) { this.call('chrin'); if (this.e.a === 0x0d) break; s += String.fromCharCode(this.e.a); if (s.length > 88) fail('STRING TOO LONG'); }
      if (this.e.mem[0x90] & 2) { this.givenUp = true; return ''; }
      if (s.length || !first) return s;
    }
  }
  item(string, first) {
    if (first) this.givenUp = false;
    if (first || this.line === null || this.linePos >= this.line.length) { this.line = this.readLine(first); this.linePos = 0; }
    if (this.givenUp) return undefined;
    const s = this.line; let k = this.linePos;
    while (s[k] === ' ') k++;
    let v;
    if (string && s[k] === '"') { const end = s.indexOf('"', k + 1); v = s.slice(k + 1, end < 0 ? s.length : end); k = end < 0 ? s.length : end + 1; while (s[k] === ' ') k++; }
    else if (string) { let end = k; while (end < s.length && s[end] !== ',' && s[end] !== ':') end++; v = s.slice(k, end); k = end; }
    else { const n = scanNumber(s, k); v = n.text; k = n.end; }
    if (k < s.length && s[k] !== ',' && s[k] !== ':') fail('FILE DATA');
    if (s[k] === ',') k++;
    this.linePos = k;
    return string ? v : val(v);
  }
  // the end of an INPUT: from a file, the input back to the keyboard (Blitz!'s $1AAA)
  inputDone() {
    if (this.e.mem[0x13]) { this.call('clrchn'); this.e.mem[0x13] = 0; return; }
    throw new Error('INPUT from the keyboard is not handled');
  }
  // GET#'s character: GETIN from the file CHKIN chose, "" for none
  getFrom() { this.call('getin'); return this.e.a ? String.fromCharCode(this.e.a) : ''; }
  // `,`: on to the next column of ten
  comma() { const c = this.e.mem[0xd3] % 40; let n = 10 - c % 10; while (n--) this.out(this.e.mem[0x13] ? 0x20 : 0x1d); }
  spc(n) { n = int16(n); if (n < 0 || n > 255) fail('ILLEGAL QUANTITY'); while (n-- > 0) this.out(this.e.mem[0x13] ? 0x20 : 0x1d); }
  tab(n) { n = int16(n); if (n < 0 || n > 255) fail('ILLEGAL QUANTITY'); let k = n - this.e.mem[0xd3] % 40; while (k-- > 0) this.out(0x1d); }
  // GET: the key from GETIN, or "" with none; Blitz!'s calls CLRCHN after each, as its handler
  // does ($16CD), and BASIC's, in the ROM, does not
  // (the run stops for a key as GETIN returns, as the original does, its CLRCHN still to come:
  // null, and the step runs again for the rest)
  key() {
    if (this.got === undefined) {
      this.e.mem[0x13] = 0; this.call('getin'); this.got = this.e.a;
      if (this.e.polled && !this.quiet) return null;
    }
    const k = this.got; this.got = undefined;
    if (!this.quiet) this.call('clrchn');
    return k ? String.fromCharCode(k) : '';
  }
}

