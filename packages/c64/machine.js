// A Commodore 64, as far as the games use it: 64K of RAM with the KERNAL, BASIC and character
// ROMs banked over it by the 6510's port, the VIC-II's text and bitmap modes and sprites drawn
// a raster line at a time, its raster interrupt, the two CIAs' timers and the keyboard and
// joystick through the first, the SID's registers, and the 1541 in drive.js, answered when the
// KERNAL is asked to load or save and at the KERNAL's serial bus routines, so that the games'
// own talking to the drive works too. PAL: 312 lines of 63 cycles, 985,248 cycles a second.
import { CPU } from '@moonbase-machines/mos6502/cpu.js';
import { VIC } from './vic.js';
import { Drive } from './drive.js';
import { Printer, bus } from './printer.js';
import { install as standIn } from './rom.js';

const LINES = 312, CYCLES_PER_LINE = 63, DISPLAY_START = 15;   // (the cycle of a line its first character is fetched at)

export class C64 {
  constructor(game, roms, { log = () => {}, printer = new Printer({ on: false }) } = {}) {
    this.game = game; this.log = log;
    this.ram = new Uint8Array(0x10000);
    this.kernal = roms.kernal; this.basic = roms.basic; this.chargen = roms.chargen;
    this.color = new Uint8Array(0x400);
    this.port = 0x37; this.portDir = 0x2f;
    this.cia1 = new CIA(); this.cia2 = new CIA();
    this.sid = new Uint8Array(0x20); this.sidWrites = [];   // [cycle, register, value] since the last frame
    this.vic = new VIC(this);
    this.keys = new Uint8Array(8);   // the keyboard matrix, a bit a key, set while held
    this.joystick = 0;   // port 2: up 1, down 2, left 4, right 8, fire 16
    this.drive = new Drive(Uint8Array.from(atob(game.image), c => c.charCodeAt(0)));
    this.printer = printer;   // device 4, on the bus if switched on (printer.js)
    this.halted = false; this.frame = 0; this.line = 0;
    this.cpu = new CPU(this, { nmos: true, writeBack: true });   // the 6510 is an NMOS 6502, undocumented NOPs and all, and its read-modify-writes write twice
    // the KERNAL's LOAD, once the name and device are set, and its SAVE; on Commodore's ROMs with
    // their vectors ($0330, $0332) as the KERNAL sets them, its own code instead, on the bus
    // below: its messages (SEARCHING FOR, LOADING, VERIFYING, SAVING) and VERIFY as it does them.
    // A game's own loader at the vector (Zoopak's) is answered here.
    const own = (vector, at) => !roms.standIn && this.read16(vector) === at;
    this.cpu.hooks.set(0xf49e, () => own(0x330, 0xf4a5) ? false : this.load());
    this.cpu.hooks.set(0xf5dd, () => own(0x332, 0xf5ed) ? false : this.save());
    // the serial bus, at the routines the KERNAL's jump table leads to; the status at $90 says
    // whether the device answered, and bit 6 marks the last byte of a file
    const d = this.bus = bus(this.drive, this.printer), st = this.ram;
    // (a device not there adds DEVICE NOT PRESENT to the status, as the KERNAL's $FE1C does; one
    // that answers leaves it as it was: a VERIFY's mismatch, bit 4, kept through the CLOSE after)
    this.cpu.hooks.set(0xed0c, c => { if (!d.listen(c.a)) st[0x90] |= 0x80; return true; });
    this.cpu.hooks.set(0xed09, c => { if (!d.talk(c.a)) st[0x90] |= 0x80; return true; });
    this.cpu.hooks.set(0xedb9, c => { d.second(c.a); return true; });
    this.cpu.hooks.set(0xedc7, c => { d.tksa(c.a); return true; });
    // (CIOUT ends CLC, as Commodore's does: BASIC's CHROUT, $E10C, takes a carry set as an error)
    this.cpu.hooks.set(0xeddd, c => { d.ciout(c.a); c.c = 0; return true; });
    this.cpu.hooks.set(0xedfe, () => { d.unlsn(); return true; });
    this.cpu.hooks.set(0xedef, () => { d.untlk(); return true; });
    this.cpu.hooks.set(0xee13, c => { const r = d.acptr(); if (r) { c.a = r.byte; if (r.eoi) st[0x90] |= 0x40; } else { c.a = 0x0d; st[0x90] |= 0x42; } c.c = 0; return true; });
    // Commodore's ROMs, or moonbase's in their place (rom.js)
    if (roms.standIn) standIn(this);
    this.reset();
  }

  reset() { this.port = 0x37; this.portDir = 0x2f; this.cpu.pc = this.read16(0xfffc); this.cpu.sp = 0xfd; this.cpu.i = 1; }
  read16(a) { return this.read(a) | this.read(a + 1) << 8; }

  // what the CPU sees, by the port's LORAM, HIRAM and CHAREN bits
  read(a) {
    if (a === 0) return this.portDir;
    if (a === 1) return (this.port & this.portDir) | (~this.portDir & 0x17) & 0xff | 0x10;   // the cassette sense reads high
    const p = this.port & 7;
    if (a >= 0xe000) return p & 2 ? this.rom(this.kernal, a) : this.ram[a];
    if (a >= 0xd000 && a < 0xe000) { if (p & 3 && p & 4) return this.io(a); if (p & 3) return this.chargen[a - 0xd000]; return this.ram[a]; }
    if (a >= 0xa000 && a < 0xc000) return (p & 3) === 3 ? this.rom(this.basic, a) : this.ram[a];
    return this.ram[a];
  }
  // a ROM's byte; in moonbase's stand-in only those it has (rom.js), another stops the machine
  rom(r, a) {
    const i = a - (r === this.kernal ? 0xe000 : 0xa000);
    if (r.known && !r.known[i]) throw new Error(`the ${r === this.kernal ? 'KERNAL' : 'BASIC'} ROM at $${a.toString(16).toUpperCase()}: not handled`);
    return r[i];
  }
  write(a, v) {
    if (a === 0) { this.portDir = v; return; }
    if (a === 1) { this.port = v; return; }
    const p = this.port & 7;
    if (a >= 0xd000 && a < 0xe000 && (p & 3) && (p & 4)) { this.ioWrite(a, v); return; }
    this.ram[a] = v;   // a write under a ROM goes to the RAM beneath
  }

  // the I/O page: the VIC-II at $D000, the SID at $D400, color RAM at $D800, the CIAs at $DC00 and $DD00
  io(a) {
    if (a < 0xd400) return this.vic.read(a & 0x3f);
    if (a < 0xd800) return (a & 0x1f) === 0x1b ? Math.random() * 256 | 0 : (a & 0x1f) === 0x1c ? 0 : this.sid[a & 0x1f];   // OSC3 reads noise, ENV3 nothing
    if (a < 0xdc00) return this.color[a - 0xd800] | 0xf0;
    if (a < 0xdd00) return this.cia1.read(a & 0xf, this);
    if (a < 0xde00) return this.cia2.read(a & 0xf, this);
    return 0xff;
  }
  ioWrite(a, v) {
    if (a < 0xd400) this.vic.write(a & 0x3f, v);
    else if (a < 0xd800) { this.sid[a & 0x1f] = v; this.sidWrites.push([this.cpu.cycles, a & 0x1f, v]); }
    else if (a < 0xdc00) this.color[a - 0xd800] = v & 15;
    else if (a < 0xdd00) this.cia1.write(a & 0xf, v);
    else if (a < 0xde00) this.cia2.write(a & 0xf, v);
  }

  // the keyboard matrix as CIA1 scans it: port A selects columns, low; port B reads rows, low
  // for a key held; the joystick in port 2 pulls port A's low bits, in port 1 port B's
  keyboardRows(columns) {
    let rows = 0xff;
    for (let c = 0; c < 8; c++) if (!(columns & (1 << c))) rows &= ~this.keys[c];
    return rows & 0xff;
  }

  // the KERNAL's LOAD: the name at ($BB) of $B7 bytes, the device in $BA, the secondary address
  // in $B9, and the address to load at in X and Y when the secondary address is 0. The file goes
  // into memory, the end goes to $AE/$AF and X/Y, and carry clear says it worked.
  load() {
    const c = this.cpu, nameBytes = this.ram.subarray(this.ram[0xbb] | this.ram[0xbc] << 8, (this.ram[0xbb] | this.ram[0xbc] << 8) + this.ram[0xb7]), device = this.ram[0xba], sa = this.ram[0xb9];
    const name = String.fromCharCode(...nameBytes);
    if (device !== 8) { c.a = 5; c.c = 1; return; }   // DEVICE NOT PRESENT
    const raw = this.drive.load(nameBytes);
    if (!raw || raw.length < 2 || c.a !== 0) { this.log('LOAD ' + JSON.stringify(name) + (raw ? ' verify' : ' not found')); c.a = 4; c.c = 1; this.ram[0x90] = 0x42; return; }
    const at = sa === 0 ? c.x | c.y << 8 : raw[0] | raw[1] << 8, body = raw.subarray(2);
    for (let i = 0; i < body.length; i++) this.write(at + i, body[i]);
    const end = at + body.length;
    this.ram[0xae] = end & 0xff; this.ram[0xaf] = end >> 8; this.ram[0x90] = 0;
    c.x = end & 0xff; c.y = end >> 8; c.c = 0; c.a = 0;
    this.log('LOAD', JSON.stringify(name), '$' + at.toString(16), body.length + ' bytes');
  }
  // SAVE: the start address is in the zero page at A, the end in X and Y
  save() {
    const c = this.cpu, name = this.pstringAt(this.ram[0xbb] | this.ram[0xbc] << 8, this.ram[0xb7]);
    const from = this.ram[c.a] | this.ram[c.a + 1] << 8, to = c.x | c.y << 8;
    const body = new Uint8Array(to - from + 2); body[0] = from & 0xff; body[1] = from >> 8;
    for (let i = from; i < to; i++) body[i - from + 2] = this.read(i);
    this.drive.save(this.ram.subarray(this.ram[0xbb] | this.ram[0xbc] << 8, (this.ram[0xbb] | this.ram[0xbc] << 8) + this.ram[0xb7]), body);
    this.log('SAVE', JSON.stringify(name), body.length + ' bytes'); c.c = 0; c.a = 0;
  }
  pstringAt(a, n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.ram[a + i]); return s; }

  // a key held or released, by its place in the matrix: column 0 to 7 and row 0 to 7
  key(column, row, down) { if (down) this.keys[column] |= 1 << row; else this.keys[column] &= ~(1 << row); }
  // type a line as if at the keyboard, through the KERNAL's buffer at $0277, once BASIC is ready
  type(text) { const n = Math.min(10, text.length); for (let i = 0; i < n; i++) this.ram[0x277 + i] = text.charCodeAt(i); this.ram[0xc6] = n; return text.slice(n); }

  // one raster line: the CPU's cycles, the CIAs' timers, the VIC-II's line, and any interrupt. The
  // line is drawn with the registers and memory as they are where its display starts, cycle 15,
  // as the VIC-II takes them: a register written later in the line (a demo's raster split, after
  // its wait) shows from the next line, as the 64 shows the left of the screen (held to VICE on
  // Subway Arts' $D016 at line $42)
  runLine() {
    const until = this.cpu.cycles + CYCLES_PER_LINE, display = this.cpu.cycles + DISPLAY_START;
    let drawn = false;
    while (this.cpu.cycles < until && !this.halted) {
      if (!drawn && this.cpu.cycles >= display) { this.vic.line(this.line); drawn = true; }
      const before = this.cpu.cycles;
      const pc = this.cpu.pc;
      if ((this.port & 2) === 0 && pc >= 0xe000 && !this.cpu.hooks.has(pc)) { /* RAM under the KERNAL: fine, it runs */ }
      this.cpu.step();
      const spent = this.cpu.cycles - before;
      if (this.cia1.tick(spent) && (this.cia1.icr & 0x80)) this.cpu.irq();
      // (NMI on its edge, as the 6502 takes it: once as CIA 2's line goes active, not again until
      // it has gone inactive, its flags read, and active again; a demo that leaves it active,
      // unacknowledged, is not interrupted for ever after, which is how RESTORE is locked out)
      this.cia2.tick(spent);
      const nmi = (this.cia2.icr & 0x80) !== 0;
      if (nmi && !this.nmiLine) this.cpu.nmi();
      this.nmiLine = nmi;
    }
    if (!drawn) this.vic.line(this.line);
    if (this.vic.irq()) this.cpu.irq();
    this.line = (this.line + 1) % LINES;
    if (this.line === 0) this.frame++;
  }
  runFrame() { for (let i = 0; i < LINES; i++) this.runLine(); }
}

// A 6526 CIA: two timers counting cycles, an interrupt when one runs out, and two ports.
class CIA {
  constructor() { this.ta = 0xffff; this.taLatch = 0xffff; this.tb = 0xffff; this.tbLatch = 0xffff; this.cra = 0; this.crb = 0; this.icr = 0; this.mask = 0; this.pra = 0xff; this.prb = 0xff; this.ddra = 0; this.ddrb = 0; this.tod = 0; }
  read(r, m) {
    switch (r) {
      case 0: return m && this === m.cia1 ? (this.pra | ~this.ddra) & ~(m.joystick) & 0xff : (this.pra | ~this.ddra) & 0xff;
      case 1: return m && this === m.cia1 ? m.keyboardRows(this.pra | ~this.ddra) & (this.prb | ~this.ddrb) : (this.prb | ~this.ddrb) & 0xff;
      case 2: return this.ddra; case 3: return this.ddrb;
      case 4: return this.ta & 0xff; case 5: return this.ta >> 8; case 6: return this.tb & 0xff; case 7: return this.tb >> 8;
      case 8: return 0; case 9: return 0; case 10: return 0; case 11: return 0;
      case 13: { const v = this.icr; this.icr = 0; return v; }
      case 14: return this.cra; case 15: return this.crb;
    }
    return 0;
  }
  write(r, v) {
    switch (r) {
      case 0: this.pra = v; break; case 1: this.prb = v; break; case 2: this.ddra = v; break; case 3: this.ddrb = v; break;
      case 4: this.taLatch = (this.taLatch & 0xff00) | v; break; case 5: this.taLatch = (this.taLatch & 0xff) | v << 8; if (!(this.cra & 1)) this.ta = this.taLatch; break;
      case 6: this.tbLatch = (this.tbLatch & 0xff00) | v; break; case 7: this.tbLatch = (this.tbLatch & 0xff) | v << 8; if (!(this.crb & 1)) this.tb = this.tbLatch; break;
      case 13: if (v & 0x80) this.mask |= v & 0x1f; else this.mask &= ~v; break;
      case 14: this.cra = v; if (v & 0x10) this.ta = this.taLatch; break;
      case 15: this.crb = v; if (v & 0x10) this.tb = this.tbLatch; break;
    }
  }
  // the timers by `cycles`; true when an enabled interrupt is raised
  tick(cycles) {
    let raised = false;
    if (this.cra & 1) {
      this.ta -= cycles;
      while (this.ta < 0) { this.ta += this.taLatch + 1; this.icr |= 1; if (this.cra & 8) { this.cra &= ~1; this.ta = this.taLatch; } if ((this.crb & 0x60) === 0x40 && this.crb & 1) { if (--this.tb < 0) { this.tb = this.tbLatch; this.icr |= 2; } } }
    }
    if (this.crb & 1 && (this.crb & 0x60) === 0) { this.tb -= cycles; while (this.tb < 0) { this.tb += this.tbLatch + 1; this.icr |= 2; if (this.crb & 8) { this.crb &= ~1; this.tb = this.tbLatch; } } }
    if (this.icr & this.mask & 0x1f) { this.icr |= 0x80; raised = true; }
    return raised;
  }
}
