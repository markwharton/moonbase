// Commodore BASIC's floating point, moonbase's own: the five-byte numbers BASIC keeps, and its
// arithmetic on them, computing what BASIC's ROM computes, to the bit. It works where the ROM's
// does, in the zero page, so that moonbase's BASIC ROM (basic-rom.js) can answer a program's
// call into the ROM's arithmetic at its own address and leave memory as the ROM leaves it. Every
// routine here is held to Commodore's, run on the processor, from thousands of random starting
// states.
//
//   const f = new Floats(memory)        memory: read(address) and write(address, value)
//
// A number in memory is five bytes: its exponent (128 + the power of two, 0 for zero), then
// its 32-bit mantissa, highest byte first, whose top bit, always 1, is the sign's place. In the
// accumulator (FAC, $61 to $66) the mantissa's top bit is 1 and the sign has its own byte, $66;
// a sixth byte, $70, holds the bits below the mantissa, which an operation keeps, and only
// storing a number (or ROUND) rounds them in. The other operand (ARG, $69 to $6E) is the same,
// its own low bits at $56 while an addition lines the two up. $6F is the two signs' EOR.
//
// The ROM's routines have their ways, and these keep them: the low bits are kept, not rounded,
// until a number is stored; a shift by whole bytes brings in $68 at the top, whatever an earlier
// routine left there; a shift's length depends on the carry it is entered with. Each method
// says the ROM's address it stands for; its results are the ROM's, in memory and in the
// registers its callers read (`regs`).
export const FAC = 0x61, ARG = 0x69, FACOV = 0x70, ARGOV = 0x56, ARISGN = 0x6f, BITS = 0x68, RESHO = 0x26;

// Constants of BASIC's that its routines take from the ROM, by their place there: their values,
// as five bytes, each named as Microsoft's source names it (BASIC-M6502). A game that reads one
// reads it from moonbase's ROM image too (rom.js).
const words = ns => ns.flatMap(n => [n >>> 24 & 0xff, n >>> 16 & 0xff, n >>> 8 & 0xff, n & 0xff]);
export const CONSTANTS = {
  0xb9bc: [0x81, 0x00, 0x00, 0x00, 0x00],   // 1 (Microsoft's FONE)
  0xbf11: [0x80, 0x00, 0x00, 0x00, 0x00],   // 0.5 (FHALF)
  0xbaf9: [0x84, 0x20, 0x00, 0x00, 0x00],   // 10 (TENZC)
  // LOG's: its series' (a count, then the coefficients of x squared, highest first, for POLY1),
  // the square roots of a half and of two, -0.5, and the logarithm of two (LOGCN2, SQRHLF, SQRTWO,
  // NEGHLF, LOG2)
  0xb9c1: [0x03, 0x7f, 0x5e, 0x56, 0xcb, 0x79, 0x80, 0x13, 0x9b, 0x0b, 0x64, 0x80, 0x76, 0x38, 0x93, 0x16, 0x82, 0x38, 0xaa, 0x3b, 0x20],
  0xb9d6: [0x80, 0x35, 0x04, 0xf3, 0x34],   // 0.707...
  0xb9db: [0x81, 0x35, 0x04, 0xf3, 0x34],   // 1.414...
  0xb9e0: [0x80, 0x80, 0x00, 0x00, 0x00],   // -0.5
  0xb9e5: [0x80, 0x31, 0x72, 0x17, 0xf8],   // 0.693...
  // EXP's: one over the logarithm of two, and its series (for POLY2) (LOGEB2, EXPCON)
  0xbfbf: [0x81, 0x38, 0xaa, 0x3b, 0x29],   // 1.442...
  0xbfc4: [0x07, 0x71, 0x34, 0x58, 0x3e, 0x56, 0x74, 0x16, 0x7e, 0xb3, 0x1b, 0x77, 0x2f, 0xee, 0xe3, 0x85, 0x7a, 0x1d, 0x84, 0x1c, 0x2a,
    0x7c, 0x63, 0x59, 0x58, 0x0a, 0x7e, 0x75, 0xfd, 0xe7, 0xc6, 0x80, 0x31, 0x72, 0x18, 0x10, 0x81, 0x00, 0x00, 0x00, 0x00],
  // FOUT's: the powers of ten its digits are counted out with, and TI$'s steps of the clock (hours
  // to seconds, in jiffies), each a 32-bit whole number, alternately subtracted and added (FOUTBL)
  0xbf16: words([-100000000, 10000000, -1000000, 100000, -10000, 1000, -100, 10, -1, -2160000, 216000, -36000, 3600, -600, 60]),
  // and the bounds it brings a number between, 99999999.9 and 999999999 (both rounded up a
  // little), and 1E9, a small number's first step up (NZ0999, NZ9999, NZMIL)
  0xbdb3: [0x9b, 0x3e, 0xbc, 0x1f, 0xfd],
  0xbdb8: [0x9e, 0x6e, 0x6b, 0x27, 0xfd],
  0xbdbd: [0x9e, 0x6e, 0x6b, 0x28, 0x00],
  // SIN's and COS's: a half pi, two pi, a quarter, and SIN's series (for POLY1) (PI2, TWOPI, FR4,
  // SINCON)
  0xe2e0: [0x81, 0x49, 0x0f, 0xda, 0xa2],   // 1.570...
  0xe2e5: [0x83, 0x49, 0x0f, 0xda, 0xa2],   // 6.283...
  0xe2ea: [0x7f, 0x00, 0x00, 0x00, 0x00],   // 0.25
  0xe2ef: [0x05, 0x84, 0xe6, 0x1a, 0x2d, 0x1b, 0x86, 0x28, 0x07, 0xfb, 0xf8, 0x87, 0x99, 0x68, 0x89, 0x01, 0x87, 0x23, 0x35, 0xdf, 0xe1,
    0x86, 0xa5, 0x5d, 0xe7, 0x28, 0x83, 0x49, 0x0f, 0xda, 0xa2],
};

// a number as the five bytes BASIC stores, from JavaScript's (for tests and for constants)
export function pack(x) {
  if (x === 0) return [0, 0, 0, 0, 0];
  const a = Math.abs(x);
  let ex = Math.floor(Math.log2(a)) + 1, f = a / 2 ** ex;
  if (f >= 1) { f /= 2; ex++; } else if (f < 0.5) { f *= 2; ex--; }
  let m = Math.round(f * 2 ** 32); if (m >= 2 ** 32) { m /= 2; ex++; }
  return [ex + 128, (m >>> 24 & 0x7f) | (x < 0 ? 0x80 : 0), m >>> 16 & 0xff, m >>> 8 & 0xff, m & 0xff];
}
// a number into the accumulator as BASIC holds it: $61 its exponent, $62 to $65 its mantissa,
// $66 its sign, its low bits ($70) 0
export function setFac(memory, x) {
  const b = pack(x);
  memory.write(0x70, 0);
  if (!b[0]) { for (let a = 0x61; a <= 0x66; a++) memory.write(a, 0); return; }
  memory.write(0x61, b[0]); memory.write(0x62, b[1] | 0x80); memory.write(0x63, b[2]); memory.write(0x64, b[3]); memory.write(0x65, b[4]); memory.write(0x66, x < 0 ? 0xff : 0);
}
// and back: the number five bytes hold
export function unpack(b) {
  if (!b[0]) return 0;
  const m = ((b[1] | 0x80) * 2 ** 24) + b[2] * 65536 + b[3] * 256 + b[4];
  return (b[1] & 0x80 ? -1 : 1) * m / 2 ** 32 * 2 ** (b[0] - 128);
}

export class Floats {
  constructor(memory) { this.mem = memory; }
  r(a) { return this.mem.read(a & 0xffff); }
  w(a, v) { this.mem.write(a & 0xffff, v & 0xff); }
  // a register's mantissa, four bytes from `at`, as a number, and back
  mant(at) { return ((this.r(at) * 256 + this.r(at + 1)) * 256 + this.r(at + 2)) * 256 + this.r(at + 3); }
  setMant(at, m) { this.w(at, m / 2 ** 24); this.w(at + 1, m / 65536); this.w(at + 2, m / 256); this.w(at + 3, m); }
  // (the FAC's value, for this module's own use and for tests)
  fac() { const e = this.r(FAC); return e ? (this.r(0x66) & 0x80 ? -1 : 1) * (this.mant(0x62) + this.r(FACOV) / 256) / 2 ** 32 * 2 ** (e - 128) : 0; }

  // ---- moving numbers ----

  // CONUPK ($BA8C): ARG from memory at A/Y; $6F the two signs' EOR; A the FAC's exponent
  conupk(at) {
    this.w(0x22, at); this.w(0x23, at >> 8);
    const b = [0, 1, 2, 3, 4].map(i => this.r(at + i));
    this.w(0x6d, b[4]); this.w(0x6c, b[3]); this.w(0x6b, b[2]); this.w(0x6e, b[1]);
    this.w(ARISGN, b[1] ^ this.r(0x66)); this.w(0x6a, b[1] | 0x80); this.w(ARG, b[0]);
    return { a: this.r(FAC), y: 0 };
  }
  // MOVFM ($BBA2): the FAC from memory at A/Y, its low bits 0; A its exponent
  movfm(at) {
    this.w(0x22, at); this.w(0x23, at >> 8);
    const b = [0, 1, 2, 3, 4].map(i => this.r(at + i));
    this.w(0x65, b[4]); this.w(0x64, b[3]); this.w(0x63, b[2]); this.w(0x66, b[1]); this.w(0x62, b[1] | 0x80); this.w(FAC, b[0]); this.w(FACOV, 0);
    return { a: b[0], y: 0 };
  }
  // MOVMF ($BBD4): the FAC, rounded, into memory at X/Y; its low bits 0 after
  movmf(at) {
    this.round();
    this.w(0x22, at); this.w(0x23, at >> 8);
    this.w(at + 4, this.r(0x65)); this.w(at + 3, this.r(0x64)); this.w(at + 2, this.r(0x63));
    this.w(at + 1, (this.r(0x66) | 0x7f) & this.r(0x62)); this.w(at, this.r(FAC)); this.w(FACOV, 0);
    return { a: this.r(FAC), y: 0 };
  }
  // MOVFA ($BBFC): the FAC from ARG; MOVAF ($BC0C): ARG from the FAC, rounded first
  movfa() { this.w(0x66, this.r(0x6e)); for (let i = 5; i >= 1; i--) this.w(0x60 + i, this.r(0x68 + i)); this.w(FACOV, 0); return { a: this.r(ARG), x: 0 }; }
  movaf() { this.round(); return this.movef(); }
  // ($BC0F, MOVAF after its ROUND: the FAC copied as it is)
  movef() { for (let i = 6; i >= 1; i--) this.w(0x68 + i, this.r(0x60 + i)); this.w(FACOV, 0); return { a: this.r(FAC), x: 0 }; }

  // ---- rounding, sign, comparing ----

  // ROUND ($BC1B): the low bits' top bit added in at the mantissa's foot; the low bits shifted
  // left, as the ROM leaves them; a carry out of the mantissa a power of two more
  round() {
    if (!this.r(FAC)) return;
    const ov = this.r(FACOV); this.w(FACOV, ov << 1);
    if (!(ov & 0x80)) return;
    const m = this.mant(0x62) + 1;
    if (m < 2 ** 32) { this.setMant(0x62, m); return; }
    this.setMant(0x62, 0);
    this.carryIn(1);
  }
  // ($B938) the exponent one more, and the mantissa and low bits shifted right with C in at the top
  carryIn(c) {
    const e = this.r(FAC) + 1; if (e > 255) throw overflow();
    this.w(FAC, e);
    const m = this.mant(0x62), ov = this.r(FACOV);
    this.setMant(0x62, Math.floor(m / 2) + (c ? 2 ** 31 : 0)); this.w(FACOV, (ov >> 1) | ((m & 1) << 7));
  }
  // SIGN ($BC2B): 0 for zero, 1 for positive, $FF for negative
  sign() { return !this.r(FAC) ? 0 : this.r(0x66) & 0x80 ? 0xff : 1; }
  // FCOMP ($BC5B, the address in A and Y; $BC5D with $24 set): the FAC against a number in memory,
  // 1 if the FAC is more, $FF if less, 0 if the same; the FAC's low bits, rounded, count only in
  // the mantissa's last byte, as the ROM's subtraction there borrows them
  fcomp(at) { return this.compare(at).a; }
  // (and Y as FCOMP leaves it: the byte it decided at, 1 for the exponent or the sign, 4 if equal)
  compare(at) {
    this.w(0x24, at); this.w(0x25, at >> 8);
    const ex = this.r(at);
    if (!ex) return { a: this.sign(), y: 1 };
    const b1 = this.r(at + 1), s = this.r(0x66);
    const memMore = (more, y) => { const neg = s & 0x80 ? 1 : 0; return { a: (more ? neg ^ 1 : neg) ? 0xff : 1, y }; };   // more: memory > FAC in size
    if ((b1 ^ s) & 0x80) return { a: s & 0x80 ? 0xff : 1, y: 1 };
    if (ex !== this.r(FAC)) return memMore(ex > this.r(FAC), 1);
    for (const [k, fac] of [[1, 0x62], [2, 0x63], [3, 0x64]]) {
      const mb = k === 1 ? b1 | 0x80 : this.r(at + k), fb = this.r(fac);
      if (mb !== fb) return memMore(mb > fb, k);
    }
    const borrow = this.r(FACOV) > 0x7f ? 1 : 0, d = this.r(at + 4) - this.r(0x65) - borrow;
    if ((d & 0xff) === 0) return { a: 0, y: 4 };
    return memMore(d >= 0, 4);
  }

  // ---- adding ----

  // FADD ($B867, the address in A and Y: memory plus the FAC; $B86A, ARG plus the FAC, A the
  // FAC's exponent): the result normalised, its low bits kept
  fadd(at) { this.conupk(at); return this.faddt(); }
  // FSUB ($B850): memory minus the FAC; FSUBT ($B853): ARG minus the FAC
  fsub(at) { this.conupk(at); return this.fsubt(); }
  fsubt() { this.w(0x66, this.r(0x66) ^ 0xff); this.w(ARISGN, this.r(0x66) ^ this.r(0x6e)); return this.faddt(); }
  faddt() {
    if (!this.r(FAC)) return this.movfa();
    this.w(ARGOV, this.r(FACOV));
    const ey = this.r(ARG);
    if (!ey) return { a: 0 };
    let d = (ey - this.r(FAC)) & 0xff, x = ARG, c = ey >= this.r(FAC) ? 1 : 0, a = 0;
    if (d !== 0) {
      if (c) {   // ARG the larger: the FAC takes its exponent and sign, and is the one shifted
        this.w(FAC, ey); this.w(0x66, this.r(0x6e));
        d = (~d + 1) & 0xff; this.w(ARGOV, 0); x = FAC;
      } else this.w(FACOV, 0);
      // (under a byte by the ROM's own signed test of A - $F9, $B897: bit by bit, the first
      // shifted plainly, the rest keeping the top bit, $B89B, which for a count the test misreads
      // is up to 255 bits; otherwise whole bytes first, $B862)
      a = ((d - 0xf9) & 0x80) ? this.shift(x, d, 0) : this.bitShift(x, d, this.r(FACOV), false);
    }
    if (this.r(ARISGN) & 0x80) {
      // the signs differ: the one not shifted less the one shifted, into the FAC
      const minus = x === ARG ? FAC : ARG;
      const low = this.r(ARGOV) - a, lowByte = low & 0xff, borrow = low < 0 ? 1 : 0;
      const m = this.mant(minus + 1) - this.mant(x + 1) - borrow;
      this.w(FACOV, lowByte); this.setMant(0x62, (m + 2 ** 32) % 2 ** 32);
      if (m < 0) this.negate();
      return this.normal();
    }
    // the same signs: the sum, a carry out a power of two more; with the exponents the same,
    // the carry their comparison left adds one more to the low bits ($B8FE)
    const low = a + this.r(ARGOV) + (d === 0 ? 1 : 0), m = this.mant(0x62) + this.mant(0x6a) + (low > 255 ? 1 : 0);
    this.w(FACOV, low); this.setMant(0x62, m % 2 ** 32);
    if (m >= 2 ** 32) this.carryIn(1);
    return { a: this.r(FAC) };
  }
  // the FAC's mantissa and low bits two's-complemented, its sign turned over ($B947); $B94D the
  // same without the sign
  negate() { this.w(0x66, this.r(0x66) ^ 0xff); this.complement(); }
  complement() {
    const ov = (~this.r(FACOV) & 0xff) + 1, m = 2 ** 32 - 1 - this.mant(0x62) + (ov > 255 ? 1 : 0);
    this.w(FACOV, ov); this.setMant(0x62, m % 2 ** 32);
  }
  // NORMAL ($B8D7): the mantissa shifted up until its top bit is 1, a byte at a time and then a
  // bit, the low bits coming in below it, and the exponent that much less; zero if it was zero,
  // or if the exponent would go under
  normal() {
    let n = 0;
    while (!this.r(0x62)) {
      this.w(0x62, this.r(0x63)); this.w(0x63, this.r(0x64)); this.w(0x64, this.r(0x65)); this.w(0x65, this.r(FACOV)); this.w(FACOV, 0);
      n += 8; if (n === 32) return this.zero();
    }
    while (!(this.r(0x62) & 0x80)) {
      const ov = this.r(FACOV), m = this.mant(0x62);
      this.w(FACOV, ov << 1); this.setMant(0x62, (m * 2 + (ov >> 7)) % 2 ** 32); n++;
    }
    if (n >= this.r(FAC)) return this.zero();
    this.w(FAC, this.r(FAC) - n);
    return { a: this.r(FAC) };
  }
  zero() { this.w(FAC, 0); this.w(0x66, 0); return { a: 0 }; }
  // The ROM's shift right of a register (X: $61 the FAC, $69 ARG, $25 the product) by -A bits,
  // A a negative count; its low bits are $70, or the A register (the return here) in a shift of
  // under a byte. Whole bytes first, each bringing $68 in at the top ($B985), as long as A + 8
  // (and the carry) stays under 1; then the bits, the top one kept, as for a signed number ($B9A6).
  shift(x, a, c = 0) {
    for (;;) {
      const sum = a + 8 + c; a = sum & 0xff; c = sum > 255 ? 1 : 0;
      if (a & 0x80 || !a) { this.byteShift(x); continue; }
      const diff = a - 8 - (1 - c); a = diff & 0xff; c = diff >= 0 ? 1 : 0;
      if (c) return this.r(FACOV);
      return this.bitShift(x, a, this.r(FACOV), true);
    }
  }
  byteShift(x) {
    this.w(FACOV, this.r(x + 4)); this.w(x + 4, this.r(x + 3)); this.w(x + 3, this.r(x + 2)); this.w(x + 2, this.r(x + 1)); this.w(x + 1, this.r(BITS));
  }
  // bits: Y counting up from -n, each a shift right of the register's four bytes and A below them,
  // the top byte's top bit kept (signed) or, for the first of an addition's, cleared
  bitShift(x, y, a, signed) {
    for (; y !== 0; y = (y + 1) & 0xff) {
      const top = this.r(x + 1), m = this.mant(x + 1);
      const keep = signed ? top & 0x80 : 0;
      this.setMant(x + 1, Math.floor(m / 2) + keep * 2 ** 24);
      a = (a >> 1) | ((m & 1) << 7);
      signed = true;
    }
    return a;
  }

  // ---- multiplying and dividing ----

  // FMULT ($BA28, memory times the FAC; $BA2B, ARG times the FAC): the mantissas multiplied a
  // byte of the FAC's at a time, its low bits first, the product's bits shifted out below lost
  fmult(at) { this.conupk(at); return this.fmultt(); }
  fmultt() {
    if (!this.r(FAC)) return { a: 0 };
    const md = this.muldiv();
    if (md.zero) return { a: 0 };
    for (const r of [0x26, 0x27, 0x28, 0x29]) this.w(r, 0);
    let c = md.c;
    for (const at of [FACOV, 0x65, 0x64, 0x63, 0x62]) c = this.mltply(this.r(at), c, at === 0x62);
    this.w(0x62, this.r(0x26)); this.w(0x63, this.r(0x27)); this.w(0x64, this.r(0x28)); this.w(0x65, this.r(0x29));
    return this.normal();
  }
  // one byte of the multiplier ($BA59): a zero byte a shift of the product by bytes; another, its
  // bits from the lowest, ARG's mantissa added in for each 1, the product shifted right each time
  mltply(b, c, last) {
    if (!b && !last) { this.byteShift(0x25); this.shift(0x25, 0, c); return 0; }
    for (let bits = (b >> 1) | 0x80, bit = b & 1; ; ) {
      let p = this.mant(0x26), carry = 0;
      if (bit) { p += this.mant(0x6a); carry = p >= 2 ** 32 ? 1 : 0; p %= 2 ** 32; }
      const ov = this.r(FACOV);
      this.w(FACOV, (ov >> 1) | ((p & 1) << 7)); this.setMant(0x26, Math.floor(p / 2) + carry * 2 ** 31);
      bit = bits & 1; bits >>= 1;
      if (!bits) return 1;
    }
  }
  // MULDIV ($BAB7; $BAB9 with A in place of ARG's exponent, `ey`): the exponents added for a product or quotient, and its sign. `zero` when ARG is
  // zero or the sum too small (the FAC zeroed, and the caller done); too large is an overflow. An
  // exponent of exactly 0 goes on, its sign 0, the caller working the mantissa out all the same.
  // `c` the carry it leaves, which a product begins with.
  muldiv(ey = this.r(ARG)) {
    if (!ey) { this.zero(); return { zero: true }; }
    const sum = ey + this.r(FAC), low = sum & 0xff;
    if (sum < 256 && low < 0x80) { this.zero(); return { zero: true }; }
    if (sum >= 256 && (low & 0x80)) throw overflow();
    const e = (low + 0x80) & 0xff, c = sum < 256 ? 1 : 0;
    this.w(FAC, e);
    this.w(0x66, e ? this.r(ARISGN) : 0);
    return { zero: false, c };
  }
  // FDIV ($BB0F, memory divided by the FAC; $BB12, ARG by the FAC): the FAC rounded first, then
  // 34 bits of quotient by subtracting, 32 as the mantissa and two as the low bits' top
  fdiv(at) { this.conupk(at); return this.fdivt(); }
  fdivt() {
    if (!this.r(FAC)) throw new FloatError(0x14);   // DIVISION BY ZERO
    this.round();
    this.w(FAC, (0 - this.r(FAC)) & 0xff);
    if (this.muldiv().zero) return { a: 0 };
    const e = this.r(FAC) + 1; if (e > 255) throw overflow();
    this.w(FAC, e);
    let a = this.mant(0x6a), carry = 0, q = 0;
    const f = this.mant(0x62);
    for (let i = 0; i < 34; i++) {
      const bit = carry || a >= f ? 1 : 0;
      if (bit) a = (a - f + 2 ** 32) % 2 ** 32;
      q = q * 2 + bit;
      carry = a >= 2 ** 31 ? 1 : 0; a = (a * 2) % 2 ** 32;
    }
    this.setMant(0x6a, a);
    this.w(FACOV, (q % 4) << 6); this.setMant(0x62, Math.floor(q / 4));
    return this.normal();
  }

  // ---- whole numbers ----

  // QINT ($BC9B): the FAC as a 32-bit whole number in $62 to $65, two's complement, its fraction
  // shifted out (so, for a negative, the next whole number down); $68 0 after
  qint() {
    if (!this.r(FAC)) { for (const r of [0x62, 0x63, 0x64, 0x65]) this.w(r, 0); return { a: 0, y: 0 }; }
    const a = (this.r(FAC) - 0xa0) & 0xff;
    if (this.r(0x66) & 0x80) { this.w(BITS, 0xff); this.complement(); }
    if (((a - 0xf9) & 0xff) & 0x80) this.shift(FAC, a, 0);
    else {
      // (under a byte: the first shift brings the sign in at the top, the rest keep it)
      const m = this.mant(0x62);
      this.setMant(0x62, Math.floor(m / 2) + ((this.r(0x66) & 0x80) ? 2 ** 31 : 0));
      this.bitShift(FAC, (a + 1) & 0xff, 0, true);
    }
    this.w(BITS, 0);
    return { y: 0 };
  }
  // INT ($BCCC): the FAC's whole part, the next whole number down, as a number again
  int() {
    if (this.r(FAC) >= 0xa0) return { a: this.r(FAC) };
    this.qint();
    this.w(FACOV, 0);
    const s = this.r(0x66); this.w(0x66, 0);
    return this.float32(s);
  }
  // ($BCDB) a 32-bit two's complement whole number in $62 to $65 as a number: negative when A's top
  // bit is set, as INT and Blitz! enter it; $07 its lowest byte, as the ROM keeps it
  float32(a) {
    this.w(FAC, 0xa0); this.w(0x07, this.r(0x65));
    if (a & 0x80) this.negate();
    return this.normal();
  }
}

// (the methods for building a number from its digits, FIN's: basic-rom.js)
Object.assign(Floats.prototype, {
  // MUL10 ($BAE2): the FAC ten times, as the ROM does it: ARG the FAC (rounded), then ($BAED) with
  // the exponent two more: five times it, doubled
  mul10() {
    this.movaf();
    const e = this.r(FAC);
    if (!e) return { a: 0 };
    if (e + 2 > 255) throw overflow();
    return this.addDoubled(e + 2);
  },
  // ($BAED) ARG added to the FAC with its exponent `a`, then doubled: FADDT entered at $B877 as if
  // ARG's exponent were `a` (one or two more than its own: ARG the FAC, it is three or five times
  // it), the FAC shifted right by the difference and ARG added, and the exponent one more
  addDoubled(a) {
    const by = (this.r(ARG) - a) & 0xff;
    this.w(ARISGN, 0);
    this.w(FAC, a); this.w(0x66, this.r(0x6e)); this.w(ARGOV, 0);
    const low = this.bitShift(FAC, by, this.r(FACOV), false) + this.r(ARGOV), m = this.mant(0x62) + this.mant(0x6a) + (low > 255 ? 1 : 0);
    this.w(FACOV, low); this.setMant(0x62, m % 2 ** 32);
    if (m >= 2 ** 32) this.carryIn(1);
    const e2 = this.r(FAC) + 1; if (e2 > 255) throw overflow();
    this.w(FAC, e2);
    return { a: e2 };
  },
  // DIV10 ($BAFE): the FAC a tenth: ARG the FAC (rounded), the FAC 10 (the ROM's constant at $BAF9),
  // the signs' EOR 0, and ARG divided by it
  div10() { this.movaf(); return this.divInto(0xbaf9, 0); },
  // ($BB07) ARG divided by a number in memory: the signs' EOR `sign` (X), the FAC the number, FDIVT
  divInto(at, sign) { this.w(ARISGN, sign); this.movfm(at); return this.fdivt(); },
  // ($BC3C) a byte, 0 to 127, as a number in the FAC (a digit, for FIN)
  byte(v) {
    this.w(0x62, v); this.w(0x63, 0);
    for (const at of [0x64, 0x65, FACOV, 0x66]) this.w(at, 0);
    this.w(FAC, 0x88);
    if (v & 0x80) this.negate();
    return this.normal();
  },
  // ($BD7E) a digit added to the FAC: ARG the FAC (rounded), the FAC the digit, and FADDT
  addDigit(d) { this.movaf(); this.byte(d); this.w(ARISGN, this.r(0x6e) ^ this.r(0x66)); return this.faddt(); },
  // ---- the series and the functions on them ----

  // POLY2 ($E059, the table's address in $71/$72): the FAC, x, kept at $5C (rounded), then from the
  // table's count and coefficients, highest first, x times each and the next added (Horner's)
  poly2(at) { this.w(0x71, at); this.w(0x72, at >> 8); return this.poly(); },
  poly() {
    this.movmf(0x5c);
    let p = this.r(0x71) | this.r(0x72) << 8;
    this.w(0x67, this.r(p)); p++; this.w(0x71, p); this.w(0x72, p >> 8);
    for (let from = p; ; from = 0x5c) {
      this.fmult(from);
      p = (this.r(0x71) | this.r(0x72) << 8) + 5; this.w(0x71, p); this.w(0x72, p >> 8);
      this.fadd(p);
      this.w(0x67, this.r(0x67) - 1); if (!this.r(0x67)) return { a: this.r(FAC) };
    }
  },
  // POLY1 ($E043): a series of x squared, x kept at $57, times x
  poly1(at) { this.w(0x71, at); this.w(0x72, at >> 8); this.movmf(0x57); this.fmult(0x57); this.poly(); return this.fmult(0x57); },
  // LOG ($B9EA): ILLEGAL QUANTITY for zero or less; the exponent kept, less 128 (SIGN's carry
  // clear), the mantissa as a number from a half to one, and log2 of that from LOG's series of
  // (sqrt 2 / (x + sqrt .5)), from 1; the exponent added (as $BD7E adds a digit), times log 2
  log() {
    if (this.sign() !== 1) throw new FloatError(0x0e);
    const n = (this.r(FAC) - 0x80) & 0xff;
    this.w(FAC, 0x80);
    this.fadd(0xb9d6); this.fdiv(0xb9db); this.fsub(0xb9bc); this.poly1(0xb9c1); this.fadd(0xb9e0);
    this.addDigit(n);
    return this.fmult(0xb9e5);
  },
  // EXP ($BFED, `c` the carry it is entered with): the FAC over log 2; its low bits rounded in, a
  // carry from $70 + $50 (and the carry FMULT leaves: clear for a product, as entered for a zero)
  // the mantissa one more; past 2^7 an overflow, or 0 for a negative; the whole part (INT, $07
  // its low byte) and the fraction, from the swapped FAC and ARG; EXP's series of the fraction, and
  // 2 to the whole part, by MULDIV with that exponent ($BAB9)
  exp(c = 0) {
    const ex = this.r(FAC);
    this.fmult(0xbfbf);
    if (ex && this.r(FAC)) c = 0;
    else if (ex) { const sum = 0x81 + ex; c = sum < 256 && (sum & 0xff) < 0x80 ? 0 : 1; }
    const s = this.r(FACOV) + 0x50 + c;
    if (s > 255) { const m = this.mant(0x62) + 1; this.setMant(0x62, m % 2 ** 32); if (m >= 2 ** 32) this.carryIn(1); }
    this.w(ARGOV, s);
    this.movef();
    const tooBig = () => { if (!(this.r(0x66) & 0x80)) throw overflow(); return this.zero(); };
    if (this.r(FAC) >= 0x88) return tooBig();
    this.int();
    const a = (this.r(0x07) + 0x81) & 0xff;
    if (!a) return tooBig();
    for (let k = 0; k < 6; k++) { const v = this.r(ARG + k); this.w(ARG + k, this.r(FAC + k)); this.w(FAC + k, v); }
    this.w(FACOV, this.r(ARGOV));
    this.fsubt(); this.negop();
    this.poly2(0xbfc4);
    this.w(ARISGN, 0);
    const e = (a - 1) & 0xff;
    if (!e) return this.zero();
    this.muldiv(e);
    return { a: 0 };
  },
  // FPWRT ($BF7B, ARG to the power of the FAC; `z` the Z flag it is entered with, set for a power
  // of 0, `c` the carry): EXP(0) for that; 0 for a base of 0; the power kept at $4E; a negative base
  // only to a whole power, its sign then dropped (as FCOMP's Y, 4, for the FAC's) and the power's
  // low bit kept (in $07): EXP of the power times LOG of the base, negated for an odd power. (A
  // power not whole is FCOMP's answer for the sign, its Y for the oddness: an ILLEGAL QUANTITY,
  // unless INT, from the ROM's fill byte $68, made the power more.)
  fpwrt(z, c) {
    if (z) return this.exp(c);
    if (!this.r(ARG)) { this.w(FAC, 0); this.w(0x66, 0); return { a: 0 }; }
    this.movmf(0x4e);
    let sign = this.r(0x6e), odd = 0;
    if (sign & 0x80) {
      this.int();
      const { a, y } = this.compare(0x4e);
      if (a) { sign = a; odd = y & 1; } else { sign = y; odd = this.r(0x07) & 1; }
    }
    this.w(0x66, sign); for (let i = 5; i >= 1; i--) this.w(0x60 + i, this.r(0x68 + i)); this.w(FACOV, 0);
    this.log(); this.fmult(0x4e);
    this.exp(0);
    if (odd && this.r(FAC)) this.w(0x66, this.r(0x66) ^ 0xff);
    return { a: this.r(FAC) };
  },
  // SIN ($E26B): the FAC over two pi; its fraction, from a quarter, and folded (a negative a half
  // on, and if then positive, the TAN's flag at $12 turned over), a quarter on, its sign back; and
  // SIN's series. COS ($E264): a half pi on, then SIN.
  sin() {
    this.movaf(); this.divInto(0xe2e5, this.r(0x6e));
    this.movaf(); this.int(); this.w(ARISGN, 0); this.fsubt(); this.fsub(0xe2ea);
    const s = this.r(0x66);
    if (!(s & 0x80)) this.negop();
    else { this.fadd(0xbf11); if (!(this.r(0x66) & 0x80)) { this.w(0x12, this.r(0x12) ^ 0xff); this.negop(); } }
    this.fadd(0xe2ea);
    if (s & 0x80) this.negop();
    return this.poly1(0xe2ef);
  },
  cos() { this.fadd(0xe2e0); return this.sin(); },
  // FOUT ($BDDD): the FAC as text at $0100, a zero after, as Microsoft's FOUT writes it (its
  // source's steps, BASIC-M6502): its sign or a space at $0100; the number brought
  // between 99999999.9 and 999999999 by tens, $5D counting them; a half added, as a whole number;
  // its nine digits counted out by adding the powers of ten, each in turn, the point placed among
  // them; the zeros at the end taken off, and the exponent ($5E) last. $71 where it writes, $47
  // where it is in the table. A and Y the text's address.
  fout() {
    const buf = (y, v) => this.w(0xff + y, v);
    let y = 1;
    buf(y, this.r(0x66) & 0x80 ? 0x2d : 0x20);
    this.w(0x66, this.r(0xff + y)); this.w(0x71, y); y++;
    if (!this.r(FAC)) { buf(y, 0x30); buf(y + 1, 0); return { a: 0x00, y: 0x01 }; }
    let a = 0;
    if (this.r(FAC) <= 0x80) { this.fmult(0xbdbd); a = 0xf7; }
    this.w(0x5d, a);
    // (between the bounds: smaller by tens, or bigger; the half not added when it is exactly the top)
    let step = 'FOUT4';
    for (;;) {
      if (step === 'FOUT4') {
        const c = this.fcomp(0xbdb8);
        if (c === 0) { step = 'BIGGES'; break; }
        step = c === 1 ? 'FOUT9' : 'FOUT3';
      } else if (step === 'FOUT3') {
        const c = this.fcomp(0xbdb3);
        if (c === 1) { step = 'FOUT5'; break; }
        this.mul10(); this.w(0x5d, (this.r(0x5d) - 1) & 0xff);
        step = this.r(0x5d) ? 'FOUT3' : 'FOUT9';
      } else {
        this.div10(); this.w(0x5d, (this.r(0x5d) + 1) & 0xff);
        if (this.r(0x5d)) step = 'FOUT4'; else { step = 'FOUT5'; break; }
      }
    }
    if (step === 'FOUT5') this.fadd(0xbf11);
    this.qint();
    // the form: E notation below 0.01 or from 1E9 ($5E the exponent), else the places before the point
    let x = 1, e;
    a = (this.r(0x5d) + 10) & 0xff;
    if (a & 0x80) e = a - 2;
    else if (a >= 11) e = a - 2;
    else { x = (a - 1) & 0xff; e = 0; }
    this.w(0x5e, e & 0xff); this.w(0x5d, x);
    if (x === 0 || x & 0x80) {
      y = this.r(0x71); y++; buf(y, 0x2e);
      if (x) { y++; buf(y, 0x30); }
      this.w(0x71, y);
    }
    // each digit: a power of ten added, or taken away, until the mantissa's sign turns
    y = 0; x = 0x80;
    for (;;) {
      let c = 0;
      for (const k of [3, 2, 1, 0]) { const v = this.r(0x62 + k) + this.r(0xbf16 + y + k) + c; this.w(0x62 + k, v & 0xff); c = v >> 8; }
      x = (x + 1) & 0xff;
      if (c ? x & 0x80 : !(x & 0x80)) continue;
      a = x;
      if (c) { const v = (a ^ 0xff) + 0x0a + 1; a = v & 0xff; c = v >> 8; }
      a = (a + 0x2f + c) & 0xff;
      y += 4; this.w(0x47, y);
      y = this.r(0x71) + 1; x = a;
      buf(y, a & 0x7f);
      this.w(0x5d, (this.r(0x5d) - 1) & 0xff);
      if (!this.r(0x5d)) { y++; buf(y, 0x2e); }
      this.w(0x71, y);
      y = this.r(0x47);
      x = (x ^ 0xff) & 0x80;
      if (y === 0x24 || y === 0x3c) break;
    }
    // the zeros at the end off, and a point left last; then the exponent
    y = this.r(0x71);
    let ch; do { ch = this.r(0xff + y); y--; } while (ch === 0x30);
    if (ch !== 0x2e) y++;
    let ex = this.r(0x5e);
    if (!ex) { buf(y + 1, 0); return { a: 0x00, y: 0x01 }; }
    let sign = 0x2b;
    if (ex & 0x80) { ex = (0 - ex) & 0xff; sign = 0x2d; }
    buf(y + 2, sign); buf(y + 1, 0x45);
    let hi = 0x2f, c = 1;
    do { hi++; const t = ex - 10 - (1 - c); c = t >= 0 ? 1 : 0; ex = t & 0xff; } while (c);
    buf(y + 4, (ex + 0x3a) & 0xff); buf(y + 3, hi); buf(y + 5, 0);
    return { a: 0x00, y: 0x01 };
  },
  // NEGOP ($BFB4): the FAC's sign turned over, unless it is zero
  negop() { if (this.r(FAC)) this.w(0x66, this.r(0x66) ^ 0xff); return { a: this.r(0x66) }; },
});

// an overflow, and BASIC's errors by their number in its table (X for its error routine, $A437)
export class FloatError extends Error { constructor(x) { super('BASIC error ' + x); this.x = x; } }
const overflow = () => new FloatError(0x0f);
