// BASIC's ROM, moonbase's own: the routines of Commodore BASIC that a program's machine code calls,
// answered at their addresses, as the ROM's would leave the registers and memory. Shared by every
// layer that runs such code: the original on moonbase's ROMs (rom.js, on the 6510) and a remake
// (on its stand-in for the processor), as kernal.js is for the KERNAL. Its rules for numbers are
// numbers.js's, its arithmetic float.js's.
//
//   install({ cpu, read, write, evaluate, chrout })
//     cpu       a processor, or a stand-in for one: its registers, and `hooks`, which this fills
//     read, write   memory as the processor sees it
//     evaluate  the expression in BASIC's text at an address: { value, end, place }, its value (a
//               number or a string), where it ends, and for a string written in the text, where
//               its characters are. The remake takes its compiled parameters' (compiled with
//               the program, basic-compile.js); the original reads the text and BASIC's
//               variables in memory.
//     chrout    CHROUT, a character in A to the output (the KERNAL's $FFD2 unless given)
//
// A routine that returns from its caller too (`'return'`: $E206, at a statement's end) leaves
// that to the layer running it.
import { BasicError, ERRORS } from './numbers.js';
import { setFac, Floats, FloatError, unpack } from './float.js';
import { Basic } from './basic.js';
import { expression } from './basic-lang.js';
import { evaluator } from './basic-compile.js';
import { seedRandom, nextRandom } from './numbers.js';

const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');
const FAC_EXP = 0x61;
// BASIC's functions' routines, SGN to MID$, as its table at $A052 holds them
const FUNCTIONS = [0xbc39, 0xbccc, 0xbc58, 0x0310, 0xb37d, 0xb39e, 0xbf71, 0xe097, 0xb9ea, 0xbfed, 0xe264, 0xe26b, 0xe2b4, 0xe30e,
  0xb80d, 0xb77c, 0xb465, 0xb7ad, 0xb78b, 0xb6ec, 0xb700, 0xb72c, 0xb737];

export function install({ cpu, read, write, evaluate, chrout = c => cpu.hooks.get(0xffd2)(c) }) {
  // BASIC's text pointer ($7A), and what it reads there: CHRGOT ($0079) and CHRGET ($0073) as
  // BASIC's text pointer reads, spaces passed over, Z at a statement's end, C clear for a digit
  const txt = () => read(0x7a) | read(0x7b) << 8, setTxt = a => { write(0x7a, a & 0xff); write(0x7b, a >> 8 & 0xff); };
  const syntax = () => { throw new BasicError('?SYNTAX ERROR'); };
  const chrgot = c => { let a = txt(); while (read(a) === 0x20) a++; setTxt(a); const v = read(a); c.a = v; c.z = v === 0 || v === 0x3a ? 1 : 0; c.c = v >= 0x30 && v <= 0x39 ? 0 : 1; c.n = v >> 7; };
  const chkcom = c => { chrgot(c); if (c.a !== 0x2c) syntax(); setTxt(txt() + 1); chrgot(c); };
  // the expression at the text pointer: a number into the accumulator ($0D 0, numeric), a string
  // as BASIC's descriptor at $19 ($0D $FF, string)
  let last = 0;
  const frm = (c, number) => {
    chrgot(c);
    const at = txt(), { value, end, place } = evaluate(at);
    if (typeof value === 'string') {
      if (number) throw new BasicError('?TYPE MISMATCH ERROR');
      if (place === undefined) throw new Error('a string parameter not in the text, at $' + hex4(at) + ': not handled');
      write(0x19, value.length); write(0x1a, place & 0xff); write(0x1b, place >> 8); write(0x64, 0x19); write(0x65, 0); write(0x0d, 0xff);
    } else { last = value; write(0x0d, 0); setFac({ read, write }, value); }
    setTxt(end); chrgot(c);
  };
  const whole = (lo, hi) => { if (last !== Math.floor(last) || last < lo || last > hi) throw new BasicError('?ILLEGAL QUANTITY ERROR'); return last; };
  const getbyt = c => { frm(c, true); c.x = whole(0, 255); };
  // (A left as the last character out, as the ROM's leave it)
  const out = ch => { cpu.a = ch; chrout(cpu); };
  const H = {
    0x79: chrgot, 0x73: c => { setTxt(txt() + 1); chrgot(c); },
    // CHKCOM ($AEFD), FRMNUM ($AD8A), FRMEVL ($AD9E), GETADR ($B7F7), GETBYT ($B79E); FRESTR's below ($B6A3)
    0xaefd: chkcom, 0xad8a: c => frm(c, true), 0xad9e: c => frm(c, false),
    0xb7f7: c => { const x = whole(0, 65535); write(0x14, x & 0xff); write(0x15, x >> 8); c.y = x & 0xff; c.a = x >> 8; },
    0xb79e: getbyt,
    // the LOAD and OPEN parameters': $E200 a comma and a byte, $E206 the statement's end, which
    // returns from its caller, $E20E a comma and more
    0xe200: c => { chkcom(c); getbyt(c); },
    0xe206: c => { chrgot(c); if (c.z) return 'return'; },
    0xe20e: c => { chkcom(c); if (c.z) syntax(); },
    // STROUT ($AB1E), the text at A/Y to its 0; the screen cleared ($E544) and a line of it ($E9FF)
    0xab1e: c => { for (let a = c.a | c.y << 8, k = 0; read(a + k) && k < 256; k++) out(read(a + k)); },
    0xe544: () => out(0x93),
    0xe9ff: c => { const at = (read(0x288) << 8) + c.x * 40; for (let k = 0; k < 40; k++) { write(at + k, 0x20); write(0xd800 + c.x * 40 + k, read(0x286)); } },
  };
  // ---- the routines Blitz!'s runtime calls (Goldfields' GAME), on the original only ----

  // ($B194) where an array's elements begin, its header ($5F) and two bytes for each of its
  // dimensions ($0B) past it: $58/$59, and A/Y
  H[0xb194] = c => {
    let t = read(0x0b) << 1, carry = t >> 8; t &= 0xff;
    t += 5 + carry; carry = t >> 8; t &= 0xff;
    t += read(0x5f) + carry; carry = t >> 8; t &= 0xff;
    let y = read(0x60); if (carry) y = (y + 1) & 0xff;
    write(0x58, t); write(0x59, y); c.a = t; c.y = y; c.c = carry;
    const flag = carry ? y : t; c.z = flag ? 0 : 1; c.n = flag >> 7;
  };
  // REASON ($A408): whether the address in A/Y is below the strings' bottom (FRETOP, $33), the
  // flags as the comparison leaves them (C clear); if not, the strings collected (GARBAG, $B526)
  // and the comparison again, its registers kept across it; and if still not, OUT OF MEMORY
  const below = (a, y) => { const top = read(0x34); if (y !== top) return y < top; return a < read(0x33); };
  const compare = (c, a, y) => { const top = read(0x34), v = y !== top ? y - top : a - read(0x33); c.c = v >= 0 ? 1 : 0; c.z = (v & 0xff) ? 0 : 1; c.n = v >> 7 & 1; };
  H[0xa408] = c => {
    const { a, y } = c;
    if (below(a, y)) return compare(c, a, y);
    const kept = []; for (let k = 0x57; k <= 0x60; k++) kept.push(read(k));
    H[0xb526](c);
    kept.forEach((v, k) => write(0x57 + k, v));
    Object.assign(c, { a, y });
    if (below(a, y)) return compare(c, a, y);
    throw new BasicError('?OUT OF MEMORY ERROR');
  };
  // UMULT ($B34C): an array's index ($71/$72) times its dimension's size, read from its header at
  // ($5F)+Y (the low byte) and Y-1 (the high), into X/Y (A the high byte too); past 16 bits is OUT
  // OF MEMORY. $71/$72 are shifted out to 0, $5D counted down to 0, as the ROM leaves them.
  H[0xb34c] = c => {
    write(0x22, c.y);
    const base = read(0x5f) | read(0x60) << 8, size = read(base + c.y) | read(base + ((c.y - 1) & 0xff)) << 8;
    write(0x28, size & 0xff); write(0x29, size >> 8);
    const index = read(0x71) | read(0x72) << 8, product = index * size;
    // (the ROM's own test: a shift or a sum carrying out of 16 bits on the way, which for a
    // product past 16 bits it always meets)
    if (product > 0xffff) throw new BasicError('?OUT OF MEMORY ERROR');
    write(0x71, 0); write(0x72, 0); write(0x5d, 0);
    Object.assign(c, { x: product & 0xff, y: product >> 8, a: product >> 8, c: 0, z: 1, n: 0 });
  };
  // ($B2AA) DIM's end: the array's elements, A/X bytes of them (high, low) from $58/$59, past the
  // end of memory OUT OF MEMORY; then REASON for its end, the arrays' end (STREND, $31) there,
  // its elements cleared to 0 (a page at a time down from the last, as the ROM does), and its
  // length into its header, at ($5F)+2. DIM's flag ($0C) set, back to DIM; an array made by its
  // first use, which goes on to find its element, is not handled (an error).
  H[0xb2aa] = c => {
    const start = read(0x58) | read(0x59) << 8;
    let hi = c.a + read(0x59) + c.c;
    if (hi > 255) throw new BasicError('?OUT OF MEMORY ERROR');
    write(0x59, hi);
    let lo = c.x + read(0x58);
    if (lo > 255) { lo &= 0xff; hi = (hi + 1) & 0xff; if (!hi) throw new BasicError('?OUT OF MEMORY ERROR'); }
    const kept = { a: c.a, x: c.x };
    Object.assign(c, { a: lo, y: hi }); H[0xa408](c);
    write(0x31, lo); write(0x32, hi);
    const end = lo | hi << 8;
    for (let a = start; a < end; a++) write(a, 0);
    write(0x59, start >> 8); write(0x72, 0);
    const base = read(0x5f) | read(0x60) << 8, length = end - base;
    write(base + 2, length & 0xff); write(base + 3, length >> 8);
    if (!read(0x0c)) throw new Error('an array made by its first use ($B2AA, DIM\'s flag clear): not handled');
    const f = read(0x0c);
    Object.assign(c, { a: f, x: kept.x, y: 3, c: 1, z: f ? 0 : 1, n: f >> 7 });
  };
  // SYS's own ($E130): a return pushed to $E147, the registers from $030C to $030F (A, X, Y, the
  // flags), and on to the address at $14/$15 (GETADR's), where the machine code runs; and $E147, as
  // it comes back (or as a routine ends that jumps there), the registers kept at $030C again
  H[0xe130] = c => {
    c.push(0xe1); c.push(0x46);
    Object.assign(c, { a: read(0x30c), x: read(0x30d), y: read(0x30e) }); c.p = read(0x30f);
    c.pc = read(0x14) | read(0x15) << 8;
    return false;
  };
  H[0xe147] = c => { write(0x30c, c.a); write(0x30d, c.x); write(0x30e, c.y); write(0x30f, c.p); };
  // The accumulator onto the processor's stack, for the evaluator ($AE38): the caller's return
  // taken into $22/$23, its low byte one on (only the low byte: the ROM's INC carries no further),
  // A pushed (the sign), then ($AE43) the accumulator rounded and its five bytes pushed, the
  // exponent last, and on to the caller at ($22)
  const f = new Floats({ read, write });
  // (a routine called from the ROM's code at `from`, its JSR's return address on the stack for the
  // while, as an observer sees the ROM's own calls)
  const call = (c, at, from) => { const r = from + 2; c.push(r >> 8); c.push(r & 0xff); try { return cpu.hooks.get(at)(c); } finally { c.pull(); c.pull(); } };
  // (the floating point's errors, an overflow or a division by zero, as BASIC's)
  const arith = g => { try { return g(); } catch (err) { if (err instanceof FloatError) throw new BasicError('?' + ERRORS[err.x - 1] + ' ERROR'); throw err; } };
  H[0xae38] = c => {
    const y = c.a, lo = c.pull(), hi = c.pull();
    write(0x22, (lo + 1) & 0xff); write(0x23, hi); c.y = y; c.push(y);
    return H[0xae43](c);
  };
  H[0xae43] = c => {
    f.round();
    for (const at of [0x65, 0x64, 0x63, 0x62, 0x61]) c.push(read(at));
    c.a = read(0x61); c.z = c.a ? 0 : 1; c.n = c.a >> 7;
    c.pc = read(0x22) | read(0x23) << 8;
    return false;
  };
  // The floating point's entries (float.js, each held to the ROM's): the address of a
  // number in memory in A/Y (X/Y for a store, FORPNT $49 for BBD0's, $5C and $57 for BBC7's and
  // BBCA's); A the result's exponent, or the comparison's or the sign's answer, its flags N and Z.
  // An overflow or a division by zero is BASIC's error.
  const ay = c => c.a | c.y << 8, nz = (c, v) => { c.z = v & 0xff ? 0 : 1; c.n = v >> 7 & 1; };
  const floating = (run, regs = () => ({})) => c => {
    const r = arith(() => run(c));
    Object.assign(c, regs(c, r) ?? {});
    nz(c, c.a);
  };
  const A = (c, r) => ({ a: r?.a ?? read(0x61) });
  Object.assign(H, {
    0xbba2: floating(c => f.movfm(ay(c)), (c, r) => ({ a: r.a, y: 0 })),
    0xbbd4: floating(c => f.movmf(c.x | c.y << 8), (c, r) => ({ a: r.a, y: 0 })),
    0xbbd0: floating(c => { c.x = read(0x49); c.y = read(0x4a); return f.movmf(c.x | c.y << 8); }, (c, r) => ({ a: r.a, y: 0 })),
    0xbbc7: floating(c => { c.x = 0x5c; return f.movmf(0x5c); }, (c, r) => ({ a: r.a, y: 0 })),
    0xbbca: floating(c => { c.x = 0x57; return f.movmf(0x57); }, (c, r) => ({ a: r.a, y: 0 })),
    0xbbfc: floating(() => f.movfa(), () => ({ a: read(0x69), x: 0 })),
    0xbc0c: floating(() => f.movaf(), () => ({ a: read(0x61), x: 0 })),
    0xbc0f: floating(() => f.movef(), () => ({ a: read(0x61), x: 0 })),
    0xbc1b: floating(() => f.round(), () => ({ a: read(0x61) })),
    0xbc2b: floating(() => ({ a: f.sign() }), (c, r) => ({ a: r.a, c: read(0x66) >> 7 })),
    0xbc5b: floating(c => f.compare(ay(c)), (c, r) => r),
    0xbc5d: floating(c => f.compare(read(0x24) | c.y << 8), (c, r) => r),
    0xb867: floating(c => f.fadd(ay(c)), A), 0xb86a: floating(() => f.faddt(), A),
    0xb850: floating(c => f.fsub(ay(c)), A), 0xb853: floating(() => f.fsubt(), A),
    0xba28: floating(c => f.fmult(ay(c)), A), 0xba2b: floating(() => f.fmultt(), A),
    0xbb0f: floating(c => f.fdiv(ay(c)), A), 0xbb12: floating(() => f.fdivt(), A),
    0xbccc: floating(() => f.int(), A), 0xbc9b: floating(() => f.qint(), () => ({ y: 0 })),
    // ($BCDB) a 32-bit whole number in $62 to $65 as a number, negative when A's top bit is set,
    // as INT enters it and Blitz! does
    0xbcdb: floating(c => f.float32(c.a), A),
    // the functions on the series: LOG, EXP, the power (entered past its test of the FAC, at $BF7B,
    // its Z flag that test's), SQR (a half's power), SIN and COS
    0xb9ea: floating(() => f.log(), A), 0xbfed: floating(c => f.exp(c.c), A),
    0xbf7b: floating(c => f.fpwrt(c.z, c.c), A), 0xbf71: floating(c => { f.movaf(); f.movfm(0xbf11); return f.fpwrt(0, c.c); }, A),
    0xe26b: floating(() => f.sin(), A), 0xe264: floating(() => f.cos(), A),
  });
  // RND ($E097): the next of the seed's numbers (numbers.js, the remake's own) into the
  // accumulator, whatever RND's argument; A its exponent, so that the original and the remake draw
  // the same numbers.
  let randomState = null;
  H[0xe097] = c => {
    randomState = nextRandom(randomState ?? seedRandom(0x11));
    setFac({ read, write }, randomState / 2 ** 32);
    c.a = read(0x61); nz(c, c.a);
  };
  // ($BF04) FOUT's end, which Blitz! calls to end a number's text: A at $00FF+Y, a 0 after it, and
  // the text's address, $0100, in A/Y
  H[0xbf04] = c => { write(0xff + c.y, c.a); write(0x100 + c.y, 0); Object.assign(c, { a: 0, y: 1, z: 0, n: 0 }); };
  // FIN ($BCF3): the number in BASIC's text at its pointer, read with CHRGET, into the FAC, A its
  // first character and C clear for a digit, as CHRGOT leaves them. As the ROM builds it (each
  // step float.js's): $5D to $67 cleared, the FAC with them; a sign; each digit the FAC ten
  // times and the digit added, those after the point counted ($5D); a second point the end; an E,
  // its sign ($60) and its digits ($5E), capped at 100 when negative and an overflow past 9 when
  // not; then ten times or a tenth for each power left, and the sign last.
  H[0xbcf3] = c => {
    for (let x = 0x0a; x >= 0; x--) write(0x5d + x, 0);
    const next = () => H[0x73](c), digit = () => !c.c;
    if (!digit()) {
      if (c.a === 0x2d) { write(0x67, 0xff); next(); }
      else if (c.a === 0x2b) next();
    }
    let power;
    for (;;) {
      if (digit()) {
        const ch = c.a;
        if (read(0x5f) & 0x80) write(0x5d, read(0x5d) + 1);
        arith(() => { f.mul10(); f.addDigit(ch - 0x30); });
        next(); continue;
      }
      if (c.a === 0x2e) {
        write(0x5f, (read(0x5f) >> 1) | 0x80);
        if (read(0x5f) & 0x40) { power = read(0x5e); break; }
        next(); continue;
      }
      if (c.a === 0x45) {
        next();
        if (c.c && (c.a === 0xab || c.a === 0x2d)) { write(0x60, (read(0x60) >> 1) | 0x80); next(); }
        else if (c.c && (c.a === 0xaa || c.a === 0x2b)) next();
        while (digit()) {
          const e = read(0x5e);
          if (e >= 10) { if (!(read(0x60) & 0x80)) throw new BasicError('?OVERFLOW ERROR'); write(0x5e, 100); }
          else write(0x5e, e * 10 + c.a - 0x30);
          next();
        }
        power = read(0x60) & 0x80 ? (0 - read(0x5e)) & 0xff : read(0x5e);
        break;
      }
      power = read(0x5e); break;
    }
    let n = (power - read(0x5d)) & 0xff; write(0x5e, n);
    if (n && n < 0x80) for (; n; n = (n - 1) & 0xff) { arith(() => f.mul10()); write(0x5e, n - 1); }
    else if (n) for (; n; n = (n + 1) & 0xff) { arith(() => f.div10()); write(0x5e, (n + 1) & 0xff); }
    if (read(0x67) & 0x80) f.negop();
    c.a = read(read(0x67) & 0x80 ? 0x66 : 0x67); nz(c, c.a);
  };
  // TI ($AF7B): the clock read (RDTIM, $FFDE: A, X, Y its low, middle and high bytes) as a 24-bit
  // whole number in the FAC ($62 0, $63 to $65 the clock), exponent $A0, its low bits and sign 0,
  // then normalised; as the ROM goes on through $B8D2, a carry clear on entry has it negated first
  // ($AF84) the clock (RDTIM) into the FAC's mantissa, $63 to $65, $62 0; Y 0
  const clock = c => { call(c, 0xffde, 0xaf84); write(0x64, c.x); write(0x63, c.y); write(0x65, c.a); write(0x62, 0); c.y = 0; };
  H[0xaf7b] = c => {
    const carry = c.c;
    clock(c);
    write(FAC_EXP, 0xa0); write(0x70, 0); write(0x66, 0);
    if (!carry) f.negate();
    const r = f.normal(); Object.assign(c, { a: r.a, y: 0 }); nz(c, c.a);
  };
  // WAIT's loop ($B83C, X the bits to flip, $49 the mask, $14 the address): at $B840, the address
  // read until its bits, flipped, meet the mask; the machine goes on meanwhile, as the ROM's loop
  // does
  H[0xb83c] = c => { write(0x4a, c.x); c.y = 0; c.pc = 0xb840; return false; };
  H[0xb840] = c => {
    const v = (read((read(0x14) | read(0x15) << 8) + c.y) ^ read(0x4a)) & read(0x49);
    if (!v) return 'wait';
    c.a = v; nz(c, v);
  };
  // FREFAC ($B6A6): the string whose descriptor is at $64/$65, its length in A, its characters'
  // address in $22/$23 (X/Y); its descriptor let go if it is the last temporary one (FRETMS,
  // $B6DB: $16 and $17 three back), and its characters too if they are the strings' bottom
  // (FRETOP, $33, moved up past them)
  H[0xb6a6] = c => {
    const at = read(0x64) | read(0x65) << 8;
    write(0x22, at & 0xff); write(0x23, at >> 8);
    const freed = H[0xb6db]({ a: at & 0xff, y: at >> 8 });
    const len = read(at), x = read(at + 1), y = read(at + 2);
    if (freed && y === read(0x34) && x === read(0x33)) { const top = read(0x33) + len; write(0x33, top & 0xff); if (top > 255) write(0x34, read(0x34) + 1); }
    write(0x22, x); write(0x23, y);
    Object.assign(c, { a: len, x, y }); nz(c, len);
  };
  H[0xb6db] = c => {
    if (c.y !== read(0x18) || c.a !== read(0x17)) { c.z = 0; return false; }
    write(0x16, c.a); write(0x17, (c.a - 3) & 0xff); c.y = 0; c.z = 1;
    return true;
  };
  // ($AFD5) a function's call, the evaluator's: A its token times two, its routine's address from
  // BASIC's table ($A052) into JMPER's ($55/$56) and called there; then CHKNUM ($AD8D), its
  // result a number or TYPE MISMATCH
  H[0xafd5] = c => {
    const to = FUNCTIONS[(c.a - 0x68) >> 1];
    if (to === undefined || c.a & 1) throw new Error('a function at $' + hex4(0x9fea + c.a) + ' ($AFD5): not handled');
    write(0x55, to & 0xff); write(0x56, to >> 8);
    c.y = c.a; c.push(0xaf); c.push(0xe2); c.pc = to;
    return false;
  };
  H[0xafe3] = c => { const t = read(0x0d); if (t & 0x80) throw new BasicError('?TYPE MISMATCH ERROR'); c.n = 1 & t >> 7; c.v = 1 & t >> 6; c.z = c.a & t ? 0 : 1; };
  // VAL's own ($B7B0), past LEN's start ($B782: A the string's length, $22/$23 its characters):
  // none, the FAC 0 ($B8F7); else the text pointer kept at $71/$72 and moved to the string, a 0
  // put past its end ($24/$25) for the while, and FIN; then the byte and the pointer back
  H[0xb7b0] = c => {
    if (!c.a) { write(FAC_EXP, 0); write(0x66, 0); c.a = 0; c.z = 1; c.n = 0; return; }
    const from = read(0x22) | read(0x23) << 8, end = from + c.a;
    write(0x71, read(0x7a)); write(0x72, read(0x7b));
    setTxt(from); write(0x24, end & 0xff); write(0x25, end >> 8 & 0xff);
    const kept = read(end); write(end, 0);
    H[0x79](c); H[0xbcf3](c);
    write(end, kept);
    Object.assign(c, { a: kept, x: read(0x71), y: read(0x72) }); nz(c, c.y);
    setTxt(c.x | c.y << 8);
  };
  // TI$ set ($A9E0, the string evaluated): FREFAC, six characters or ILLEGAL QUANTITY; the FAC 0,
  // then for each pair a character added ($AA1D), ten times, the next added and six times (twice
  // over, then $BAED, unless 0): the time in jiffies over ten, ten times again, QINT, and the
  // clock set (SETTIM, $FFDB) from $65, $64 and $63. A character is a digit for the ROM if it is
  // "0" or more, CHRGOT entered past its colon test ($0080); a space goes on to CHRGET itself.
  H[0xa9e0] = c => {
    H[0xb6a6](c);
    if (c.a !== 6) throw new BasicError('?ILLEGAL QUANTITY ERROR');
    write(FAC_EXP, 0); write(0x66, 0);
    const character = y => {
      c.a = read((read(0x22) | read(0x23) << 8) + y);
      if (c.a === 0x20) H[0x73](c); else c.c = c.a >= 0x30 ? 0 : 1;
      if (c.c) throw new BasicError('?ILLEGAL QUANTITY ERROR');
      arith(() => f.addDigit((c.a - 0x30) & 0xff));
    };
    for (let y = 0; y < 6; y += 2) {
      write(0x71, y); character(y); arith(() => f.mul10());
      write(0x71, y + 1); character(y + 1);
      const { a } = f.movaf(); if (a) arith(() => f.addDoubled(a + 1));
    }
    arith(() => f.mul10()); f.qint();
    Object.assign(c, { x: read(0x64), y: read(0x63), a: read(0x65) });
    return cpu.hooks.get(0xffdb)(c);
  };
  // FOUT's digits ($BE68, Y the table's place, $BF16 on): the 32-bit whole number in $62 to $65
  // counted down (or up) by each power until it passes 0, the count a digit, to $00FF on at $71+1
  // (a point after the $5D'th); to Y $24, or $3C (TI$'s). Then ($BEC4) the zeros at the end let go,
  // and a point there, an exponent from $5E, and a 0 after
  const digits = c => {
    let x = 0x80, y = c.y, cy = 0;
    for (;;) {
      do {
        let sum = 0; cy = 0;
        for (let k = 3; k >= 0; k--) { sum = read(0x62 + k) + read(0xbf16 + y + k) + cy; write(0x62 + k, sum); cy = sum >> 8; }
        x = (x + 1) & 0xff;
      } while (cy ? x & 0x80 : !(x & 0x80));
      let a = x;
      if (cy) { const t = (a ^ 0xff) + 0x0a + 1; a = t & 0xff; cy = t >> 8; }
      a = (a + 0x2f + cy) & 0xff;
      y = (y + 4) & 0xff; write(0x47, y);
      let at = (read(0x71) + 1) & 0xff;
      write(0xff + at, a & 0x7f);
      write(0x5d, read(0x5d) - 1);
      if (!read(0x5d)) { at = (at + 1) & 0xff; write(0xff + at, 0x2e); }
      write(0x71, at);
      x = (a ^ 0xff) & 0x80;
      if (y === 0x24 || y === 0x3c) break;
    }
    let at = read(0x71), ch;
    do { ch = read(0xff + at); at = (at - 1) & 0xff; } while (ch === 0x30);
    if (ch !== 0x2e) at = (at + 1) & 0xff;
    let e = read(0x5e);
    if (e) {
      let sign = 0x2b; if (e & 0x80) { e = (0 - e) & 0xff; sign = 0x2d; }
      write(0x101 + at, sign); write(0x100 + at, 0x45);
      write(0x103 + at, 0x30 + e % 10); write(0x102 + at, 0x30 + Math.floor(e / 10)); write(0x104 + at, 0);
    } else write(0x100 + at, 0);
    Object.assign(c, { a: 0, y: 1, z: 0, n: 0 });
  };
  H[0xbe68] = digits;
  // GETSPA ($B4F4): A bytes of the strings' space, down from FRETOP ($33), FRESPC ($35) too, X/Y
  // their address; below STREND ($31), the strings collected first ($0F the flag), then OUT OF
  // MEMORY
  H[0xb4f4] = c => {
    const len = c.a;
    write(0x0f, read(0x0f) >> 1);
    for (;;) {
      const at = r16(0x33) - len;
      if (at >= r16(0x31) && at >= 0) { w16(0x33, at); w16(0x35, at); Object.assign(c, { a: len, x: at & 0xff, y: at >> 8 }); return; }
      if (read(0x0f) & 0x80) throw new BasicError('?OUT OF MEMORY ERROR');
      H[0xb526](c); write(0x0f, 0x80);
    }
  };
  // STRINI ($B475: $50/$51 the descriptor's at $64/$65 kept; $B47D): a string of A bytes made
  // room for, its descriptor in the FAC's $61 to $63
  H[0xb47d] = c => { H[0xb4f4](c); write(0x62, c.x); write(0x63, c.y); write(0x61, c.a); };
  H[0xb475] = c => { write(0x50, read(0x64)); write(0x51, read(0x65)); return H[0xb47d](c); };
  // MOVSTR ($B688): A bytes from X/Y to FRESPC ($35), and FRESPC on past them
  H[0xb688] = c => {
    write(0x22, c.x); write(0x23, c.y);
    const from = c.x | c.y << 8, to = r16(0x35), len = c.a;
    for (let k = len - 1; k >= 0; k--) write(to + k, read(from + k));
    w16(0x35, to + len);
  };
  // PUTNEW ($B4CA): the FAC's descriptor ($61 to $63) pushed on the temporary ones (TEMPPT, $16;
  // full at $22, FORMULA TOO COMPLEX), its address at $64/$65, LASTPT ($17) it, $0D a string
  H[0xb4ca] = c => {
    const x = read(0x16);
    if (x === 0x22) throw new BasicError('?FORMULA TOO COMPLEX ERROR');
    write(x, read(0x61)); write(x + 1, read(0x62)); write(x + 2, read(0x63));
    write(0x64, x); write(0x65, 0); write(0x70, 0); write(0x0d, 0xff); write(0x17, x); write(0x16, x + 3);
    Object.assign(c, { x: x + 3, y: 0xff });
  };
  // STRLIT ($B487, the text at A/Y; $B46F at $00FF, FOUT's): to a 0 or a quote; copied into the
  // strings' space if it is in the zero page or the input buffer (page 0 or 2), else left where it
  // is; and PUTNEW
  H[0xb487] = c => {
    write(0x07, 0x22); write(0x08, 0x22);
    const from = c.a | c.y << 8;
    write(0x6f, c.a); write(0x70, c.y); write(0x62, c.a); write(0x63, c.y);
    let y = 0, quote = 0;
    for (; ; y++) { const ch = read(from + y); if (!ch) break; if (ch === 0x22) { quote = 1; break; } }
    write(0x61, y);
    const end = from + y + quote; write(0x71, end & 0xff); write(0x72, end >> 8 & 0xff);
    if (c.y === 0 || c.y === 2) { c.a = y; H[0xb475](c); Object.assign(c, { a: y, x: from & 0xff, y: from >> 8 }); H[0xb688](c); }
    return H[0xb4ca](c);
  };
  H[0xb46f] = c => { Object.assign(c, { a: 0xff, y: 0 }); return H[0xb487](c); };
  // TI$ ($AF48): the clock, as TI's, counted out to its six digits (hours, minutes, seconds; $5E
  // no exponent, $71 the text's start, a point after the sixth and let go), and a string of them
  H[0xaf48] = c => {
    clock(c);
    write(0x5e, 0); write(0x71, 0xff); write(0x5d, 6);
    c.y = 0x24; digits(c);
    return H[0xb46f](c);
  };
  // ($B248) ILLEGAL QUANTITY, as Blitz! jumps there
  H[0xb248] = () => { throw new BasicError('?ILLEGAL QUANTITY ERROR'); };
  // FRESTR ($B6A3): CHKSTR ($AD8F), a string or TYPE MISMATCH, then FREFAC
  H[0xb6a3] = c => { if (!(read(0x0d) & 0x80)) throw new BasicError('?TYPE MISMATCH ERROR'); return H[0xb6a6](c); };
  // ($E25A) a file's name, the string evaluated: FRESTR, and SETNAM ($FFBD) with it
  H[0xe25a] = c => { H[0xb6a3](c); c.x = read(0x22); c.y = read(0x23); return cpu.hooks.get(0xffbd)(c); };
  // GARBAG ($B526), the strings collected, as the ROM does it, byte for byte: the strings' bottom
  // (FRETOP, $33) at the top of memory (MEMSIZ, $37), then, over and over, the highest string
  // below it still to move found (its address $5F/$60, from STREND $31 up; its descriptor's
  // $4E/$4F, and $55 the step it was found with) among the temporary descriptors ($19 to TEMPPT,
  // $16, a step of $53 as it stands), the variables (VARTAB $2D to ARYTAB $2F, seven bytes each, a
  // string's two name bytes top bit clear then set) and the string arrays' elements (to STREND,
  // three bytes each, past each one's header), and moved up to just under the bottom (BLTUC,
  // $A3BF), its descriptor pointed there, and that the bottom; until none is left
  const r16 = a => read(a) | read(a + 1) << 8, w16 = (a, v) => { write(a, v & 0xff); write(a + 1, v >> 8 & 0xff); };
  // (one descriptor at ($22)+y ($B5C7): a string, below the bottom and above the best so far, the
  // best; then $22 on by the step, $53)
  const candidate = y => {
    const at = r16(0x22);
    if (read(at + y)) {
      const lo = read(at + y + 1), hi = read(at + y + 2);
      const below = hi < read(0x34) || (hi === read(0x34) && lo < read(0x33));
      const above = hi > read(0x60) || (hi === read(0x60) && lo >= read(0x5f));
      if (below && above) { write(0x5f, lo); write(0x60, hi); w16(0x4e, at); write(0x55, read(0x53)); }
    }
    w16(0x22, at + read(0x53));
  };
  // BLTUC ($A3BF): the bytes from $5F/$60 to $5A/$5B moved to end at $58/$59, from the top down,
  // a page at a time, those pointers left as the ROM's loop leaves them
  const bltuc = () => {
    const n = (r16(0x5a) - r16(0x5f)) & 0xffff;
    let y = n & 0xff, x = ((n >> 8) + 1) & 0xff;
    write(0x22, y);
    const copy = k => write(r16(0x58) + k, read(r16(0x5a) + k));
    if (y) { w16(0x5a, r16(0x5a) - y); w16(0x58, r16(0x58) - y); }
    for (let first = true; ; first = false) {
      if (!first || y) { do { y = (y - 1) & 0xff; if (y) copy(y); } while (y); copy(0); }
      write(0x5b, (read(0x5b) - 1) & 0xff); write(0x59, (read(0x59) - 1) & 0xff);
      x = (x - 1) & 0xff; if (!x) break;
    }
  };
  H[0xb526] = c => {
    let bottom = r16(0x37);
    for (;;) {
      w16(0x33, bottom); w16(0x4e, 0); w16(0x5f, r16(0x31));
      for (w16(0x22, 0x19); read(0x22) !== read(0x16);) candidate(0);
      write(0x53, 7);
      for (w16(0x22, r16(0x2d)); r16(0x22) !== r16(0x2f);) {
        const at = r16(0x22);
        if (!(read(at) & 0x80) && read(at + 1) & 0x80) candidate(2); else w16(0x22, at + 7);
      }
      w16(0x58, r16(0x2f));
      write(0x53, 3);
      while (r16(0x58) !== r16(0x31)) {
        const at = r16(0x58); w16(0x22, at);
        // (its length added with the carry the comparison with STREND left, clear below it)
        w16(0x58, at + r16(at + 2) + (at >= r16(0x31) ? 1 : 0));
        if (read(at) & 0x80 || !(read(at + 1) & 0x80)) continue;
        // (past its header: five bytes and two for each dimension, the ROM's sum carrying once only)
        const v = ((read(at + 4) << 1) & 0xff) + 5 + (read(at + 4) >> 7);
        w16(0x22, at + (v & 0xff) + (v >> 8));
        while (r16(0x22) !== r16(0x58)) candidate(0);
      }
      if (!r16(0x4e)) { Object.assign(c, { a: 0, x: read(0x23), y: 0, z: 1, n: 0 }); return; }
      const y = (read(0x55) & 4) >> 1; write(0x55, y);
      w16(0x5a, r16(0x5f) + read(r16(0x4e) + y));
      w16(0x58, r16(0x33));
      bltuc();
      write(r16(0x4e) + y + 1, read(0x58));
      write(0x59, (read(0x59) + 1) & 0xff);
      write(r16(0x4e) + y + 2, read(0x59));
      bottom = r16(0x58);
    }
  };
  for (const [a, f] of Object.entries(H)) cpu.hooks.set(+a, f);
}

// A BASIC error, as the ROM's routine gives it ($A43A, through the vector at $0300): the output
// back to the screen (CLRCHN), a new line, ? and the message, ERROR, IN and the "line" (for
// Blitz!'s code its program counter at the instruction that failed), then READY. False if the
// message is not one of BASIC's.
export function printError({ cpu, write }, message, line) {
  const what = /^\?(.*) ERROR$/.exec(message)?.[1];
  if (!ERRORS.includes(what)) return false;
  const out = ch => { cpu.a = ch; cpu.hooks.get(0xffd2)(cpu); };
  const text = s => { for (const ch of s) out(ch.charCodeAt(0)); };
  cpu.hooks.get(0xffcc)(cpu); write(0x13, 0);
  out(0x0d); out(0x3f); text(what); text('  ERROR');
  if (line !== undefined && line >> 8 !== 0xff) { text(' IN '); text(String(line)); }
  text('\r\nREADY.\r\n');
  write(0x9d, 0x80);
  return true;
}

// The evaluator on the original: the expression in BASIC's text at an address read
// (basic-lang.js), made a function by the compiler's own code (basic-compile.js),
// and worked out by BASIC's own rules (basic.js's), its variables read where BASIC keeps
// them: its table from VARTAB ($2D) to ARYTAB ($2F), seven bytes each, two of name (a whole
// number's both with the top bit set, a string's the second) and five of value (a number's five
// bytes; a whole number's high and low; a string's length and where it is). RND is the ROM's
// routine at $E097, called as the ROM's evaluator calls it. Each address's function is kept.
export function evaluateInMemory({ cpu, read, write, ram }) {
  const f = new Floats({ read, write }), made = new Map();
  const variable = n => {
    const kind = n.endsWith('%') ? '%' : n.endsWith('$') ? '$' : '', name = kind ? n.slice(0, -1) : n;
    const c1 = name.charCodeAt(0) | (kind === '%' ? 0x80 : 0), c2 = (name.charCodeAt(1) || 0) | (kind ? 0x80 : 0);
    const end = read(0x2f) | read(0x30) << 8;
    for (let at = read(0x2d) | read(0x2e) << 8; at < end; at += 7) {
      if (read(at) !== c1 || read(at + 1) !== c2) continue;
      const v = [2, 3, 4, 5, 6].map(k => read(at + k));
      if (kind === '%') return (v[0] << 8 | v[1]) << 16 >> 16;
      if (kind === '$') { let s = ''; const p = v[1] | v[2] << 8; for (let k = 0; k < v[0]; k++) s += String.fromCharCode(read(p + k)); return s; }
      return unpack(v);
    }
    throw new Error(`the variable ${n} not in BASIC's table: its making by PTRGET not handled`);
  };
  const b = Object.assign(Object.create(Basic.prototype), {
    get: variable,
    rnd: () => { cpu.hooks.get(0xe097)(cpu); return f.fac(); },
  });
  // (the text read from RAM, where a program's is: `ram`)
  return at => {
    const { e, end } = expression(ram, at);
    let fn = made.get(at); if (!fn) made.set(at, fn = evaluator(e));
    return { value: fn(b), end, place: e.k === 'str' ? e.at : undefined };
  };
}
