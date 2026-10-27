// Blitz!'s compiled BASIC read back as statements: Blitz! (Skyles Electric Works, 1984) compiled a Commodore 64
// BASIC program to its own code, a runtime in 6502 at the start of the file and the program after it as the code the
// runtime steps through, with BASIC's numbers, strings and ROM routines underneath. What is here is worked out from
// that runtime and from watching it run (a title's docs/blitz.md tells the code, instruction by instruction). A
// program it reads is compiled to JavaScript by basic-compile.js, as a BASIC program's text is (basic-lang.js), so
// that any Blitz! disk is remade the same way: its driver says which file, and the player makes the program from it.
//
//   header(mem)          the header before the program ($1F93): where its variables, arrays, DIMs, DATA and main code are
//   program(mem)         the instructions, by address: { at, length, op, text, to (a jump's targets) }
//   statements(mem)      { out, problems }: the program as statements and labels, a tree each, for basic-compile.js
//   render(x)            a statement or an expression as BASIC, as a listing shows it
//   variables(mem)       BASIC's variables by their number, from the variable area as the program has it
//   instruction(mem, at), float(mem, at), petscii(bytes), OPERATORS, NAMES

const hex = (v, w = 4) => v.toString(16).toUpperCase().padStart(w, '0');

// the header before the program ($1F93): BASIC's variables, arrays and their end, where the
// program starts (its DIMs), its DATA, and where the main code starts after the DATA (the address
// before it, as the fetch steps on before it reads)
export function header(mem) {
  const w = a => mem[a] | mem[a + 1] << 8;
  return { vars: w(0x1f93), arrays: w(0x1f95), end: w(0x1f97), start: w(0x1f99), data: w(0x1f9b), main: w(0x1f9d) + 1 };
}

// the instructions of the program: from its start to its DATA, and from the main code to the
// variables
export function program(mem) {
  const h = header(mem), at = new Map();
  for (const [from, to] of [[h.start, h.data], [h.main, h.vars]]) for (let a = from; a < to;) { const i = instruction(mem, a); at.set(a, i); a += i.length; }
  return at;
}

// the operators: the comparisons by BASIC's own bits (1 greater, 2 equal, 4 less), then the
// arithmetic the ROM's routines do (the table at $090C), and AND and OR
export const OPERATORS = ['?', '>', '=', '>=', '<', '<>', '<=', '+', '-', '*', '/', '^', 'and', 'or'];
// the statements and functions, from their handlers (a title's docs/blitz.md)
export const NAMES = {
  0x0e: 'negate', 0x0f: 'not', 0x10: 'dim', 0x11: 'for', 0x12: 'for-step', 0x13: 'next', 0x14: 'next-var', 0x15: 'run',
  0x16: 'run-main', 0x17: 'poke', 0x18: 'sys', 0x19: 'goto', 0x1a: 'gosub', 0x1b: 'on-goto', 0x1c: 'on-gosub', 0x1d: 'return',
  0x1e: 'clr', 0x1f: 'if-short',
  0x20: 'sgn', 0x21: 'int', 0x22: 'abs', 0x23: 'usr', 0x24: 'fre', 0x25: 'pos', 0x26: 'sqr', 0x27: 'rnd', 0x28: 'log',
  0x29: 'exp', 0x2a: 'cos', 0x2b: 'sin', 0x2c: 'tan', 0x2d: 'atn', 0x2e: 'peek', 0x2f: 'len', 0x30: 'str$', 0x31: 'val',
  0x32: 'asc', 0x33: 'chr$', 0x34: 'left$', 0x35: 'right$', 0x36: 'mid$',
  0x3a: 'nop', 0x3b: 'print-comma', 0x3c: 'print', 0x3d: 'print,', 0x3e: 'print-line', 0x3f: 'newline', 0x40: 'spc',
  0x41: 'tab', 0x42: 'print#', 0x43: 'print-line#', 0x44: 'print#-line', 0x45: 'clrchn', 0x46: 'get', 0x47: 'basic-text',
  0x48: 'input#', 0x49: 'stop', 0x4a: 'read', 0x4b: 'read$', 0x4c: 'wait', 0x4d: 'wait', 0x4e: 'new', 0x4f: 'end',
  0x50: 'input-start', 0x51: 'input-item', 0x52: 'if', 0x53: 'input', 0x55: 'input', 0x56: 'ti$=', 0x57: 'input-item',
  0x58: 'if-return', 0x59: 'flag+40', 0x5a: 'flag-40', 0x5b: 'flag+80', 0x5c: 'flag-80',
  0x5d: 'load', 0x5e: 'save', 0x5f: 'verify', 0x60: 'open', 0x61: 'close', 0x62: 'error',
};

// PETSCII as the game shows it, in the second character set: $41 to $5A small letters, $C1 to
// $DA capitals, and a control code by its name in braces, as its listings are written
// (@moonbase-machines/c64/basic-list.js)
const CONTROLS = { 0x05: 'WHT', 0x08: 'DISABLE SHIFT', 0x0d: 'RETURN', 0x0e: 'LOWER', 0x11: 'DOWN', 0x12: 'RVS ON', 0x13: 'HOME', 0x14: 'DEL',
  0x1c: 'RED', 0x1d: 'RIGHT', 0x1e: 'GRN', 0x1f: 'BLU', 0x81: 'ORNG', 0x8e: 'UPPER', 0x90: 'BLK', 0x91: 'UP', 0x92: 'RVS OFF', 0x93: 'CLR',
  0x94: 'INST', 0x95: 'BRN', 0x96: 'LRED', 0x97: 'GRY1', 0x98: 'GRY2', 0x99: 'LGRN', 0x9a: 'LBLU', 0x9b: 'GRY3', 0x9c: 'PUR', 0x9d: 'LEFT',
  0x9e: 'YEL', 0x9f: 'CYN', 0xa0: 'SHIFT SPACE' };
export const petscii = bytes => [...bytes].map(b =>
  b >= 0x20 && b < 0x40 || b === 0x5b || b === 0x5d || b === 0x40 ? String.fromCharCode(b)
    : b >= 0x41 && b <= 0x5a ? String.fromCharCode(b + 0x20) : b >= 0xc1 && b <= 0xda ? String.fromCharCode(b - 0x80)
      : b === 0x5c ? '£' : b === 0x5e ? '↑' : b === 0x5f ? '←' : '{' + (CONTROLS[b] ?? '$' + hex(b, 2)) + '}').join('');

// BASIC's five-byte float at `at`: its exponent, and its mantissa with the sign in the top bit
export function float(mem, at) {
  if (!mem[at]) return 0;
  const m = ((mem[at + 1] | 0x80) * 2 ** 24 + mem[at + 2] * 2 ** 16 + mem[at + 3] * 2 ** 8 + mem[at + 4]) / 2 ** 32;
  return (mem[at + 1] & 0x80 ? -1 : 1) * m * 2 ** (mem[at] - 128);
}

// one instruction at `at`: { at, length, op, text, to (a jump's target) }
export function instruction(mem, at) {
  const b = mem[at], u = k => mem[at + k], word = k => (mem[at + k] << 8 | mem[at + k + 1]);
  const s = (from, n) => String.fromCharCode(...mem.subarray(from, from + n));
  if (b < 0x0e) return { at, length: 1, op: b, text: OPERATORS[b] };
  if (b < 0x80) {
    const name = NAMES[b] ?? 'x' + hex(b, 2);
    switch (b) {
      case 0x10: return { at, length: 6, op: b, text: `dim ${s(at + 2, 2)} ${u(1)} dimensions, at +${hex(word(4))}` };
      // SYS: the BASIC text after it, to its colon, which the machine code reads its parameters from
      case 0x18: { let n = 1; while (mem[at + n] !== 0x3a && n < 80) n++; return { at, length: n + 1, op: b, text: `sys ${s(at + 1, n - 1)}` }; }
      case 0x19: case 0x1a: case 0x52: { const to = word(1); return { at, length: 3, op: b, text: `${name} ${hex(to)}`, to: [to] }; }
      // ON: its length, then a target for each value from 1, high byte first; another value goes on
      case 0x1b: case 0x1c: { const n = u(1), to = []; for (let k = 2; k < n; k += 2) to.push(word(k)); return { at, length: n, op: b, text: `${name} ${to.map(t => hex(t)).join(' ')}`, to }; }
      case 0x1f: return { at, length: 2, op: b, text: `if-short +${u(1)}`, to: [at + u(1)] };
      // OPEN, LOAD, SAVE, VERIFY: how many of their parameters are given, in the next byte
      case 0x5d: case 0x5e: case 0x5f: case 0x60: return { at, length: 2, op: b, text: `${name} ${u(1)}`, count: u(1) };
      case 0x37: return { at, length: 6, op: b, text: `x37 +${hex(word(1))} +${hex(word(3))} ${u(5)}` };
      case 0x38: return { at, length: 3, op: b, text: `x38 +${hex(word(1))}` };
    }
    return { at, length: 1, op: b, text: name };
  }
  if (b < 0xa0) return { at, length: 1, op: b, text: `load v${b - 0x80}` };
  if (b < 0xa4) return { at, length: 2, op: b, text: `load v${(b & 3) * 256 + u(1)}` };
  if (b < 0xa6) return { at, length: 2, op: b, text: `load array ${b & 1} ${u(1)}` };
  if (b === 0xa6) return { at, length: 2, op: b, text: `${u(1)}` };
  if (b === 0xa7) return { at, length: 3, op: b, text: `${u(1) << 8 | u(2)}` };
  if (b === 0xa8 || b === 0xa9) return { at, length: 6, op: b, text: String(float(mem, at + 1)) };
  if (b < 0xb0) return { at, length: 1, op: b, text: ['pi', 'st', 'ti', 'xad', 'xae', 'ti$'][b - 0xaa] };
  if (b < 0xc0) return { at, length: 1, op: b, text: `${b & 15}` };
  if (b < 0xe0) return { at, length: 1, op: b, text: `store v${b - 0xc0}` };
  if (b < 0xe4) return { at, length: 2, op: b, text: `store v${(b & 3) * 256 + u(1)}` };
  if (b < 0xe6) return { at, length: 2, op: b, text: `store array ${b & 1} ${u(1)}` };
  if (b === 0xe7) return { at, length: 2 + u(1), op: b, text: '"' + petscii(mem.subarray(at + 2, at + 2 + u(1))) + '"' };
  if (b < 0xf0) return { at, length: 1 + (b & 7), op: b, text: '"' + petscii(mem.subarray(at + 1, at + 1 + (b & 7))) + '"' };
  return { at, length: 1, op: b, text: `${b & 31}` };   // $F0 to $FF: the whole numbers 16 to 31
}

// BASIC's variables by their number, from its variable area as GAME has it: the name's two
// characters, and its kind by their top bits (both: whole number %, the second: string $)
export function variables(mem) {
  const h = header(mem), names = [];
  for (let a = h.vars; a < h.arrays; a += 7) names.push(nameOf(mem[a], mem[a + 1]));
  return names;
}

// How many values each instruction takes from the stack and gives back. An operand's load gives
// one; a store takes one; an operator two for one.
function effect(i, arrays) {
  const b = i.op;
  if (b < 0x0e) return [2, 1];
  if (b >= 0x80 && b < 0xc0) return b === 0xa4 || b === 0xa5 ? [arrays.get(i.slot)?.dims ?? 1, 1] : [0, 1];
  if (b >= 0xc0 && b < 0xe0) return [1, 0];
  if (b >= 0xe0 && b < 0xe4) return [1, 0];
  if (b === 0xe4 || b === 0xe5) return [(arrays.get(i.slot)?.dims ?? 1) + 1, 0];
  if (b >= 0xe6) return [0, 1];
  if (b >= 0x20 && b <= 0x33) return [1, 1];
  const E = {
    0x0e: [1, 1], 0x0f: [1, 1], 0x34: [2, 1], 0x35: [2, 1], 0x36: [3, 1],
    0x10: [i.dims, 0], 0x11: [2, 0], 0x12: [3, 0], 0x17: [2, 0], 0x18: [1, 0], 0x1b: [1, 0], 0x1c: [1, 0], 0x1f: [1, 0], 0x52: [1, 0], 0x58: [1, 0],
    0x3c: [1, 0], 0x3d: [1, 0], 0x3e: [1, 0], 0x43: [1, 0], 0x40: [1, 0], 0x41: [1, 0], 0x42: [1, 0], 0x44: [1, 0], 0x48: [1, 0],
    // (GET, READ and INPUT's items take the place they read into: the load of its variable or
    // element just before)
    0x46: [1, 0], 0x4a: [1, 0], 0x4b: [1, 0], 0x51: [1, 0], 0x57: [1, 0], 0x53: [1, 0], 0x55: [1, 0], 0x61: [1, 0], 0x56: [1, 0], 0x4c: [2, 0], 0x4d: [3, 0],
    0x5d: [i.count, 0], 0x5e: [i.count, 0], 0x5f: [i.count, 0], 0x60: [i.count, 0],
  };
  return E[b] ?? [0, 0];
}

// The program as statements: each run of instructions from an empty stack back to an empty one,
// its postfix put back as a tree. A statement is { at, k, ... }, an expression { k, ... }:
//   num v, str s (PETSCII as a string of its bytes), var n, elem n i (the indices), op o a b,
//   neg a, not a, fn n args, special n (ti, ti$, st, pi)
// and a label { label } where a jump goes.
export function statements(mem) {
  const at = program(mem), names = variables(mem), arrays = new Map(), out = [], problems = [];
  const targets = new Set([...at.values()].flatMap(i => i.to ?? []));
  targets.add(header(mem).main);
  let stack = [], from = null;
  const v = n => names[n] ?? 'V' + n;
  const arrayName = slot => arrays.get(slot)?.name ?? 'ARRAY' + slot;
  for (const i of at.values()) {
    if (targets.has(i.at)) { if (stack.length) problems.push(`$${hex(i.at)}: a jump lands with ${stack.length} values on the stack`); stack = []; out.push({ label: 'L' + hex(i.at) }); }
    const b = i.op;
    if (b === 0x10) { i.dims = mem[i.at + 1]; i.slot = mem[i.at + 4] << 8 | mem[i.at + 5]; arrays.set(i.slot, { dims: i.dims, name: nameOf(mem[i.at + 2], mem[i.at + 3]) }); }
    if (b === 0xa4 || b === 0xa5 || b === 0xe4 || b === 0xe5) i.slot = mem[i.at + 1];
    const [pops, pushes] = effect(i, arrays);
    if (stack.length < pops) { problems.push(`$${hex(i.at)} ${i.text}: takes ${pops}, has ${stack.length}`); stack = Array(pops - stack.length).fill({ k: 'num', v: 0 }).concat(stack); }
    const e = stack.splice(stack.length - pops, pops);
    from ??= i.at;
    // (each node with the address of its instruction, `op`: where Blitz!'s program counter is if
    // it fails, which BASIC's error message gives as its line)
    const put = x => stack.push({ ...x, op: i.at }), say = x => { out.push({ at: from, op: i.at, ...x }); from = null; };
    const name = NAMES[b];
    if (b < 0x0e) put({ k: 'op', o: OPERATORS[b], a: e[0], b: e[1] });
    else if (b >= 0x80 && b < 0xa4) put({ k: 'var', n: v(b < 0xa0 ? b - 0x80 : (b & 3) * 256 + mem[i.at + 1]) });
    else if (b === 0xa4 || b === 0xa5) put({ k: 'elem', n: arrayName(i.slot), i: e });
    else if (b === 0xa6 || b === 0xa7 || b >= 0xb0 && b < 0xc0 || b >= 0xf0) put({ k: 'num', v: +i.text });
    else if (b === 0xa8 || b === 0xa9) put({ k: 'num', v: float(mem, i.at + 1) });
    else if (b >= 0xaa && b < 0xb0) put({ k: 'special', n: i.text });
    else if (b === 0xe7) put({ k: 'str', s: String.fromCharCode(...mem.subarray(i.at + 2, i.at + 2 + mem[i.at + 1])) });
    else if (b >= 0xe8) put({ k: 'str', s: String.fromCharCode(...mem.subarray(i.at + 1, i.at + 1 + (b & 7))) });
    else if (b >= 0xc0 && b < 0xe4) say({ k: 'let', t: { k: 'var', n: v(b < 0xe0 ? b - 0xc0 : (b & 3) * 256 + mem[i.at + 1]) }, e: e[0] });
    else if (b === 0xe4 || b === 0xe5) say({ k: 'let', t: { k: 'elem', n: arrayName(i.slot), i: e.slice(0, -1) }, e: e.at(-1) });
    else if (b === 0x0e) put({ k: 'neg', a: e[0] });
    else if (b === 0x0f) put({ k: 'not', a: e[0] });
    else if (pushes) put({ k: 'fn', n: name, args: e });
    // GET, READ and INPUT, into the place before them
    // (INPUT's last item, $51, or an INPUT of one, $53, ends it: from a file, CLRCHN)
    else if ([0x46, 0x4a, 0x4b, 0x51, 0x57, 0x53, 0x55].includes(b)) say({ k: name, t: e[0], string: b === 0x4b, last: b === 0x51 || b === 0x53 });
    else if (b === 0x17) say({ k: 'poke', a: e[1], v: e[0] });
    else if (b === 0x11 || b === 0x12) say({ k: 'for', v: e[1].n, to: e[0], step: e[2] });
    else if (b === 0x10) say({ k: 'dim', n: arrays.get(i.slot).name, sizes: e });
    // the short IF goes on to the next statement when its condition holds, and to its label when
    // not; the long one goes to its label when it holds
    else if (b === 0x1f) say({ k: 'unless', e: e[0], to: i.to[0] });
    else if (b === 0x52) say({ k: 'if-goto', e: e[0], to: i.to[0] });
    else if (b === 0x58) say({ k: 'if-return', e: e[0] });
    else if (b === 0x19 || b === 0x1a) say({ k: name, to: i.to[0] });
    else if (b === 0x1b || b === 0x1c) say({ k: 'on', e: e[0], to: i.to, gosub: b === 0x1c });
    // SYS: its address, and its text from just after it, for the machine code to read
    else if (b === 0x18) say({ k: 'sys', e: e[0], text: i.at + 1, end: i.at + i.length - 1, words: i.text.slice(4) });
    else if (b === 0x16) say({ k: 'run-main', to: header(mem).main, args: [] });
    // OPEN, LOAD, SAVE, VERIFY and WAIT: their parameters taken from the stack last first
    else if (b >= 0x5d && b <= 0x60 || b === 0x4c || b === 0x4d) say({ k: name, args: e.reverse() });
    else say({ k: name ?? i.text, args: e });
  }
  return { out, problems };
}

// a name of BASIC's two bytes: its characters, and its kind by their top bits (both: whole
// number, %; the second: string, $)
const nameOf = (x, y) => String.fromCharCode(x & 0x7f) + (y & 0x7f ? String.fromCharCode(y & 0x7f) : '') + (x & 0x80 && y & 0x80 ? '%' : y & 0x80 ? '$' : '');

// a statement or an expression as BASIC
const PREC = { or: 1, and: 2, '=': 3, '<>': 3, '<': 3, '>': 3, '<=': 3, '>=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '^': 6 };
const prec = x => x.k === 'op' ? PREC[x.o] : x.k === 'neg' || x.k === 'not' ? 7 : 9;
export function render(x) {
  const r = render, L = t => t < 0 ? 'the end' : 'L' + hex(t);
  switch (x.k) {
    case 'num': return String(x.v);
    case 'special': return x.n.toUpperCase();
    case 'str': return '"' + petscii(Uint8Array.from(x.s, c => c.charCodeAt(0))) + '"';
    case 'var': return x.n;
    case 'elem': return `${x.n}(${x.i.map(r).join(', ')})`;
    case 'op': { const p = PREC[x.o]; return `${prec(x.a) < p ? '(' + r(x.a) + ')' : r(x.a)} ${x.o.toUpperCase()} ${prec(x.b) <= p ? '(' + r(x.b) + ')' : r(x.b)}`; }
    case 'neg': return '-' + (prec(x.a) < 9 ? '(' + r(x.a) + ')' : r(x.a));
    case 'not': return 'NOT ' + (prec(x.a) < 9 ? '(' + r(x.a) + ')' : r(x.a));
    case 'fn': return `${x.n.toUpperCase()}(${x.args.map(r).join(', ')})`;
    case 'let': return `${r(x.t)} = ${r(x.e)}`;
    case 'poke': return `POKE ${r(x.a)}, ${r(x.v)}`;
    case 'for': return `FOR ${x.v} TO ${r(x.to)}${x.step ? ' STEP ' + r(x.step) : ''}`;
    case 'dim': return `DIM ${x.n}(${x.sizes.map(r).join(', ')})`;
    case 'unless': return `IF ${r(x.e)} ELSE ${L(x.to)}`;
    case 'if-goto': return `IF ${r(x.e)} GOTO ${L(x.to)}`;
    case 'if-return': return `IF ${r(x.e)} THEN RETURN`;
    case 'goto': case 'gosub': return `${x.k.toUpperCase()} ${L(x.to)}`;
    case 'on': return `ON ${r(x.e)} ${x.gosub ? 'GOSUB' : 'GOTO'} ${x.to.map(L).join(', ')}`;
    case 'sys': return `SYS ${r(x.e)}${x.words}`;
    default: return x.t ? `${x.k.toUpperCase()} ${r(x.t)}` : `${x.k.toUpperCase()}${x.args?.length ? ' ' + x.args.map(r).join(', ') : ''}`;
  }
}
