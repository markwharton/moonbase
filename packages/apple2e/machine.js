// An Apple IIe with 128K, as far as the games use it: main and auxiliary memory, the language
// card in each, the soft switches that choose between them and set the double hi-res screen,
// the keyboard, and ProDOS's machine language interface at $BF00, answered from the disk's files
// in memory. There is no ROM: the few ROM routines the games call are answered here too.
//
// Given Apple's ROMs (`roms`: `system`, the IIe's 16K from $C000, and `disk2`, the Disk II
// card's boot ROM) and the disks (`disks`, each { unit, image } as prodos.js `units` places
// them: a 140K image in a Disk II's drive, disk2.js, in slot 6 and, for a third, slot 5; a larger
// one in the block card, blocks.js, in slot 7), it is the Apple itself: the ROM is mapped at
// $C100 to $FFFF as the IIe's switches choose, the cards sit in their slots, and the processor
// starts at the reset vector, so the ROM boots the disk as a school's Apple did. None of the
// answers above is installed then. The IIe's 6502 is the NMOS part, as the C64's is.
import { CPU } from '@moonbase-machines/mos6502/cpu.js';
import { install as installRom } from './rom.js';
import { Files, BLOCK } from './mli.js';
import { Disk2 } from './disk2.js';
import { Blocks, DRIVER } from './blocks.js';
import { started } from './prodos.js';

// How long a DOS 3.3 game's BASIC program shows its loading screen: the eighty seconds Pieces
// of Eight's promised, shortened to two and a half.
const LOADING = 2.5 * 1020484;
// where a row of the text page starts
const textRow = r => 0x400 + (r & 7) * 0x80 + (r >> 3) * 40;

const MLI = { 0x40: 'ALLOC_INTERRUPT', 0x41: 'DEALLOC_INTERRUPT', 0x65: 'QUIT', 0x80: 'READ_BLOCK', 0x81: 'WRITE_BLOCK', 0x82: 'GET_TIME', 0xc0: 'CREATE', 0xc1: 'DESTROY', 0xc2: 'RENAME', 0xc3: 'SET_FILE_INFO', 0xc4: 'GET_FILE_INFO', 0xc5: 'ON_LINE', 0xc6: 'SET_PREFIX', 0xc7: 'GET_PREFIX', 0xc8: 'OPEN', 0xc9: 'NEWLINE', 0xca: 'READ', 0xcb: 'WRITE', 0xcc: 'CLOSE', 0xcd: 'FLUSH', 0xce: 'SET_MARK', 0xcf: 'GET_MARK', 0xd0: 'SET_EOF', 0xd1: 'GET_EOF', 0xd2: 'SET_BUF', 0xd3: 'GET_BUF' };
// the row and the column of each byte of a hi-res page; a row's 40 bytes start at
// 0x400 * (y % 8) + 0x80 * ((y / 8) % 8) + 0x28 * (y / 64), and 8 of every 128 bytes are no row
const ROW = new Int16Array(0x2000).fill(-1), COL = new Uint8Array(0x2000);
for (let y = 0; y < 192; y++) { const base = 0x400 * (y % 8) + 0x80 * ((y >> 3) % 8) + 0x28 * (y >> 6); for (let c = 0; c < 40; c++) { ROW[base + c] = y; COL[base + c] = c; } }


export class Machine {
  constructor(game, { log = () => {}, roms, disks = [] } = {}) {
    this.game = game;
    this.log = log;
    this.rom = roms?.system;
    this.main = new Uint8Array(0x10000); this.aux = new Uint8Array(0x10000);
    // the language card: two 4K banks at $D000 and 8K above, in main and in aux
    this.lc = { main: [new Uint8Array(0x1000), new Uint8Array(0x1000), new Uint8Array(0x2000)], aux: [new Uint8Array(0x1000), new Uint8Array(0x1000), new Uint8Array(0x2000)] };
    this.sw = { store80: 0, ramrd: 0, ramwrt: 0, altzp: 0, col80: 0, altchar: 0, text: 1, mixed: 0, page2: 0, hires: 0, dhires: 0, lcRead: 0, lcWrite: 0, lcBank: 2, lcPre: 0, intcxrom: 0, slotc3rom: 0, intc8rom: 0 };
    // the cards, by slot: each a 256-byte ROM at $Cn00 and its switches at $C080 + 16n
    this.slots = [];
    this.key = 0; this.keys = [];
    // every file of every volume, and ProDOS's calls on them (mli.js)
    this.disk = new Files(game, (...a) => this.log(...a));
    this.vbl = 0; this.halted = false; this.idle = 0;
    // the speaker: the cycle of each click, for the sound to be made from
    this.clicks = [];
    // who last drew each dot of the screen page, 560 to a row: 1 the picture routine, while
    // `marking` is set, for every dot of a byte it writes; 2 anything else, for the dots it
    // changes; 0 nobody yet
    this.owner = new Uint8Array(560 * 192); this.marking = 0;
    this.cpu = new CPU(this, { nmos: !!this.rom });
    if (this.rom) {
      const clock = () => this.cpu.cycles;
      this.slots[6] = new Disk2(roms.disk2, clock);
      for (const d of disks) {
        const s = d.unit >> 4 & 7;
        if (d.image.length === 143360) (this.slots[s] ??= new Disk2(roms.disk2, clock)).insert(d.unit >> 7, d.image, d);
        else { const card = this.slots[s] = new Blocks(s, d.image, d); this.cpu.hooks.set(0xc000 | s << 8 | DRIVER, c => this.sw.intcxrom ? false : card.call(c)); }
      }
      // a disk taken out of its drive, or put back, by its volume's name
      this.disk = { drive: (volume, inDrive) => {
        const d = disks.find(x => x.volume.toUpperCase() === volume.toUpperCase()), card = d && this.slots[d.unit >> 4 & 7];
        (card.drives?.[d.unit >> 7] ?? card).out = !inDrive;
      } };
      this.cpu.pc = this.cpu.read16(0xfffc);
      return;
    }
    this.cpu.hooks.set(0xbf00, () => this.mli());
    this.cpu.hooks.set(0xfe1f, c => { c.c = 1; c.a = 0; c.x = 0; c.y = 0; });   // IDROUTINE: not a IIgs
    installRom(this);
    for (const a of [0xf82f, 0xfaa6]) this.cpu.hooks.set(a, () => this.sw.lcRead ? false : undefined);   // odd ROM entries the Nature Park system file calls: nothing to do
    this.boot();
  }

  // ProDOS starts a system file at $2000 in main memory, with its global page at $BF00. A DOS
  // 3.3 game is started as its BASIC program would: each file loaded where the program says,
  // the card's bank chosen for the two under $D000, and the address the program calls, called.
  // While it loads, the screen is the program's own: Pieces of Eight's says PLEASE WAIT and
  // LOADING TIME 80 SECONDS, which here is `LOADING` cycles, two and a half seconds. Headless, it
  // is at once.
  boot() {
    // what ProDOS leaves (prodos.js)
    if (this.game.kind === 'prodos') for (const [bank, aux] of [[this.main, false], [this.aux, true]]) for (const [a, v] of Object.entries(started(this.game, { aux }))) bank[a] = v;
    this.main[0xbf00] = 0x4c; this.main[0xbf01] = 0x00; this.main[0xbf02] = 0xbf;   // JMP $BF00, so the hook is reached
    this.cpu.sp = 0xfd;
    if (this.game.kind === 'prodos') { this.main.set(this.file(this.game.system).body, 0x2000); this.cpu.pc = 0x2000; return; }
    this.home();
    for (const [row, col, words] of this.game.wait ?? []) for (let k = 0; k < words.length; k++) this.main[textRow(row) + col + k] = words.charCodeAt(k) | 0x80;
    const load = () => {
      for (const [name, at, bank] of this.game.loads) {
        const body = this.file(name).body;
        if (bank) { this.io(0xc080 | (bank === 1 ? 8 : 0) | 3); this.io(0xc080 | (bank === 1 ? 8 : 0) | 3); }
        for (let i = 0; i < body.length; i++) this.write(at + i, body[i]);
      }
      this.io(0xc08b); this.io(0xc08b);
      this.home();   // HOME, and then the CALL
      this.main[0x20] = 0; this.main[0x21] = 40; this.main[0x22] = 16; this.main[0x23] = 24; this.main[0x32] = 0xff;   // POKE 34,16: the text window's top
      // (the stack as Applesoft's CALL, from a running program, leaves it: seven bytes of its own,
      // and the CALL's return address, so the game's own frames are where Apple's ROM puts them)
      this.cpu.sp = 0xf6;
      this.cpu.pc = this.game.call;
    };
    this.reading = { at: this.cpu.cycles + LOADING, arrive: load };
  }
  // HOME: the text page all spaces
  home() { for (let r = 0; r < 24; r++) this.main.fill(0xa0, textRow(r), textRow(r) + 40);
  }

  // which bank an address reads from or writes to, by the switches
  bankFor(a, write) {
    if (a < 0x200) return this.sw.altzp ? this.aux : this.main;
    if (a >= 0xc000) return null;
    if (this.sw.store80) {
      if (a >= 0x400 && a < 0x800) return this.sw.page2 ? this.aux : this.main;
      if (this.sw.hires && a >= 0x2000 && a < 0x4000) return this.sw.page2 ? this.aux : this.main;
    }
    return (write ? this.sw.ramwrt : this.sw.ramrd) ? this.aux : this.main;
  }
  // the machine's memory as one array, for a tool to compare two machines by: main, auxiliary,
  // then the language card in each (its two banks at $D000 and the 8K above); and which byte of it
  // address `a` reads, or writes, by the switches now: -1 for the ROM, the I/O page and the slots
  memory() { const out = new Uint8Array(0x28000); out.set(this.main); out.set(this.aux, 0x10000); [...this.lc.main, ...this.lc.aux].reduce((at, b) => (out.set(b, at), at + b.length), 0x20000); return out; }
  where(a, write) {
    if (a >= 0xd000) return (write ? this.sw.lcWrite : this.sw.lcRead) ? 0x20000 + (this.sw.altzp ? 0x4000 : 0) + (a < 0xe000 ? (this.sw.lcBank - 1) * 0x1000 + a - 0xd000 : 0x2000 + a - 0xe000) : -1;
    if (a >= 0xc000) return -1;
    return (this.bankFor(a, write) === this.aux ? 0x10000 : 0) + a;
  }
  lcFor(a) { const set = this.sw.altzp ? this.lc.aux : this.lc.main; return a < 0xe000 ? [set[this.sw.lcBank - 1], a - 0xd000] : [set[2], a - 0xe000]; }

  read(a) {
    if (a >= 0xd000) { if (this.sw.lcRead) { const [b, o] = this.lcFor(a); return b[o]; } return this.rom ? this.rom[a - 0xc000] : 0; }
    if (a >= 0xc000) return this.io(a, undefined);
    return this.bankFor(a, false)[a];
  }
  write(a, v) {
    if (a >= 0xd000) { if (this.sw.lcWrite) { const [b, o] = this.lcFor(a); b[o] = v; } return; }
    if (a >= 0xc000) { this.io(a, v); return; }
    const bank = this.bankFor(a, true);
    if (a >= 0x2000 && a < 0x4000) {
      const changed = this.marking ? 0x7f : (bank[a] ^ v) & 0x7f, y = ROW[a - 0x2000];
      if (changed && y >= 0) { const at = y * 560 + COL[a - 0x2000] * 14 + (bank === this.aux ? 0 : 7), who = this.marking ? 1 : 2; for (let k = 0; k < 7; k++) if (changed >> k & 1) this.owner[at + k] = who; }
    }
    bank[a] = v;
  }

  // the soft switches: a read or a write at $C000 to $C0FF; slot ROM above, empty without Apple's
  io(a, v) {
    const s = this.sw, w = v !== undefined;
    if (a >= 0xc100) return this.rom ? this.cx(a) : 0;
    switch (a) {
      case 0xc000: if (w) { s.store80 = 0; return; } this.idle++; return this.key;
      case 0xc001: if (w) s.store80 = 1; return 0;
      case 0xc002: if (w) s.ramrd = 0; return 0;
      case 0xc003: if (w) s.ramrd = 1; return 0;
      case 0xc004: if (w) s.ramwrt = 0; return 0;
      case 0xc005: if (w) s.ramwrt = 1; return 0;
      case 0xc006: if (w) s.intcxrom = 0; return 0;
      case 0xc007: if (w) s.intcxrom = 1; return 0;
      case 0xc008: if (w) s.altzp = 0; return 0;
      case 0xc009: if (w) s.altzp = 1; return 0;
      case 0xc00a: if (w) s.slotc3rom = 0; return 0;
      case 0xc00b: if (w) s.slotc3rom = 1; return 0;
      case 0xc00c: if (w) s.col80 = 0; return 0;
      case 0xc00d: if (w) s.col80 = 1; return 0;
      case 0xc00e: if (w) s.altchar = 0; return 0;
      case 0xc00f: if (w) s.altchar = 1; return 0;
      case 0xc010: { const k = this.key; this.key &= 0x7f; if (!(k & 0x80)) this.idle++; if (this.keys.length) this.key = this.keys.shift() | 0x80; return k; }
      case 0xc011: return (s.lcBank === 2) << 7;
      case 0xc012: return s.lcRead << 7;
      case 0xc013: return s.ramrd << 7;
      case 0xc014: return s.ramwrt << 7;
      case 0xc015: return s.intcxrom << 7;
      case 0xc016: return s.altzp << 7;
      case 0xc017: return s.slotc3rom << 7;
      case 0xc018: return s.store80 << 7;
      case 0xc019: this.vbl ^= 0x80; return this.vbl;
      case 0xc01a: return s.text << 7;
      case 0xc01b: return s.mixed << 7;
      case 0xc01c: return s.page2 << 7;
      case 0xc01d: return s.hires << 7;
      case 0xc01e: return s.altchar << 7;
      case 0xc01f: return s.col80 << 7;
      case 0xc030: this.clicks.push(this.cpu.cycles); return 0;   // the speaker clicks
      case 0xc050: s.text = 0; return 0;
      case 0xc051: s.text = 1; return 0;
      case 0xc052: s.mixed = 0; return 0;
      case 0xc053: s.mixed = 1; return 0;
      case 0xc054: s.page2 = 0; return 0;
      case 0xc055: s.page2 = 1; return 0;
      case 0xc056: s.hires = 0; return 0;
      case 0xc057: s.hires = 1; return 0;
      case 0xc05e: s.dhires = 1; return 0;
      case 0xc05f: s.dhires = 0; return 0;
    }
    if (a >= 0xc080 && a < 0xc090) {
      const b = a & 0xf;
      s.lcBank = b & 8 ? 1 : 2;
      s.lcRead = ((b & 1) === ((b >> 1) & 1)) ? 1 : 0;
      // writing to the card takes two accesses in a row of an odd switch; the loader makes them with stores
      if (b & 1) { if (s.lcPre) s.lcWrite = 1; s.lcPre = 1; } else { s.lcWrite = 0; s.lcPre = 0; }
      return 0;
    }
    if (a >= 0xc090) { const card = this.slots[a >> 4 & 7]; return card ? card.io(a & 15, v) ?? 0 : 0; }
    if (a >= 0xc061 && a <= 0xc063) return 0;   // no button held
    return 0;   // the IIgs registers, the mouse card, and the rest: nothing there
  }

  // $C100 to $CFFF on Apple's ROM: a card's ROM in its slot, or the IIe's own when INTCXROM is
  // set; slot 3's is the IIe's own 80-column firmware unless SLOTC3ROM is set, and touching it
  // brings in the firmware's $C800 half too, until $CFFF is touched
  cx(a) {
    const s = this.sw;
    if (a < 0xc800) {
      const n = a >> 8 & 7;
      if (s.intcxrom || (n === 3 && !s.slotc3rom)) { if (n === 3) s.intc8rom = 1; return this.rom[a - 0xc000]; }
      return this.slots[n]?.rom[a & 0xff] ?? 0;
    }
    const v = s.intcxrom || s.intc8rom ? this.rom[a - 0xc000] : 0;
    if (a === 0xcfff) s.intc8rom = 0;
    return v;
  }

  // a file by its name: a full path from a volume, or one under the prefix; a DOS 3.3 name as it is
  get files() { return this.disk.files; }
  file(name) { return this.disk.file(name); }
  put(path, f) { this.disk.put(path, f); }
  remove(path) { this.disk.remove(path); }

  // JSR $BF00, a command byte and the address of a parameter block after it; back with A the
  // error and carry set on one
  mli() {
    const c = this.cpu;
    const ret = (c.read(0x100 | ((c.sp + 1) & 0xff)) | c.read(0x100 | ((c.sp + 2) & 0xff)) << 8) + 1;
    const cmd = c.read(ret), params = c.read16(ret + 1);
    c.write(0x100 | ((c.sp + 1) & 0xff), (ret + 2) & 0xff); c.write(0x100 | ((c.sp + 2) & 0xff), (ret + 2) >> 8);
    // In time (`diskTime`), a READ's bytes arrive when a disk would have read them, and until
    // then the Apple waits and the screen shows what it showed
    const deliver = (n, arrive) => { if (this.diskTime && n) this.reading = { at: c.cycles + Math.ceil(n / 512) * BLOCK, arrive }; else arrive(); };
    let err = this.disk.call(cmd, params, c, { deliver });
    if (err === 'quit') { this.halted = 'quit'; err = 0; }
    if (err === null) { this.log('MLI ' + (MLI[cmd] || cmd.toString(16)) + ' not handled'); err = 0x01; }
    // (ProDOS runs in the language card, which it enters with two reads of $C08B, and leaves
    // it, as it goes back, by what the caller read there ($BFA0 in 1.9's global page): the ROM,
    // with STA $C082, the card's RAM write-protected; or the card's RAM, the caller's bank,
    // write-enabled still)
    if (this.halted === 'quit') return;   // (QUIT does not come back)
    if (this.sw.lcRead) { this.sw.lcWrite = 1; this.sw.lcPre = 1; } else Object.assign(this.sw, { lcWrite: 0, lcPre: 0, lcBank: 2 });
    c.a = err; c.c = err ? 1 : 0;
  }

  // a key, as the Apple gives it: ASCII with the high bit set until $C010 is read
  press(ch) { const k = typeof ch === 'string' ? ch.charCodeAt(0) : ch; if (this.key & 0x80) this.keys.push(k); else this.key = k | 0x80; this.idle = 0; }

  // run until the game waits on the keyboard with nothing pressed, or `steps` instructions
  // pass; a call into the ROM that nothing here answers stops the machine and says where
  run(steps = 2e6, { going = false } = {}) {
    if (!going) this.idle = 0;   // (a run that goes on from one stopped by its steps keeps its count of polls)
    if (this.reading) { this.reading.arrive(); this.reading = null; }
    for (let i = 0; i < steps && !this.halted; i++) {
      const pc = this.cpu.pc;
      if (pc >= 0xd000 && !this.rom && !this.sw.lcRead && !this.cpu.hooks.has(pc)) { this.halted = 'ROM $' + pc.toString(16); break; }
      this.cpu.step(); if (this.idle > 2000) return 'idle';
    }
    return this.halted || 'steps';
  }

  // run for `cycles` of the Apple's clock, 1,020,484 a second, so that the games' delays, in
  // loops and in the ROM's WAIT, take the time they took; a game waiting on the keyboard
  // is left waiting
  runCycles(cycles) {
    const until = this.cpu.cycles + cycles;
    this.idle = 0;
    while (this.cpu.cycles < until && !this.halted) {
      // a read from the disk still coming: the Apple waits for it
      if (this.reading) {
        if (this.cpu.cycles < this.reading.at) { this.cpu.cycles = Math.min(until, this.reading.at); continue; }
        this.reading.arrive(); this.reading = null;
      }
      const pc = this.cpu.pc;
      if (pc >= 0xd000 && !this.rom && !this.sw.lcRead && !this.cpu.hooks.has(pc)) { this.halted = 'ROM $' + pc.toString(16); break; }
      this.cpu.step();
      if (this.idle > 2000) { this.cpu.cycles = until; break; }
    }
  }

  // the hi-res screen: the auxiliary and main halves of the page shown; a single hi-res game
  // draws only the main half
  screen() { const off = this.sw.page2 && !this.sw.store80 ? 0x4000 : 0x2000; return { aux: this.aux.subarray(off, off + 0x2000), main: this.main.subarray(off, off + 0x2000) }; }
}
