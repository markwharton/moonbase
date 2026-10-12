// A 6502 assembler, for Moonbase's own machine code (Crayon on the 64): ordinary 6502 syntax, its
// opcodes the disassembler's table read backwards (disasm.js `OPS`), so that what it assembles
// reads back the same.
//
//   const { prg, bytes, origin, symbols } = assemble(source, { file, include })
//     source    the text; `file` its name, for errors; `include(name)` the text of an .include
//     prg       the program as a C64 file: its load address, then its bytes
//     symbols   every label and constant, by name
//
// A line is a label, an instruction or a directive, then a comment after `;`:
//   start:              a label; `.loop:` a local one, under the last label (`.loop` reaches it)
//   name = expr         a constant;  *= expr  where the bytes go from here
//   LDA #<table         an instruction: #imm, zp, zp,X, zp,Y, abs, abs,X, abs,Y, (zp,X), (zp),Y,
//                       (abs), A or nothing; zero page chosen where the operand is known below 256
//                       by the first pass; a branch's reach checked
//   .byte 1,'a',$ff     bytes;  .word expr,...  little-endian words
//   .text "HELLO"       PETSCII (letters as the 64's capitals);  .screen "HELLO"  screen codes
//   .mixed "Hello"      screen codes for the 64's second set, its small letters and capitals:
//                       small letters 1 to 26, capitals $41 to $5A, the rest as .screen
//   .fill n[,value]     n bytes;  .include "file"  another file's lines, here
// Expressions: decimal, $hex, %binary, 'c' (its PETSCII), * (here), names; unary - ~ < (low byte)
// > (high byte); * / % + - << >> & ^ | as C has them; parentheses.
import { OPS, SIZE } from './disasm.js';

const CODES = {};
OPS.forEach((o, i) => { if (o.name !== '???') (CODES[o.name] ??= {})[o.mode] = i; });

export class AsmError extends Error {}

// a character as PETSCII: the letters as the 64's capitals, whichever case they are typed in
const petscii = c => { const n = c.charCodeAt(0); return n >= 0x61 && n <= 0x7a ? n - 0x20 : n === 0x5f ? 0xa4 : n; };
// and as a screen code: @ and the letters 0 to 26, the rest of $20 to $3F as they are
const screen = c => { const n = petscii(c); return n >= 0x40 && n < 0x60 ? n - 0x40 : n; };
// and in the 64's second set of characters, small letters and capitals: a small letter 1 to 26, a
// capital $41 to $5A, as that set has them
const mixed = c => { const n = c.charCodeAt(0); return n >= 0x61 && n <= 0x7a ? n - 0x60 : n >= 0x41 && n <= 0x5a ? n : screen(c); };

export function assemble(source, { file = 'source', include = null } = {}) {
  const symbols = new Map(), sizes = [];
  let mem, pc, low, high, pass, global, where, count;

  // the lines, with any .include's in their place, each knowing its file and number
  const lines = [];
  const read = (text, name, depth = 0) => text.split(/\r?\n/).forEach((line, n) => {
    const inc = line.match(/^\s*\.include\s+"([^"]+)"/i);
    if (!inc) return lines.push({ line, file: name, n: n + 1 });
    if (!include) throw new AsmError(`${name}:${n + 1}: .include, but no way to read "${inc[1]}"`);
    if (depth > 8) throw new AsmError(`${name}:${n + 1}: .include too deep`);
    read(include(inc[1]), inc[1], depth + 1);
  });
  read(source, file);
  const fail = message => { throw new AsmError(`${where.file}:${where.n}: ${message}`); };
  const local = name => (name.startsWith('.') ? (global ?? fail(`${name} before any label`)) + name : name);

  // an expression's value, or undefined where the first pass has not yet seen a name in it
  function evaluate(text) {
    const tokens = text.match(/\$[0-9a-f]+|%[01]+|\d+|'(?:[^'\\]|\\.)'|[.@]?[a-z_][\w.]*|<<|>>|[-+*/%&|^~<>()]/gi);
    if (!tokens || tokens.join('').replace(/\s/g, '') !== text.replace(/\s/g, '')) fail(`can't read "${text}"`);
    let at = 0;
    const peek = () => tokens[at], next = () => tokens[at++];
    const LEVELS = [['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
    const binary = level => {
      if (level === LEVELS.length) return unary();
      let v = binary(level + 1);
      while (LEVELS[level].includes(peek())) {
        const op = next(), w = binary(level + 1);
        v = v === undefined || w === undefined ? undefined
          : op === '|' ? v | w : op === '^' ? v ^ w : op === '&' ? v & w : op === '<<' ? v << w : op === '>>' ? v >> w
          : op === '+' ? v + w : op === '-' ? v - w : op === '*' ? v * w : op === '/' ? Math.trunc(v / w) : v % w;
      }
      return v;
    };
    const unary = () => {
      const t = next();
      if (t === undefined) fail(`"${text}" ends too soon`);
      if (t === '-' || t === '~' || t === '<' || t === '>') {
        const v = unary();
        return v === undefined ? undefined : t === '-' ? -v : t === '~' ? ~v & 0xffff : t === '<' ? v & 0xff : (v >> 8) & 0xff;
      }
      if (t === '(') { const v = binary(0); if (next() !== ')') fail(`a ( without its ) in "${text}"`); return v; }
      if (t === '*') return pc;
      if (t[0] === '$') return parseInt(t.slice(1), 16);
      if (t[0] === '%') return parseInt(t.slice(1), 2);
      if (/^\d/.test(t)) return parseInt(t, 10);
      if (t[0] === "'") return petscii(t[1] === '\\' ? t[2] : t[1]);
      const name = local(t);
      if (symbols.has(name)) return symbols.get(name);
      if (pass === 2) fail(`${name}: not defined`);
      return undefined;
    };
    const v = binary(0);
    if (at < tokens.length) fail(`"${text}": more than one expression`);
    return v;
  }

  const put = b => { if (pc > 0xffff) fail('past $FFFF'); mem[pc] = b & 0xff; low = Math.min(low, pc); high = Math.max(high, pc); pc++; };
  const list = text => text.match(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)'|[^,])+/g)?.map(s => s.trim()) ?? [];
  const define = (name, value) => {
    if (pass === 1 && symbols.has(name) && symbols.get(name) !== value) fail(`${name} defined twice`);
    if (pass === 2 && symbols.has(name) && symbols.get(name) !== value) fail(`${name} moved between the passes`);
    symbols.set(name, value);
  };

  function instruction(name, text) {
    const modes = CODES[name] ?? fail(`${name}: no such instruction`);
    const nth = count++;
    let mode, value;
    const operand = text.trim();
    if (!operand || /^a$/i.test(operand)) {
      mode = modes.imp !== undefined ? 'imp' : modes.acc !== undefined ? 'acc' : fail(`${name} needs an operand`);
    } else if (operand[0] === '#') { mode = 'imm'; value = evaluate(operand.slice(1)); }
    else {
      let m;
      if ((m = operand.match(/^\((.+),\s*x\s*\)$/i))) { mode = 'izx'; value = evaluate(m[1]); }
      else if ((m = operand.match(/^\((.+)\)\s*,\s*y$/i))) { mode = 'izy'; value = evaluate(m[1]); }
      else if (modes.ind !== undefined && (m = operand.match(/^\((.+)\)$/))) { mode = 'ind'; value = evaluate(m[1]); }
      else {
        const [, expr, reg] = operand.match(/^(.+?)(?:\s*,\s*([xy]))?$/i);
        value = evaluate(expr);
        const x = reg?.toLowerCase();
        if (modes.rel !== undefined) mode = 'rel';
        else {
          const zp = x === 'x' ? 'zpx' : x === 'y' ? 'zpy' : 'zp', abs = x === 'x' ? 'abx' : x === 'y' ? 'aby' : 'abs';
          // (zero page where the first pass knew the operand below 256, and the same size after)
          if (pass === 1) sizes[nth] = value !== undefined && value < 0x100 && modes[zp] !== undefined ? zp : abs;
          mode = sizes[nth];
          if (modes[mode] === undefined) mode = modes[abs] !== undefined ? abs : modes[zp] !== undefined ? zp : fail(`${name} has no ${operand} form`);
        }
      }
    }
    if (modes[mode] === undefined) fail(`${name} has no ${mode} form`);
    put(modes[mode]);
    const v = value ?? 0;
    if (mode === 'rel') {
      const d = v - (pc + 1);
      if (pass === 2 && (d < -128 || d > 127)) fail(`${name} ${operand}: ${d} bytes away, a branch reaches -128 to 127`);
      put(d);
    } else if (SIZE[mode] === 2) {
      if (pass === 2 && (v < -128 || v > 0xff)) fail(`${operand}: ${v} is more than a byte`);
      put(v);
    } else if (SIZE[mode] === 3) { put(v); put(v >> 8); }
  }

  for (pass = 1; pass <= 2; pass++) {
    mem = new Uint8Array(0x10000); pc = 0x1000; low = 0x10000; high = -1; global = null; count = 0;
    let set = false;
    for (where of lines) {
      let text = where.line.replace(/;.*$/, '').trim();
      // (a ; inside quotes is kept: the comment is cut only outside them)
      if (/["']/.test(where.line)) { let q = null, i = 0; for (; i < where.line.length; i++) { const c = where.line[i]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === ';') break; } text = where.line.slice(0, i).trim(); }
      if (!text) continue;
      let m = text.match(/^([.@]?[a-z_][\w]*):\s*(.*)$/i);
      if (m) {
        if (!m[1].startsWith('.')) global = m[1];
        define(local(m[1]), pc);
        text = m[2];
        if (!text) continue;
      }
      if ((m = text.match(/^\*\s*=\s*(.+)$/))) { pc = evaluate(m[1]) ?? fail('*= needs a value the first pass knows'); set = true; continue; }
      if ((m = text.match(/^([a-z_]\w*)\s*=\s*(.+)$/i))) { const v = evaluate(m[2]); if (v !== undefined) define(m[1], v); else if (pass === 2) fail(`${m[1]}: no value`); continue; }
      if (!set) fail('no *= before the first byte');
      if ((m = text.match(/^\.(\w+)\s*(.*)$/))) {
        const [, directive, rest] = m;
        switch (directive.toLowerCase()) {
          case 'byte': case 'text': case 'screen': case 'mixed':
            for (const item of list(rest)) {
              if (item[0] === '"') { const as = { screen, mixed }[directive.toLowerCase()] ?? petscii; for (const c of item.slice(1, -1).replace(/\\(.)/g, '$1')) put(as(c)); }
              else { const v = evaluate(item); if (pass === 2 && (v < -128 || v > 0xff)) fail(`${item}: more than a byte`); put(v ?? 0); }
            }
            break;
          case 'word': for (const item of list(rest)) { const v = evaluate(item) ?? 0; put(v); put(v >> 8); } break;
          case 'fill': { const [n, v = '0'] = list(rest); const k = evaluate(n) ?? fail('.fill needs a count the first pass knows'), b = evaluate(v) ?? 0; for (let i = 0; i < k; i++) put(b); break; }
          default: fail(`.${directive}: no such directive`);
        }
        continue;
      }
      if ((m = text.match(/^([a-z]{3})\b\s*(.*)$/i))) { instruction(m[1].toUpperCase(), m[2]); continue; }
      fail(`can't read "${text}"`);
    }
  }
  if (high < 0) throw new AsmError(`${file}: nothing assembled`);
  const bytes = mem.slice(low, high + 1), prg = new Uint8Array(bytes.length + 2);
  prg[0] = low & 0xff; prg[1] = low >> 8; prg.set(bytes, 2);
  return { origin: low, bytes, prg, symbols };
}
