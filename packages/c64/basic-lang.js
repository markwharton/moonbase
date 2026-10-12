// Commodore BASIC's tokenized text read into the tree made of Blitz!'s code: expressions, for
// the text after a SYS that the machine code reads its parameters from, and statements, for
// Goldfields' boot program, GOLDFIELDS. Shared: a remake is built with it (basic-compile.js), and
// moonbase's BASIC ROM reads with it as the original runs (basic-rom.js).
//
//   expression(mem, at)  { e, end }: the expression at `at`, and where it ends
//   lines(mem, from)     the program at `from` as statements, each line a label of its address
//   crunch(text)         a typed line's text to BASIC's tokenized bytes, as the ROM's CRUNCH
//   list(bytes)          a line's bytes back to the text LIST prints
//   store(mem, txttab, n, bytes)   a line put in its place in the program, or taken out

import { fail, BasicError } from './numbers.js';

// text BASIC cannot read: its SYNTAX ERROR when the statement is reached, as BASIC finds it only
// then (a line changed by a POKE, say); what was wrong kept for whoever looks
const syntax = detail => Object.assign(new BasicError('?SYNTAX ERROR'), { detail });

// the tokens from $80, as BASIC V2 has them
export const TOKENS = ('END FOR NEXT DATA INPUT# INPUT DIM READ LET GOTO RUN IF RESTORE GOSUB RETURN REM STOP ON WAIT LOAD SAVE VERIFY ' +
  'DEF POKE PRINT# PRINT CONT LIST CLR CMD SYS OPEN CLOSE GET NEW TAB( TO FN SPC( THEN NOT STEP + - * / ^ AND OR > = < ' +
  'SGN INT ABS USR FRE POS SQR RND LOG EXP COS SIN TAN ATN PEEK LEN STR$ VAL ASC CHR$ LEFT$ RIGHT$ MID$ GO').split(' ');
const T = Object.fromEntries(TOKENS.map((t, k) => [t, 0x80 + k]));
const FUNCTIONS = new Set(['SGN', 'INT', 'ABS', 'USR', 'FRE', 'POS', 'SQR', 'RND', 'LOG', 'EXP', 'COS', 'SIN', 'TAN', 'ATN', 'PEEK', 'LEN', 'STR$', 'VAL', 'ASC', 'CHR$', 'LEFT$', 'RIGHT$', 'MID$']);
// the binary operators by their token, and how tightly each binds, as BASIC evaluates them
const BINARY = { [T['OR']]: ['or', 1], [T['AND']]: ['and', 2], [T['>']]: ['>', 4], [T['=']]: ['=', 4], [T['<']]: ['<', 4], [T['+']]: ['+', 5], [T['-']]: ['-', 5], [T['*']]: ['*', 6], [T['/']]: ['/', 6], [T['^']]: ['^', 8] };

// a reader of the text at `at`: BASIC skips spaces between everything outside a string
function reader(mem, at) {
  const r = {
    at,
    peek() { while (mem[r.at] === 0x20) r.at++; return mem[r.at]; },
    next() { const b = r.peek(); r.at++; return b; },
    end() { const b = r.peek(); return b === 0 || b === 0x3a; },
    expect(b) { if (r.next() !== b) throw syntax(`$${(r.at - 1).toString(16)}: expected $${b.toString(16)}`); },
  };
  return r;
}

const letter = b => b >= 0x41 && b <= 0x5a, digit = b => b >= 0x30 && b <= 0x39;

// a variable's name: its first two characters (the rest are BASIC's to ignore), and $ or %
function name(r) {
  let n = String.fromCharCode(r.next());
  while (letter(mem(r)) || digit(mem(r))) { const c = String.fromCharCode(r.next()); if (n.length < 2) n += c; }
  if (mem(r) === 0x24 || mem(r) === 0x25) n += String.fromCharCode(r.next());
  return n;
}
const mem = r => r.peek();

function primary(r, m) {
  const b = r.peek();
  if (b === 0x22) {   // a string, to its closing quote or the line's end
    r.at++; const from = r.at; while (m[r.at] && m[r.at] !== 0x22) r.at++;
    const s = String.fromCharCode(...m.subarray(from, r.at)); if (m[r.at] === 0x22) r.at++;
    return { k: 'str', s, at: from };
  }
  if (digit(b) || b === 0x2e) {   // a number: digits, a point, an exponent
    let t = ''; const take = () => { t += String.fromCharCode(r.next()); };
    while (digit(r.peek()) || r.peek() === 0x2e) take();
    if (r.peek() === 0x45) { take(); if (r.peek() === T['-'] || r.peek() === T['+']) { r.at++; t += m[r.at - 1] === T['-'] ? '-' : '+'; } while (digit(r.peek())) take(); }
    return { k: 'num', v: Number(t) };
  }
  if (b === 0x28) { r.at++; const e = expr(r, m, 0); r.expect(0x29); return e; }
  if (b === T['-']) { r.at++; return { k: 'neg', a: expr(r, m, 7) }; }
  if (b === T['+']) { r.at++; return expr(r, m, 7); }
  if (b === T['NOT']) { r.at++; return { k: 'not', a: expr(r, m, 3) }; }
  if (b === T['FN']) { r.at++; const n = name(r); r.expect(0x28); const a = expr(r, m, 0); r.expect(0x29); return { k: 'fn-call', n, a }; }
  if (b >= 0x80 && FUNCTIONS.has(TOKENS[b - 0x80])) {
    r.at++; r.expect(0x28); const args = [expr(r, m, 0)];
    while (r.peek() === 0x2c) { r.at++; args.push(expr(r, m, 0)); }
    r.expect(0x29);
    return { k: 'fn', n: TOKENS[b - 0x80].toLowerCase(), args };
  }
  if (letter(b)) {
    const n = name(r);
    if (n === 'TI' || n === 'ST' || n === 'TI$') return { k: 'special', n: n.toLowerCase() };
    if (r.peek() === 0x28) { r.at++; const i = [expr(r, m, 0)]; while (r.peek() === 0x2c) { r.at++; i.push(expr(r, m, 0)); } r.expect(0x29); return { k: 'elem', n, i }; }
    return { k: 'var', n };
  }
  throw syntax(`$${r.at.toString(16)}: not an expression ($${b.toString(16)})`);
}

// an expression, by precedence: a relation of two of > = < at once (>=, <>) is one operator
function expr(r, m, min) {
  let a = primary(r, m);
  for (;;) {
    const b = r.peek(), op = BINARY[b];
    if (!op || op[1] < min) return a;
    r.at++;
    let o = op[0];
    if (op[1] === 4 && BINARY[r.peek()]?.[1] === 4) { o = ({ '<>': '<>', '><': '<>', '<=': '<=', '=<': '<=', '>=': '>=', '=>': '>=' })[o + BINARY[r.peek()][0]]; r.at++; }
    a = { k: 'op', o, a, b: expr(r, m, op[1] + 1) };
  }
}

// The items of the program's DATA statements, in order, as READ finds them ($AC06): each its text,
// a quoted string to its closing quote, else to a comma, a colon or the line's end, its leading
// spaces passed over; whether it was quoted; and its line, for an error's IN. A REM's line, and
// a string's, hold no DATA.
export function dataItems(m, from) {
  const items = [];
  for (const l of program(m, from)) {
    const b = l.bytes;
    for (let i = 0, q = false; b[i]; i++) {
      if (b[i] === 0x22) q = !q;
      if (q) continue;
      if (b[i] === REM_TOKEN) break;
      if (b[i] !== DATA_TOKEN) continue;
      for (i++; ; i++) {
        while (b[i] === 0x20) i++;
        let text = '', quoted = false;
        if (b[i] === 0x22) { quoted = true; for (i++; b[i] && b[i] !== 0x22; i++) text += String.fromCharCode(b[i]); if (b[i] === 0x22) i++; while (b[i] && b[i] !== 0x2c && b[i] !== 0x3a) i++; }
        else for (; b[i] && b[i] !== 0x2c && b[i] !== 0x3a; i++) text += String.fromCharCode(b[i]);
        items.push({ text, quoted, line: l.n });
        if (b[i] !== 0x2c) break;
      }
      if (!b[i]) break;
    }
  }
  return items;
}

// A line typed with no number (direct mode), its statements after the program's at `from`, as
// BASIC runs it from its buffer at `at`: a jump from it goes into the program, and the program
// ends before it. The direct statements start at the label 'direct'.
export function direct(m, from, at) {
  const out = lines(m, from);
  const numbers = new Map(out.filter(s => s.label !== undefined).map(s => [s.line, s.label]));
  out.push({ at: 0, k: 'end', args: [] }, { label: 'direct', line: 0xffff });
  statement(reader(m, at), m, out, n => numbers.has(n) ? numbers.get(n) : { missing: n }, null);
  out.push({ at: 0, k: 'end', args: [] });
  return out;
}

export function expression(m, at) {
  const r = reader(m, at), e = expr(r, m, 0);
  return { e, end: r.at };
}

// The program from `from`, BASIC's own: each line its next line's address, its number, its
// text, a zero; two zeros end it. The next line is the one after the zero, as BASIC links them
// again when it loads a program (GOLDFIELDS was saved from elsewhere). Each statement as the
// tree has Blitz!'s, `to` a line's address; the lines numbered as `numbers` says.
export function lines(m, from) {
  const out = [], numbers = new Map(), order = [];
  for (let at = from; m[at] | m[at + 1] << 8; at = m.indexOf(0, at + 4) + 1) { numbers.set(m[at + 2] | m[at + 3] << 8, at); order.push(at); }
  // (a line not there, a jump's error when it is taken: UNDEF'D STATEMENT, as BASIC finds it then)
  const line = n => numbers.has(n) ? numbers.get(n) : { missing: n };
  for (const [k, at] of order.entries()) {
    out.push({ label: at, line: m[at + 2] | m[at + 3] << 8 });
    const next = order[k + 1] ?? null, r = reader(m, at + 4);
    statement(r, m, out, line, next);
  }
  return out;
}

// the statements of one line from the reader's place, to its end
function statement(r, m, out, line, next) {
  while (!r.end() || r.peek() === 0x3a) {
    if (r.peek() === 0x3a) { r.at++; continue; }
    const at = r.at;
    // (a statement that cannot be read is its error when BASIC reaches it, and the rest of
    // the line goes with it)
    try { one(r, m, out, line, next, at); }
    catch (err) {
      if (!(err instanceof BasicError)) throw err;
      out.push({ at, k: 'fail', what: /^\?(.*) ERROR$/.exec(err.message)[1], args: [] });
      while (m[r.at]) r.at++;
    }
  }
}
function one(r, m, out, line, next, at) {
  {
    const b = r.next(), word = b >= 0x80 ? TOKENS[b - 0x80] : null;
    const say = x => out.push({ at, ...x });
    const target = () => { const v = expression(m, r.at); r.at = v.end; return v.e; };
    // PRINT's items, each with what follows it: ; nothing, , a zone, else a new line; none at
    // all, a new line
    const printItems = () => {
      if (r.end()) { say({ k: 'newline', args: [] }); return; }
      while (!r.end()) {
        const b2 = r.peek();
        if (b2 === T['TAB('] || b2 === T['SPC(']) { r.at++; const e = target(); r.expect(0x29); say({ k: b2 === T['TAB('] ? 'tab' : 'spc', args: [e] }); }
        else if (b2 === 0x3b) { r.at++; continue; }
        else if (b2 === 0x2c) { r.at++; say({ k: 'print-comma', args: [] }); continue; }
        else say({ k: 'print', args: [target()] });
        if (r.end()) { say({ k: 'newline', args: [] }); break; }
        if (r.peek() === 0x3b) { r.at++; if (r.end()) break; }
      }
    };
    if (!word || word === 'LET') {   // an assignment
      if (word) r.peek(); else r.at--;
      const t = primary(r, m); r.expect(T['=']);
      say({ k: 'let', t, e: target() });
    } else if (word === 'IF') {
      const e = target();
      if (r.peek() === T['GOTO']) { r.at++; say({ k: 'if-goto', e, to: line(number(r)) }); return; }
      r.expect(T['THEN']);
      if (digit(r.peek())) { say({ k: 'if-goto', e, to: line(number(r)) }); return; }
      // the rest of the line runs when it holds: on to the next line when not
      say({ k: 'unless', e, to: next ?? -1 });
    } else if (word === 'GOTO' || word === 'GOSUB') say({ k: word.toLowerCase(), to: line(number(r)) });
    else if (word === 'GO') { r.expect(T['TO']); say({ k: 'goto', to: line(number(r)) }); }   // GO TO
    // (a token past the statements', $A3 on, TAB( to GO: no statement begins with one)
    else if (b >= 0xa3) throw syntax(`$${at.toString(16)}: ${word} begins no statement`);
    // DATA, its items read by READ (`dataItems`), passed over to its statement's end; REM, the rest
    // of its line; RESTORE
    else if (word === 'DATA') { let q = false; while (m[r.at] && (q || m[r.at] !== 0x3a)) { if (m[r.at] === 0x22) q = !q; r.at++; } }
    else if (word === 'REM') { while (m[r.at]) r.at++; }
    else if (word === 'RESTORE') say({ k: 'restore', args: [] });
    else if (word === 'DIM') {   // DIM, each array and its sizes in turn
      for (;;) { const t = primary(r, m); if (t.k !== 'elem') fail('SYNTAX'); say({ k: 'dim', n: t.n, sizes: t.i }); if (r.peek() !== 0x2c) break; r.at++; }
    }
    else if (word === 'DEF') {   // DEF FN name(parameter) = its expression
      r.expect(T['FN']); const n = name(r); r.expect(0x28); const p = name(r); r.expect(0x29); r.expect(T['=']);
      say({ k: 'def', n, p, e: target() });
    }
    else if (word === 'INPUT') {   // INPUT, a prompt (a string, then ;) if any, and its variables
      let prompt = null;
      if (r.peek() === 0x22) { const p = primary(r, m); prompt = p.s; if (r.next() !== 0x3b) fail('SYNTAX'); }
      const targets = [];
      for (;;) { const t = primary(r, m); if (t.k !== 'var' && t.k !== 'elem') fail('SYNTAX'); targets.push(t); if (r.peek() !== 0x2c) break; r.at++; }
      say({ k: 'input-keys', prompt, targets });
    }
    else if (word === 'READ') {   // READ, each variable (or element) in turn
      for (;;) { const t = primary(r, m); if (t.k !== 'var' && t.k !== 'elem') fail('SYNTAX'); say({ k: t.n.endsWith('$') ? 'read$' : 'read', t }); if (r.peek() !== 0x2c) break; r.at++; }
    }
    else if (word === 'ON') {   // ON e GOTO or GOSUB, its lines
      const e = target(), go = r.next();
      if (go !== T['GOTO'] && go !== T['GOSUB']) fail('SYNTAX');
      const to = [line(number(r))]; while (r.peek() === 0x2c) { r.at++; to.push(line(number(r))); }
      say({ k: 'on', e, to, gosub: go === T['GOSUB'] });
    }
    else if (word === 'RETURN' || word === 'CLR' || word === 'END' || word === 'STOP' || word === 'NEW' || word === 'CONT') say({ k: word.toLowerCase(), args: [] });
    // RUN, from the start or a line; LIST, all of it or a range (a number, -, a number, either
    // left out), the numbers as LINGET reads them
    else if (word === 'RUN') say(digit(r.peek()) ? { k: 'run', to: line(number(r)), args: [] } : { k: 'run', args: [] });
    else if (word === 'LIST') {   // ($A6A4) the first number or 0; after a -, the last or 0; an end of 0 the program's end
      const from = number(r); let to = from;
      if (r.peek() === T['-']) { r.at++; to = number(r); }
      if (!r.end()) fail('SYNTAX');
      say({ k: 'list', args: [{ k: 'num', v: from }, { k: 'num', v: to || 0xffff }] });
    }
    else if (word === 'POKE') { const a = target(); r.expect(0x2c); say({ k: 'poke', a, v: target() }); }
    else if (word === 'SYS') {   // its address, and the rest of its text for the machine code
      const e = target(), text = r.at; while (m[r.at] && m[r.at] !== 0x3a) r.at++;
      say({ k: 'sys', e, text, end: r.at, words: '' });
    } else if (word === 'LOAD') {
      const args = [target()]; while (r.peek() === 0x2c) { r.at++; args.push(target()); }
      say({ k: 'load', args });
    } else if (word === 'GET' && r.peek() === 0x23) {   // GET#: its file, then each variable, a character each
      r.at++; const n = target(); r.expect(0x2c);
      const targets = [primary(r, m)]; while (r.peek() === 0x2c) { r.at++; targets.push(primary(r, m)); }
      say({ k: 'get#', args: [n], targets });
    } else if (word === 'GET') say({ k: 'get', t: primary(r, m) });
    else if (word === 'INPUT#') {   // INPUT#: its file, then its variables, as Blitz!'s INPUT# has them
      const n = target(); r.expect(0x2c);
      const targets = [primary(r, m)]; while (r.peek() === 0x2c) { r.at++; targets.push(primary(r, m)); }
      say({ k: 'input#', args: [n] });
      targets.forEach((t, i) => say({ k: i ? 'input-item' : 'input', t, last: i === targets.length - 1 }));
    }
    else if (word === 'WAIT') {   // WAIT place, mask[, flip]
      const args = [target()]; r.expect(0x2c); args.push(target());
      if (r.peek() === 0x2c) { r.at++; args.push(target()); }
      say({ k: 'wait', args });
    }
    else if (word === 'SAVE' || word === 'VERIFY') {   // its name, device and secondary address, each if given
      const args = r.end() ? [] : [target()]; while (r.peek() === 0x2c) { r.at++; args.push(target()); }
      say({ k: word.toLowerCase(), args });
    }
    else if (word === 'FOR') {
      const v = name(r); r.expect(T['=']); const from = target(); r.expect(T['TO']);
      const to = target(), step = r.peek() === T['STEP'] ? (r.at++, target()) : undefined;
      say({ k: 'let', t: { k: 'var', n: v }, e: from }); out.push({ at, k: 'for', v, to, ...step ? { step } : {} });
    } else if (word === 'NEXT') {   // NEXT, or NEXT and its variables, each in turn: NEXT J,I
      if (!letter(r.peek())) { say({ k: 'next', v: null, args: [] }); return; }
      for (;;) { say({ k: 'next-var', v: name(r), args: [] }); if (r.peek() !== 0x2c) break; r.at++; }
    }
    else if (word === 'PRINT') printItems();
    // CMD: the output to a file, and PRINT's items after a comma; PRINT#, the same, and then the
    // output back to the screen (Microsoft's PRINTN: CMD, then IODONE)
    else if (word === 'CMD' || word === 'PRINT#') {
      say({ k: 'print#', args: [target()] });
      if (r.peek() === 0x2c) r.at++; else if (!r.end()) fail('SYNTAX');
      printItems();
      if (word === 'PRINT#') say({ k: 'clrchn', args: [] });
    }
    else if (word === 'OPEN') { const args = r.end() ? [] : [target()]; while (r.peek() === 0x2c) { r.at++; args.push(target()); } say({ k: 'open', args }); }
    else if (word === 'CLOSE') say({ k: 'close', args: [target()] }); else throw new Error(`$${at.toString(16)}: ${word} is not handled`);
  }
}

const number = r => { let n = 0; while (digit(r.peek())) n = n * 10 + r.next() - 0x30; return n; };

// The keywords as BASIC's ROM keeps them (RESLST, $A09E): each one's characters, its last with
// its top bit set, in token order, then a zero: 256 bytes exactly, which LIST indexes with the
// Y register, so that past GO it comes round to the start again
const RESLST = [...TOKENS.flatMap(t => [...t].map((c, i, a) => c.charCodeAt(0) | (i === a.length - 1 ? 0x80 : 0))), 0];
const PRINT_TOKEN = T['PRINT'], DATA_TOKEN = T['DATA'], REM_TOKEN = T['REM'];

// CRUNCH ($A579): a line's text, as typed (PETSCII, after its number), to the bytes BASIC keeps,
// its keywords as tokens, as the ROM makes them, its quirks too. Outside a string, a space, a
// digit, : and ; are kept as they are, ? is PRINT, and a shifted character is dropped (pi is
// kept); else the keywords are tried in their order, a character at a time, the first that
// matches taken (so INPUT# before INPUT, and TO inside TOTAL), a shifted letter ending one early
// (P shifted-R is PRINT); no keyword, and the character is kept. A string is kept to its closing
// quote, the rest of a line after REM all of it, and after DATA all but a string's quotes to the
// next colon. The bytes end with the line's zero.
export function crunch(text) {
  const buf = [...text, 0], out = [];
  let x = 0, dores = 0;
  const stuff = a => {
    out.push(a); x++;
    if (a === 0) return 'done';
    if (a === 0x3a) dores = 0; else if (a === DATA_TOKEN) dores = DATA_TOKEN - 0x3a;
    return a === REM_TOKEN ? 'rem' : null;
  };
  // a string's or REM's characters, to the end character (a quote, or the line's zero)
  const copy = end => { for (;;) { const ch = buf[x]; if (ch === 0 || ch === end) return stuff(ch); out.push(ch); x++; } };
  for (;;) {
    let ch = buf[x], r = null;
    if (ch >= 0x80) { if (ch !== 0xff) { x++; continue; } r = stuff(ch); }
    else if (ch === 0x20) r = stuff(ch);
    else if (ch === 0x22) { out.push(ch); x++; r = copy(0x22); }
    else if (dores & 0x40) r = stuff(ch);
    else if (ch === 0x3f) r = stuff(PRINT_TOKEN);
    else if (ch >= 0x30 && ch < 0x3c) r = stuff(ch);
    else {
      // the keywords tried: the next character against the list's, until a difference of $80
      // (the keyword's last, or a shifted letter in the text) ends it, or another moves on
      // (one place in the list, as the ROM's Y: a keyword that does not match is passed from
      // where it stopped matching, which a shifted letter matching a keyword's last may carry
      // into the next)
      let y = 0, count = 0, found = null;
      for (;;) {
        let k = x;
        for (;;) { const d = (buf[k] - RESLST[y]) & 0xff; if (d === 0) { k++; y++; continue; } if (d === 0x80) found = { token: 0x80 | count, end: k }; break; }
        if (found) break;
        count++;
        do y++; while (!(RESLST[y - 1] & 0x80));
        if (RESLST[y] === 0) break;
      }
      if (found) { x = found.end; r = stuff(found.token); }
      else r = stuff(ch);
    }
    if (r === 'done') return out;
    if (r === 'rem' && copy(0) === 'done') return out;
  }
}

// LIST's text of a line ($A71A): its bytes after the number as BASIC prints them, each token
// its keyword's characters, and inside a string, the bytes as they are; pi as its character.
// Past GO the keywords come round again, Y being a byte: $CC is the table's last zero, which
// printed ends the keyword at once (CHROUT leaves Z set), and $CD on are FOR, NEXT and the rest.
// Even after REM a byte of $80 or more is a keyword's: BASIC's own oddity.
export function list(bytes) {
  const out = [];
  let quote = false;
  for (const b of bytes) {
    if (b === 0) break;
    if (b < 0x80 || b === 0xff || quote) { if (b === 0x22) quote = !quote; out.push(b); continue; }
    let n = b - 0x7f, y = 0xff;
    while (--n) { do y = (y + 1) & 0xff; while (!(RESLST[y] & 0x80)); }
    for (;;) { y = (y + 1) & 0xff; const c = RESLST[y]; if (c & 0x80) { out.push(c & 0x7f); break; } out.push(c); if (!c) break; }
  }
  return out;
}

// The program kept at `txttab` in `mem`: a line put in by its number, in its place, over one
// of the same number, or taken out when it is empty, as BASIC's line entry does ($A49C), and
// every line linked to the next again (LINKPRG, $A533). Gives the program's end, where the
// variables start (VARTAB).
export function program(mem, txttab) {
  const lines = [];
  for (let at = txttab; mem[at] | mem[at + 1] << 8; ) {
    const end = mem.indexOf(0, at + 4);
    lines.push({ n: mem[at + 2] | mem[at + 3] << 8, bytes: [...mem.subarray(at + 4, end + 1)] });
    at = end + 1;
  }
  return lines;
}
export function store(mem, txttab, n, bytes) {
  const lines = program(mem, txttab).filter(l => l.n !== n);
  if (bytes.length > 1) lines.push({ n, bytes });
  lines.sort((a, b) => a.n - b.n);
  let at = txttab;
  for (const l of lines) {
    const next = at + 4 + l.bytes.length;
    mem.set([next & 0xff, next >> 8, l.n & 0xff, l.n >> 8, ...l.bytes], at);
    at = next;
  }
  mem[at] = 0; mem[at + 1] = 0;
  return at + 2;
}
