// A 6502, the documented instructions, running against a machine that gives it `read(address)`
// and `write(address, value)`. An NMOS chip, as the Commodore 64's 6510 is, also runs the
// undocumented instructions, NOPs and all, so `{ nmos: true }` adds them; the Apple's CPU is
// without them, since on the enhanced IIe's 65C02 the same opcodes are other instructions.
// `step()` runs one instruction and returns its cycles; `call(hook)` lets the machine take over
// an address: when the program counter reaches it, the hook runs in
// place of the code there and the CPU returns as if from a subroutine; a hook answering false
// lets the code run, and one answering 'wait' is run again on the next step.
export class CPU {
  // writeBack: a read-modify-write instruction writes the value it read back before the new one,
  // as the NMOS chip does on its spare cycle; on the C64 that first write is what acknowledges the
  // VIC-II's interrupt in DEC $D019 or ASL $D019, a demo's usual way (@moonbase/c64/machine.js)
  constructor(machine, { nmos = false, writeBack = false } = {}) {
    this.m = machine;
    this.nmos = nmos; this.writeBack = writeBack;
    this.a = 0; this.x = 0; this.y = 0; this.sp = 0xfd; this.pc = 0;
    this.n = 0; this.v = 0; this.d = 0; this.i = 1; this.z = 0; this.c = 0;
    this.hooks = new Map();
    this.cycles = 0;
  }
  get p() { return (this.n << 7) | (this.v << 6) | 0x20 | (this.d << 3) | (this.i << 2) | (this.z << 1) | this.c; }
  set p(v) { this.n = v >> 7 & 1; this.v = v >> 6 & 1; this.d = v >> 3 & 1; this.i = v >> 2 & 1; this.z = v >> 1 & 1; this.c = v & 1; }
  read(a) { return this.m.read(a & 0xffff); }
  write(a, v) { this.m.write(a & 0xffff, v & 0xff); }
  read16(a) { return this.read(a) | this.read(a + 1) << 8; }
  push(v) { this.write(0x100 | this.sp, v); this.sp = (this.sp - 1) & 0xff; }
  pull() { this.sp = (this.sp + 1) & 0xff; return this.read(0x100 | this.sp); }
  nz(v) { v &= 0xff; this.n = v >> 7; this.z = v === 0 ? 1 : 0; return v; }
  branch(cond) { const off = this.read(this.pc++); if (cond) { const t = (this.pc + (off < 128 ? off : off - 256)) & 0xffff; this.cycles += ((t ^ this.pc) & 0xff00) ? 2 : 1; this.pc = t; } }
  // addressing modes return an address
  imm() { return this.pc++; }
  zp() { return this.read(this.pc++); }
  zpx() { return (this.read(this.pc++) + this.x) & 0xff; }
  zpy() { return (this.read(this.pc++) + this.y) & 0xff; }
  abs() { const a = this.read16(this.pc); this.pc += 2; return a; }
  abx(penalty) { const a = this.abs(); if (penalty && ((a + this.x) ^ a) & 0xff00) this.cycles++; return (a + this.x) & 0xffff; }
  aby(penalty) { const a = this.abs(); if (penalty && ((a + this.y) ^ a) & 0xff00) this.cycles++; return (a + this.y) & 0xffff; }
  izx() { const z = (this.read(this.pc++) + this.x) & 0xff; return this.read(z) | this.read((z + 1) & 0xff) << 8; }
  izy(penalty) { const z = this.read(this.pc++); const a = this.read(z) | this.read((z + 1) & 0xff) << 8; if (penalty && ((a + this.y) ^ a) & 0xff00) this.cycles++; return (a + this.y) & 0xffff; }
  // operations
  // Decimal mode: on the NMOS chip (the 6510), as the chip itself does it (perfect6502): a digit
  // over 9 has 6 added and carries, and a result over $9F has $60 added, which is the same as
  // adding the digits for a number in decimal and not otherwise; N and V from the sum before that
  // last step, Z from the binary sum. SBC's flags are all the binary subtraction's.
  adc(v) {
    if (this.d && this.nmos) {
      const a = this.a; let lo = (a & 15) + (v & 15) + this.c;
      if (lo >= 10) lo = ((lo + 6) & 15) + 16;
      let s = (a & 0xf0) + (v & 0xf0) + lo;
      this.z = ((a + v + this.c) & 0xff) === 0 ? 1 : 0; this.n = s >> 7 & 1; this.v = ((~(a ^ v) & (a ^ s)) & 0x80) ? 1 : 0;
      if (s >= 0xa0) s += 0x60;
      this.c = s >= 0x100 ? 1 : 0; this.a = s & 0xff; return;
    }
    if (this.d) {
      let lo = (this.a & 15) + (v & 15) + this.c, hi = (this.a >> 4) + (v >> 4);
      if (lo > 9) { lo -= 10; hi++; }
      const r = (this.a + v + this.c) & 0xff; this.z = r === 0 ? 1 : 0;
      this.n = (hi & 8) ? 1 : 0; this.v = ((~(this.a ^ v) & (this.a ^ (hi << 4))) & 0x80) ? 1 : 0;
      if (hi > 9) hi -= 10, this.c = 1; else this.c = 0;
      this.a = ((hi << 4) | lo) & 0xff; return;
    }
    const r = this.a + v + this.c;
    this.v = ((~(this.a ^ v) & (this.a ^ r)) & 0x80) ? 1 : 0; this.c = r > 0xff ? 1 : 0; this.a = this.nz(r);
  }
  sbc(v) {
    if (this.d && this.nmos) {
      const a = this.a, r = a - v - (1 - this.c); let lo = (a & 15) - (v & 15) - (1 - this.c);
      if (lo < 0) lo = ((lo - 6) & 15) - 16;
      let s = (a & 0xf0) - (v & 0xf0) + lo;
      if (s < 0) s -= 0x60;
      this.z = (r & 0xff) === 0 ? 1 : 0; this.n = (r & 0x80) ? 1 : 0; this.v = (((a ^ v) & (a ^ r)) & 0x80) ? 1 : 0; this.c = r >= 0 ? 1 : 0;
      this.a = s & 0xff; return;
    }
    if (this.d) {
      let lo = (this.a & 15) - (v & 15) - (1 - this.c), hi = (this.a >> 4) - (v >> 4);
      if (lo < 0) { lo += 10; hi--; }
      const r = this.a - v - (1 - this.c); this.z = (r & 0xff) === 0 ? 1 : 0; this.n = (r & 0x80) ? 1 : 0;
      this.v = (((this.a ^ v) & (this.a ^ r)) & 0x80) ? 1 : 0; this.c = r >= 0 ? 1 : 0;
      if (hi < 0) hi += 10;
      this.a = ((hi << 4) | lo) & 0xff; return;
    }
    const r = this.a - v - (1 - this.c);
    this.v = (((this.a ^ v) & (this.a ^ r)) & 0x80) ? 1 : 0; this.c = r >= 0 ? 1 : 0; this.a = this.nz(r);
  }
  cmp(r, v) { const d = r - v; this.c = d >= 0 ? 1 : 0; this.nz(d); }
  // a read-modify-write's read, and its value written back first where the chip does (writeBack)
  modify(a) { const v = this.read(a); if (this.writeBack) this.write(a, v); return v; }
  asl(a) { const v = a === null ? this.a : this.modify(a); this.c = v >> 7; const r = this.nz(v << 1); if (a === null) this.a = r; else this.write(a, r); }
  lsr(a) { const v = a === null ? this.a : this.modify(a); this.c = v & 1; const r = this.nz(v >> 1); if (a === null) this.a = r; else this.write(a, r); }
  rol(a) { const v = a === null ? this.a : this.modify(a); const r = this.nz((v << 1) | this.c); this.c = v >> 7; if (a === null) this.a = r; else this.write(a, r); }
  ror(a) { const v = a === null ? this.a : this.modify(a); const r = this.nz((v >> 1) | (this.c << 7)); this.c = v & 1; if (a === null) this.a = r; else this.write(a, r); }
  inc(a) { this.write(a, this.nz(this.modify(a) + 1)); }
  dec(a) { this.write(a, this.nz(this.modify(a) - 1)); }
  bit(v) { this.n = v >> 7; this.v = v >> 6 & 1; this.z = (this.a & v) === 0 ? 1 : 0; }

  // an interrupt request, taken when interrupts are not masked: the return address and the
  // flags go on the stack and the vector at $FFFE is followed; a non-maskable one goes by $FFFA
  irq() { if (this.i) return false; this.push(this.pc >> 8); this.push(this.pc & 0xff); this.push(this.p & 0xef); this.i = 1; this.pc = this.read16(0xfffe); this.cycles += 7; return true; }
  nmi() { this.push(this.pc >> 8); this.push(this.pc & 0xff); this.push(this.p & 0xef); this.i = 1; this.pc = this.read16(0xfffa); this.cycles += 7; }

  step() {
    // (a hook that goes on elsewhere, setting the PC and returning false, has that place's hook
    // run too: a routine of a ROM in JavaScript jumping on to another, @moonbase/c64/rom.js)
    for (let hook = this.hooks.get(this.pc), guard = 0; hook && guard < 8; hook = this.hooks.get(this.pc), guard++) {
      const at = this.pc, r = hook(this);
      if (r === 'wait') { this.cycles += 10; return 10; }
      if (r !== false) { this.pc = (this.pull() | this.pull() << 8) + 1 & 0xffff; this.cycles += 6; return 6; }
      if (this.pc === at) break;
    }
    const start = this.cycles;
    this.trace?.(this.pc);   // every instruction run, for a tool that wants them (code coverage)
    const op = this.read(this.pc++);
    this.cycles += CYCLES[op];
    switch (op) {
      case 0x00: this.pc++; this.push(this.pc >> 8); this.push(this.pc & 0xff); this.push(this.p | 0x10); this.i = 1; this.pc = this.read16(0xfffe); break;
      case 0x01: this.a = this.nz(this.a | this.read(this.izx())); break;
      case 0x05: this.a = this.nz(this.a | this.read(this.zp())); break;
      case 0x06: this.asl(this.zp()); break;
      case 0x08: this.push(this.p | 0x10); break;
      case 0x09: this.a = this.nz(this.a | this.read(this.imm())); break;
      case 0x0a: this.asl(null); break;
      case 0x0d: this.a = this.nz(this.a | this.read(this.abs())); break;
      case 0x0e: this.asl(this.abs()); break;
      case 0x10: this.branch(!this.n); break;
      case 0x11: this.a = this.nz(this.a | this.read(this.izy(1))); break;
      case 0x15: this.a = this.nz(this.a | this.read(this.zpx())); break;
      case 0x16: this.asl(this.zpx()); break;
      case 0x18: this.c = 0; break;
      case 0x19: this.a = this.nz(this.a | this.read(this.aby(1))); break;
      case 0x1d: this.a = this.nz(this.a | this.read(this.abx(1))); break;
      case 0x1e: this.asl(this.abx()); break;
      case 0x20: { const a = this.abs(); this.pc--; this.push(this.pc >> 8); this.push(this.pc & 0xff); this.pc = a; break; }
      case 0x21: this.a = this.nz(this.a & this.read(this.izx())); break;
      case 0x24: this.bit(this.read(this.zp())); break;
      case 0x25: this.a = this.nz(this.a & this.read(this.zp())); break;
      case 0x26: this.rol(this.zp()); break;
      case 0x28: this.p = this.pull(); break;
      case 0x29: this.a = this.nz(this.a & this.read(this.imm())); break;
      case 0x2a: this.rol(null); break;
      case 0x2c: this.bit(this.read(this.abs())); break;
      case 0x2d: this.a = this.nz(this.a & this.read(this.abs())); break;
      case 0x2e: this.rol(this.abs()); break;
      case 0x30: this.branch(this.n); break;
      case 0x31: this.a = this.nz(this.a & this.read(this.izy(1))); break;
      case 0x35: this.a = this.nz(this.a & this.read(this.zpx())); break;
      case 0x36: this.rol(this.zpx()); break;
      case 0x38: this.c = 1; break;
      case 0x39: this.a = this.nz(this.a & this.read(this.aby(1))); break;
      case 0x3d: this.a = this.nz(this.a & this.read(this.abx(1))); break;
      case 0x3e: this.rol(this.abx()); break;
      case 0x40: this.p = this.pull(); this.pc = this.pull() | this.pull() << 8; break;
      case 0x41: this.a = this.nz(this.a ^ this.read(this.izx())); break;
      case 0x45: this.a = this.nz(this.a ^ this.read(this.zp())); break;
      case 0x46: this.lsr(this.zp()); break;
      case 0x48: this.push(this.a); break;
      case 0x49: this.a = this.nz(this.a ^ this.read(this.imm())); break;
      case 0x4a: this.lsr(null); break;
      case 0x4c: this.pc = this.abs(); break;
      case 0x4d: this.a = this.nz(this.a ^ this.read(this.abs())); break;
      case 0x4e: this.lsr(this.abs()); break;
      case 0x50: this.branch(!this.v); break;
      case 0x51: this.a = this.nz(this.a ^ this.read(this.izy(1))); break;
      case 0x55: this.a = this.nz(this.a ^ this.read(this.zpx())); break;
      case 0x56: this.lsr(this.zpx()); break;
      case 0x58: this.i = 0; break;
      case 0x59: this.a = this.nz(this.a ^ this.read(this.aby(1))); break;
      case 0x5d: this.a = this.nz(this.a ^ this.read(this.abx(1))); break;
      case 0x5e: this.lsr(this.abx()); break;
      case 0x60: this.pc = (this.pull() | this.pull() << 8) + 1 & 0xffff; break;
      case 0x61: this.adc(this.read(this.izx())); break;
      case 0x65: this.adc(this.read(this.zp())); break;
      case 0x66: this.ror(this.zp()); break;
      case 0x68: this.a = this.nz(this.pull()); break;
      case 0x69: this.adc(this.read(this.imm())); break;
      case 0x6a: this.ror(null); break;
      case 0x6c: { const a = this.abs(); this.pc = this.read(a) | this.read((a & 0xff00) | ((a + 1) & 0xff)) << 8; break; }
      case 0x6d: this.adc(this.read(this.abs())); break;
      case 0x6e: this.ror(this.abs()); break;
      case 0x70: this.branch(this.v); break;
      case 0x71: this.adc(this.read(this.izy(1))); break;
      case 0x75: this.adc(this.read(this.zpx())); break;
      case 0x76: this.ror(this.zpx()); break;
      case 0x78: this.i = 1; break;
      case 0x79: this.adc(this.read(this.aby(1))); break;
      case 0x7d: this.adc(this.read(this.abx(1))); break;
      case 0x7e: this.ror(this.abx()); break;
      case 0x81: this.write(this.izx(), this.a); break;
      case 0x84: this.write(this.zp(), this.y); break;
      case 0x85: this.write(this.zp(), this.a); break;
      case 0x86: this.write(this.zp(), this.x); break;
      case 0x88: this.y = this.nz(this.y - 1); break;
      case 0x8a: this.a = this.nz(this.x); break;
      case 0x8c: this.write(this.abs(), this.y); break;
      case 0x8d: this.write(this.abs(), this.a); break;
      case 0x8e: this.write(this.abs(), this.x); break;
      case 0x90: this.branch(!this.c); break;
      case 0x91: this.write(this.izy(), this.a); break;
      case 0x94: this.write(this.zpx(), this.y); break;
      case 0x95: this.write(this.zpx(), this.a); break;
      case 0x96: this.write(this.zpy(), this.x); break;
      case 0x98: this.a = this.nz(this.y); break;
      case 0x99: this.write(this.aby(), this.a); break;
      case 0x9a: this.sp = this.x; break;
      case 0x9d: this.write(this.abx(), this.a); break;
      case 0xa0: this.y = this.nz(this.read(this.imm())); break;
      case 0xa1: this.a = this.nz(this.read(this.izx())); break;
      case 0xa2: this.x = this.nz(this.read(this.imm())); break;
      case 0xa4: this.y = this.nz(this.read(this.zp())); break;
      case 0xa5: this.a = this.nz(this.read(this.zp())); break;
      case 0xa6: this.x = this.nz(this.read(this.zp())); break;
      case 0xa8: this.y = this.nz(this.a); break;
      case 0xa9: this.a = this.nz(this.read(this.imm())); break;
      case 0xaa: this.x = this.nz(this.a); break;
      case 0xac: this.y = this.nz(this.read(this.abs())); break;
      case 0xad: this.a = this.nz(this.read(this.abs())); break;
      case 0xae: this.x = this.nz(this.read(this.abs())); break;
      case 0xb0: this.branch(this.c); break;
      case 0xb1: this.a = this.nz(this.read(this.izy(1))); break;
      case 0xb4: this.y = this.nz(this.read(this.zpx())); break;
      case 0xb5: this.a = this.nz(this.read(this.zpx())); break;
      case 0xb6: this.x = this.nz(this.read(this.zpy())); break;
      case 0xb8: this.v = 0; break;
      case 0xb9: this.a = this.nz(this.read(this.aby(1))); break;
      case 0xba: this.x = this.nz(this.sp); break;
      case 0xbc: this.y = this.nz(this.read(this.abx(1))); break;
      case 0xbd: this.a = this.nz(this.read(this.abx(1))); break;
      case 0xbe: this.x = this.nz(this.read(this.aby(1))); break;
      case 0xc0: this.cmp(this.y, this.read(this.imm())); break;
      case 0xc1: this.cmp(this.a, this.read(this.izx())); break;
      case 0xc4: this.cmp(this.y, this.read(this.zp())); break;
      case 0xc5: this.cmp(this.a, this.read(this.zp())); break;
      case 0xc6: this.dec(this.zp()); break;
      case 0xc8: this.y = this.nz(this.y + 1); break;
      case 0xc9: this.cmp(this.a, this.read(this.imm())); break;
      case 0xca: this.x = this.nz(this.x - 1); break;
      case 0xcc: this.cmp(this.y, this.read(this.abs())); break;
      case 0xcd: this.cmp(this.a, this.read(this.abs())); break;
      case 0xce: this.dec(this.abs()); break;
      case 0xd0: this.branch(!this.z); break;
      case 0xd1: this.cmp(this.a, this.read(this.izy(1))); break;
      case 0xd5: this.cmp(this.a, this.read(this.zpx())); break;
      case 0xd6: this.dec(this.zpx()); break;
      case 0xd8: this.d = 0; break;
      case 0xd9: this.cmp(this.a, this.read(this.aby(1))); break;
      case 0xdd: this.cmp(this.a, this.read(this.abx(1))); break;
      case 0xde: this.dec(this.abx()); break;
      case 0xe0: this.cmp(this.x, this.read(this.imm())); break;
      case 0xe1: this.sbc(this.read(this.izx())); break;
      case 0xe4: this.cmp(this.x, this.read(this.zp())); break;
      case 0xe5: this.sbc(this.read(this.zp())); break;
      case 0xe6: this.inc(this.zp()); break;
      case 0xe8: this.x = this.nz(this.x + 1); break;
      case 0xe9: this.sbc(this.read(this.imm())); break;
      case 0xea: break;
      case 0xec: this.cmp(this.x, this.read(this.abs())); break;
      case 0xed: this.sbc(this.read(this.abs())); break;
      case 0xee: this.inc(this.abs()); break;
      case 0xf0: this.branch(this.z); break;
      case 0xf1: this.sbc(this.read(this.izy(1))); break;
      case 0xf5: this.sbc(this.read(this.zpx())); break;
      case 0xf6: this.inc(this.zpx()); break;
      case 0xf8: this.d = 1; break;
      case 0xf9: this.sbc(this.read(this.aby(1))); break;
      case 0xfd: this.sbc(this.read(this.abx(1))); break;
      case 0xfe: this.inc(this.abx()); break;
      default: {
        if (this.nmos && UNDOCUMENTED.has(op)) { this.undocumented(op); break; }
        const nop = this.nmos && NOPS.get(op);
        if (!nop) throw new Error('undocumented opcode $' + op.toString(16) + ' at $' + (this.pc - 1).toString(16));
        this.cycles += nop[1];
        if (nop[0]) this.read(this[nop[0]](1));   // the operand is fetched and read, as the chip does
      }
    }
    return this.cycles - start;
  }
  // The NMOS chip's undocumented instructions, as the chip itself runs them (perfect6502): two
  // operations in one, on an operand found the usual ways (UNDOCUMENTED, below).
  undocumented(op) {
    const [name, mode, cycles, penalty] = UNDOCUMENTED.get(op);
    this.cycles += cycles;
    if (name === 'JAM') throw new Error('the processor halts (JAM, $' + op.toString(16) + ') at $' + (this.pc - 1).toString(16));
    // SHA, SHX, SHY, TAS: the register stored ANDed with the high byte of the address before
    // indexing, plus one; and where indexing crosses a page, that value is the high byte stored to
    if (name === 'SHA' || name === 'SHX' || name === 'SHY' || name === 'TAS') {
      let base, index;
      if (mode === 'izy') { const z = this.read(this.pc++); base = this.read(z) | this.read((z + 1) & 0xff) << 8; index = this.y; }
      else { base = this.read16(this.pc); this.pc += 2; index = mode === 'abx' ? this.x : this.y; }
      if (name === 'TAS') this.sp = this.a & this.x;
      const reg = name === 'SHA' ? this.a & this.x : name === 'SHX' ? this.x : name === 'SHY' ? this.y : this.sp;
      const v = reg & ((base >> 8) + 1 & 0xff); let at = (base + index) & 0xffff;
      if ((base ^ at) & 0xff00) at = v << 8 | (at & 0xff);
      this.write(at, v); return;
    }
    const at = mode === 'imm' ? this.imm() : this[mode](penalty);
    const v = ['SLO', 'RLA', 'SRE', 'RRA', 'DCP', 'ISC'].includes(name) ? this.modify(at) : this.read(at);
    switch (name) {
      case 'SLO': { this.c = v >> 7; const r = v << 1 & 0xff; this.write(at, r); this.a = this.nz(this.a | r); break; }
      case 'RLA': { const r = (v << 1 | this.c) & 0xff; this.c = v >> 7; this.write(at, r); this.a = this.nz(this.a & r); break; }
      case 'SRE': { this.c = v & 1; const r = v >> 1; this.write(at, r); this.a = this.nz(this.a ^ r); break; }
      case 'RRA': { const r = v >> 1 | this.c << 7; this.c = v & 1; this.write(at, r); this.adc(r); break; }
      case 'SAX': this.write(at, this.a & this.x); break;
      case 'LAX': this.a = this.x = this.nz(v); break;
      case 'DCP': { const r = v - 1 & 0xff; this.write(at, r); this.cmp(this.a, r); break; }
      case 'ISC': { const r = v + 1 & 0xff; this.write(at, r); this.sbc(r); break; }
      case 'ANC': this.a = this.nz(this.a & v); this.c = this.n; break;
      case 'ALR': { const t = this.a & v; this.c = t & 1; this.a = this.nz(t >> 1); break; }
      case 'ARR': {
        const t = this.a & v; let r = t >> 1 | this.c << 7;
        if (!this.d) { this.a = this.nz(r); this.c = r >> 6 & 1; this.v = (r >> 6 ^ r >> 5) & 1; break; }
        // in decimal mode: N from the old carry, Z and V from the rotate, then each digit adjusted
        this.n = this.c; this.z = r === 0 ? 1 : 0; this.v = ((t ^ r) & 0x40) ? 1 : 0;
        if ((t & 0x0f) + (t & 0x01) > 5) r = (r & 0xf0) | ((r + 6) & 0x0f);
        if ((t & 0xf0) + (t & 0x10) > 0x50) { r = (r + 0x60) & 0xff; this.c = 1; } else this.c = 0;
        this.a = r; break;
      }
      case 'SBX': { const d = (this.a & this.x) - v; this.c = d >= 0 ? 1 : 0; this.x = this.nz(d); break; }
      case 'SBC': this.sbc(v); break;
      case 'ANE': this.a = this.nz((this.a | ANE_MAGIC) & this.x & v); break;
      case 'LXA': this.a = this.x = this.nz((this.a | ANE_MAGIC) & v); break;
      case 'LAS': this.a = this.x = this.sp = this.nz(v & this.sp); break;
    }
  }
}

// The undocumented instructions an NMOS 6502 runs, by opcode: the operation, how the operand is
// found, the cycles, and whether an indexed read crossing a page takes one more. ANE and LXA mix in
// a constant that differs from chip to chip; ANE_MAGIC is perfect6502's.
const ANE_MAGIC = 0xee;
const UNDOCUMENTED = new Map([
  ...[['SLO', 0x03], ['RLA', 0x23], ['SRE', 0x43], ['RRA', 0x63], ['DCP', 0xc3], ['ISC', 0xe3]].flatMap(([n, b]) =>
    [[b, [n, 'izx', 8]], [b + 4, [n, 'zp', 5]], [b + 0xc, [n, 'abs', 6]], [b + 0x10, [n, 'izy', 8]], [b + 0x14, [n, 'zpx', 6]], [b + 0x18, [n, 'aby', 7]], [b + 0x1c, [n, 'abx', 7]]]),
  [0x83, ['SAX', 'izx', 6]], [0x87, ['SAX', 'zp', 3]], [0x8f, ['SAX', 'abs', 4]], [0x97, ['SAX', 'zpy', 4]],
  [0xa3, ['LAX', 'izx', 6]], [0xa7, ['LAX', 'zp', 3]], [0xaf, ['LAX', 'abs', 4]], [0xb3, ['LAX', 'izy', 5, 1]], [0xb7, ['LAX', 'zpy', 4]], [0xbf, ['LAX', 'aby', 4, 1]],
  [0x0b, ['ANC', 'imm', 2]], [0x2b, ['ANC', 'imm', 2]], [0x4b, ['ALR', 'imm', 2]], [0x6b, ['ARR', 'imm', 2]], [0xcb, ['SBX', 'imm', 2]], [0xeb, ['SBC', 'imm', 2]],
  [0x8b, ['ANE', 'imm', 2]], [0xab, ['LXA', 'imm', 2]],
  [0x93, ['SHA', 'izy', 6]], [0x9f, ['SHA', 'aby', 5]], [0x9e, ['SHX', 'aby', 5]], [0x9c, ['SHY', 'abx', 5]], [0x9b, ['TAS', 'aby', 5]], [0xbb, ['LAS', 'aby', 4, 1]],
  ...[0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2].map(op => [op, ['JAM', null, 0]]),
]);

// base cycles for each opcode, 00 to FF
// the undocumented NOPs an NMOS 6502 runs: by opcode, how the operand is found and the cycles, with
// one more for an absolute indexed one that crosses a page
const NOPS = new Map([
  ...[0x1a, 0x3a, 0x5a, 0x7a, 0xda, 0xfa].map(op => [op, [null, 2]]),
  ...[0x80, 0x82, 0x89, 0xc2, 0xe2].map(op => [op, ['imm', 2]]),
  ...[0x04, 0x44, 0x64].map(op => [op, ['zp', 3]]),
  ...[0x14, 0x34, 0x54, 0x74, 0xd4, 0xf4].map(op => [op, ['zpx', 4]]),
  [0x0c, ['abs', 4]],
  ...[0x1c, 0x3c, 0x5c, 0x7c, 0xdc, 0xfc].map(op => [op, ['abx', 4]]),
]);

export const CYCLES = [
  7, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 0, 4, 6, 0, 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  6, 6, 0, 0, 3, 3, 5, 0, 4, 2, 2, 0, 4, 4, 6, 0, 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  6, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 3, 4, 6, 0, 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  6, 6, 0, 0, 0, 3, 5, 0, 4, 2, 2, 0, 5, 4, 6, 0, 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  0, 6, 0, 0, 3, 3, 3, 0, 2, 0, 2, 0, 4, 4, 4, 0, 2, 6, 0, 0, 4, 4, 4, 0, 2, 5, 2, 0, 0, 5, 0, 0,
  2, 6, 2, 0, 3, 3, 3, 0, 2, 2, 2, 0, 4, 4, 4, 0, 2, 5, 0, 0, 4, 4, 4, 0, 2, 4, 2, 0, 4, 4, 4, 0,
  2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0, 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
  2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0, 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0];
