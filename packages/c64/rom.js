// The Commodore 64's ROMs in JavaScript, since the ROMs are Commodore's own: the original's
// counterpart of @moonbase/apple2e/rom.js for the Apple. The games run as they are, their own
// bytes on the 6510; where one calls into the KERNAL or BASIC, the routine is answered here, at
// its address, as the remake's KERNAL answers it (kernal.js), and the machine goes on as the
// ROM's would have left it. A routine not here stops the machine and says where, as the remake
// does.
//
//   const roms = standIn()                      the three ROMs' places, for new C64(game, roms)
//   install(machine)                            the routines, on the machine's processor
//
// What the ROM images hold is only what a game reads as data, each byte with its reason: the
// processor's three vectors, the KERNAL's keyboard tables (kernal.js `kernalByte`), and three
// bytes Zoopak's code reads with BIT only to skip the two bytes after it (BIT $AE91, $FBB1 and
// $FFA9), whose top two bits the flags take. Any other byte read stops the machine too. The
// character set is moonbase's own 5 by 7 font (@moonbase/charset/font.js), the Apple's: a game
// that draws in its own characters (Zoopak's, from RAM) is not touched by it.
//
// The titles it runs, each held to the remake and to Commodore's ROMs, are `STANDS_IN`: Zoopak,
// and Goldfields, whose Blitz! code calls BASIC's ROM as its library (basic-rom.js); and Crayon
// on the 64, Moonbase's own, held to Commodore's ROMs.
import { install as kernal, kernalByte, VIC, VECTORS } from './kernal.js';
import { CONSTANTS } from './float.js';
import { chargen } from '@moonbase/charset/chargen.js';
import { install as basicRom, printError, evaluateInMemory } from './basic-rom.js';
import { lines, direct, crunch, store, list, program as programLines, dataItems } from './basic-lang.js';
import { instantiate, evaluator } from './basic-compile.js';
import { Basic } from './basic.js';
import { BasicError, ERRORS, val, scanNumber } from './numbers.js';

export const STANDS_IN = ['zoopak', 'goldfields', 'crayon64', 'crayon64-studio'];

const BYTES = {
  0xfffa: 0x43, 0xfffb: 0xfe,   // NMI: $FE43
  0xfffc: 0xe2, 0xfffd: 0xfc,   // RESET: $FCE2, the cold start
  0xfffe: 0x48, 0xffff: 0xff,   // IRQ and BRK: $FF48
  0xae91: 0xbc, 0xfbb1: 0x8d, 0xffa9: 0xdd,   // read by BIT only: N set, and V for $FFA9
};

// a ROM's 8K and which of its bytes are here; reading one that is not stops the machine
function image(from) {
  const bytes = new Uint8Array(0x2000), known = new Uint8Array(0x2000);
  for (let a = from; a < from + 0x2000; a++) {
    let v = BYTES[a];
    if (v === undefined && from === 0xe000) try { v = kernalByte(a); } catch { v = undefined; }
    // (BASIC's constants, which its arithmetic reads from the ROM: float.js)
    for (const [at, bytes] of Object.entries(CONSTANTS)) if (a >= +at && a < +at + bytes.length) v = bytes[a - at];
    if (v !== undefined) { bytes[a - from] = v; known[a - from] = 1; }
  }
  return Object.assign(bytes, { known, from });
}
export function standIn() {
  return { kernal: image(0xe000), basic: image(0xa000), chargen: chargen(), standIn: true };
}

// The keyboard's matrix as the KERNAL's scan finds it: the first key held that is not a shift
// key, as its code (column * 8 + row), and the shift keys down as $028D has them (1 SHIFT, 2 the
// Commodore key, 4 CTRL)
const SHIFTS = { 0x0f: 1, 0x34: 1, 0x3d: 2, 0x3a: 4 };
function held(m) {
  let code = null, shift = 0;
  for (let column = 0; column < 8; column++) for (let row = 0; row < 8; row++) {
    if (!(m.keys[column] & 1 << row)) continue;
    const k = column * 8 + row;
    if (SHIFTS[k]) shift |= SHIFTS[k]; else if (code === null) code = k;
  }
  return code === null && !shift ? null : { code, shift };   // (code null: only shift keys down)
}

export function install(m) {
  const c = m.cpu, r = a => m.read(a), w = (a, v) => m.write(a, v & 0xff);
  // (CHRGET and CHRGOT, $0073 and $0079, BASIC's in RAM, answered as its ROM's are, whatever is banked)
  const banked = pc => (pc >= 0xe000 && m.port & 2) || (pc >= 0xa000 && pc < 0xc000 && (m.port & 3) === 3) || pc === 0x73 || pc === 0x79;
  const vector = a => r(a) | r(a + 1) << 8;
  // a routine the game's own code calls, run to its return: the keyboard decode a game has
  // pointed $028F at (Tell-A-Tale's)
  const call = at => {
    const back = c.pc, sp = c.sp;
    c.push((back - 1) >> 8); c.push((back - 1) & 0xff); c.pc = at;
    for (let guard = 0; guard < 1e6 && !(c.pc === back && c.sp === sp); guard++) c.step();
  };
  const before = new Set(c.hooks.keys());
  kernal({ cpu: c, read: r, write: w, drive: m.bus, call, held: () => held(m), log: m.log });
  // and what the remake's KERNAL leaves to the remake: GETIN, the next key in the keyboard's
  // buffer ($0277, $C6 of them), or 0, or from the drive when the input is a file on it, as CHRIN
  // reads it; SCNKEY
  // ($FF9F, and $EA87 itself), the interrupt's keyboard read; SCREEN and IOBASE, the screen's size and the I/O's place
  c.hooks.set(0xffe4, () => {
    if (r(0x99) >= 4) return c.hooks.get(0xf157)(c);   // (from a file, CHRIN's own way: $F14A on to $F166)
    const n = r(0xc6);
    if (!n) { c.a = 0; c.nz(0); c.c = 0; return; }
    c.a = r(0x277); for (let i = 0; i < n - 1; i++) w(0x277 + i, r(0x278 + i)); w(0xc6, n - 1); c.nz(c.a); c.c = 0;
  });
  c.hooks.set(0xff9f, c.hooks.get(0xea7b));
  c.hooks.set(0xea87, c.hooks.get(0xea7b));   // (and SCNKEY at its own address, past the jump table)
  c.hooks.set(0xffed, () => { c.x = 40; c.y = 25; });
  c.hooks.set(0xfff3, () => { c.x = 0x00; c.y = 0xdc; });
  // The jump table's routines that go through a vector in RAM ($031A to $0333), as the KERNAL's
  // own do (CHROUT, $FFD2, is JMP ($0326)): the routine at the vector's own place, and the table's
  // entry on through the vector, to it or to a game's own routine there (Zoopak's MENU points
  // CHROUT at its own, which draws on its screen and ends JMP $F1CA). But LOAD and SAVE go to the
  // machine's own, at $F49E and $F5DD (machine.js), before their vectors, as with
  // Commodore's ROM: the drive is answered at the KERNAL's routines, not on the serial bus's
  // wires, so a game's own fast loader at the vector (Zoopak's, at $C20C) is gone past.
  const VECTORED = { 0xffc0: [0x31a, 0xf34a], 0xffc3: [0x31c, 0xf291], 0xffc6: [0x31e, 0xf20e], 0xffc9: [0x320, 0xf250], 0xffcc: [0x322, 0xf333],
    0xffcf: [0x324, 0xf157], 0xffd2: [0x326, 0xf1ca], 0xffe1: [0x328, 0xf6ed], 0xffe4: [0x32a, 0xf13e], 0xffe7: [0x32c, 0xf32f] };
  for (const [entry, [via, own]] of Object.entries(VECTORED).map(([e, v]) => [+e, v])) {
    c.hooks.set(own, c.hooks.get(entry));
    c.hooks.set(entry, () => { c.pc = vector(via); return false; });
  }
  c.hooks.set(0xffd5, () => { w(0xc3, c.x); w(0xc4, c.y); c.pc = 0xf49e; return false; });
  c.hooks.set(0xffd8, () => { c.pc = 0xf5dd; return false; });
  // BASIC's ROM: the routines a program's machine code calls (basic-rom.js), an
  // expression's value from the program being run (its compiled parameters)
  basicRom({ cpu: c, read: r, write: w, chrout: c.hooks.get(0xf1ca),
    // (the program RUN has compiled, the boot, its own compiled parameters; any other text, a
    // program BASIC is not running (Blitz!'s GAME), read from memory and its variables there)
    evaluate: at => {
      const p = program?.params?.[at];
      if (!p) return inMemory(at);
      const [end, f, place] = p;
      return { value: f(basic), end, place };
    } });
  const inMemory = evaluateInMemory({ cpu: c, read: r, write: w, ram: m.ram });

  const ours = [...c.hooks.keys()].filter(a => !before.has(a));
  // the return from an interrupt, as the KERNAL's ends ($EA81): Y, X and A back, and RTI
  const exit = () => { c.y = c.pull(); c.x = c.pull(); c.a = c.pull(); c.p = c.pull(); c.pc = c.pull() | c.pull() << 8; };
  const set = (a, f) => c.hooks.set(a, f);
  // CINT ($FF5B), as the KERNAL's goes on after the screen: it waits for the raster's line 0
  // ($D012), takes PAL or NTSC from the VIC's raster interrupt flag ($D019, kept at $02A6), sets
  // CIA 1's timer A for it ($4025 or $4295 cycles, a sixtieth of a second) and starts it, with its
  // interrupt on, and lets the serial bus's clock line go. The VIC is read as the KERNAL reads
  // it, so that a machine that counts its reads counts the same.
  { const screen = c.hooks.get(0xff5b);
    c.hooks.set(0xff5b, () => {
      screen(c);
      for (let guard = 0; guard < 1e5 && r(0xd012) !== 0; guard++);
      w(0x2a6, r(0xd019) & 1);
      const timer = r(0x2a6) ? 0x4025 : 0x4295;
      w(0xdc04, timer); w(0xdc05, timer >> 8);
      w(0xdc0d, 0x81); w(0xdc0e, (r(0xdc0e) & 0x80) | 0x11);
      // and the serial bus's clock line let go ($EE8E): CIA 2's port read back, its bit 4 set
      w(0xdd00, r(0xdd00) | 0x10);
    }); }
  // The interrupt's own routine and its ends, which a game's routine jumps on to: the work (the
  // remake's), the CIA's interrupt answered ($DC0D read), and the return
  for (const a of [0xea31, 0xea34, 0xea7b, 0xea7e]) { const f = c.hooks.get(a); set(a, () => { f(c); r(0xdc0d); exit(); return false; }); }
  set(0xea81, () => { exit(); return false; });
  // the way in: A, X and Y kept, and on through $0316 for BRK or $0314 for an interrupt ($FF48)
  set(0xff48, () => { c.push(c.a); c.push(c.x); c.push(c.y); c.pc = vector(r(0x104 + c.sp) & 0x10 ? 0x316 : 0x314); return false; });
  // NMI, the RESTORE key: on through $0318 ($FE43), whose own routine ($FE47) answers CIA 2 and returns
  set(0xfe43, () => { c.i = 1; c.pc = vector(0x318); return false; });
  set(0xfe47, () => { r(0xdd0d); c.p = c.pull(); c.pc = c.pull() | c.pull() << 8; return false; });
  // the cold start ($FCE2), and BASIC ready for a command (`ready`, at $A480)
  set(0xfce2, () => { coldStart(); c.i = 0; c.pc = 0xa480; return false; });
  set(0xa480, () => ready());
  // where BASIC's LOAD comes back to, when the file loaded has not taken the stack: READY again
  set(0xe178, () => {
    // (a program, loaded at BASIC's start, has its variables after it, as a LOAD from the keyboard sets them)
    if (!r(0xb9)) { w(0x2d, r(0xae)); w(0x2e, r(0xaf)); }
    print('\rREADY.\r'); c.sp = 0xff; c.pc = 0xa480; return false;
  });
  // RUN ($A871) and BASIC going on to its next statement ($A7AE), where SYS's machine code and
  // GET's GETIN come back to
  set(0xa871, () => { run(); c.pc = 0xa7ae; return false; });
  set(0xa7ae, () => go());
  // CLR as RUN's own start calls it ($A659: the text pointer at the program's start, and CLEARC,
  // the variables and arrays after its end ($2D), the strings down from the top, $37) and LINKPRG
  // ($A533: each line's link set to the next, from TXTTAB, to the line whose link's high byte is
  // 0), as a cruncher calls them at its end, over the program it has unpacked, before $A7AE runs
  // it: the program read afresh each time, so that $A7AE starts it at its first line
  set(0xa659, () => {
    w(0x2f, r(0x2d)); w(0x30, r(0x2e)); w(0x31, r(0x2d)); w(0x32, r(0x2e)); w(0x33, r(0x37)); w(0x34, r(0x38));
    run(); cont = null; return true;
  });
  set(0xa533, () => {
    for (let at = r(0x2b) | r(0x2c) << 8, k = 0; r(at + 1) && k < 0x10000; k++) {
      let end = at + 4; while (r(end)) end++;
      w(at, (end + 1) & 0xff); w(at + 1, (end + 1) >> 8); at = end + 1;
    }
    if (basic) compile();
    return true;
  });
  // BASIC's errors, as its ROM has them: X the error's number, $A437 on through the vector at
  // $0300 (to $E38B, unless a program has moved it), there to $A43A for an error (X under $80) or
  // READY ($A474) for none; and $A43A the message, IN the line (CURLIN, $39), and READY
  set(0xa437, () => { c.pc = r(0x300) | r(0x301) << 8; return false; });
  set(0xe38b, () => { c.pc = c.x & 0x80 ? 0xa474 : 0xa43a; return false; });
  set(0xa43a, () => { printError(fromRom, '?' + ERRORS[c.x - 1] + ' ERROR', r(0x39) | r(0x3a) << 8); c.sp = 0xff; c.pc = 0xa480; return false; });
  // (the KERNAL's routines, CLRCHN and CHROUT, called as the ROM's error routine calls them: a JSR
  // from it, at $A447, through the jump table and the vector a program may have moved, run on the
  // processor until it returns there)
  const jsr = (at, from) => {
    const sp = c.sp, ret = from + 2, pc = c.pc;
    c.push(ret >> 8); c.push(ret & 0xff); c.pc = at;
    for (let k = 0; k < 1e6 && !(c.pc === ret + 1 && c.sp === sp); k++) c.step();
    c.pc = pc;
  };
  const fromRom = { cpu: { get a() { return c.a; }, set a(v) { c.a = v; }, hooks: { get: at => () => jsr(at, 0xa447) } }, write: w };
  set(0xa474, () => { print('\rREADY.\r'); c.sp = 0xff; c.pc = 0xa480; return false; });
  // each of these only while its ROM is in; under it, the RAM's own code runs
  // (and a routine that returns from its caller too, `'return'`, has its caller's return address
  // pulled before its own RTS: basic-rom.js's $E206). An error in a routine the machine code has
  // called goes on as the ROM's does, above; in one a statement of the program has called
  // (`inStatement`, go() below), to the statement's own.
  for (const a of [...ours, 0xa437, 0xe38b, 0xa43a, 0xa474, 0xea81, 0xff48, 0xfe43, 0xfe47, 0xfce2, 0xa480, 0xe178, 0xa871, 0xa7ae, 0xa659, 0xa533]) {
    const f = c.hooks.get(a);
    c.hooks.set(a, cpu => {
      if (!banked(cpu.pc)) return false;
      let result;
      try { result = f(cpu); }
      catch (err) {
        const word = err instanceof BasicError && !inStatement && /^\?(.*) ERROR$/.exec(err.message)?.[1];
        if (!ERRORS.includes(word)) throw err;
        cpu.x = ERRORS.indexOf(word) + 1; cpu.pc = 0xa437; return false;
      }
      if (result === 'return') { cpu.pull(); cpu.pull(); return true; }
      return result;
    });
  }

  const chrout = ch => { const { a, x, y } = c; c.a = ch; c.hooks.get(0xf1ca)(c); Object.assign(c, { a, x, y }); };
  const print = s => { for (const ch of s) chrout(ch.charCodeAt(0)); };

  // The machine as the KERNAL and BASIC start it: the I/O (the CIAs, CIA 1's timer A the
  // interrupt sixty times a second, the VIC through CINT), the RAM's first pages cleared and
  // the KERNAL's own variables and vectors set, and the screen cleared with the light blue cursor
  function coldStart() {
    c.i = 1; c.sp = 0xff; m.port = 0x37; m.portDir = 0x2f;
    for (let a = 2; a < 0x400; a++) if (a < 0x100 || a >= 0x200) m.ram[a] = 0;
    w(0xdc0d, 0x7f); w(0xdd0d, 0x7f); w(0xdc00, 0x7f); w(0xdc02, 0xff); w(0xdc03, 0x00);
    w(0xdc0e, 0x08); w(0xdc0f, 0x08); w(0xdd0e, 0x08); w(0xdd0f, 0x08);   // the timers stopped, one-shot
    w(0xdd00, 0x07); w(0xdd02, 0x3f);
    w(0xdc04, 0x25); w(0xdc05, 0x40); w(0xdc0d, 0x81); w(0xdc0e, 0x11);   // timer A: $4025 cycles, its interrupt on, started
    w(0x282, 0x08); w(0x284, 0xa0); w(0x283, 0x00); w(0x281, 0x00);   // the memory BASIC has, $0800 to $A000
    w(0x288, 0x04); w(0x286, 0x0e); w(0x289, 0x0a); w(0x28b, 0x04); w(0x28c, 0x0a); w(0x28a, 0x00);
    w(0x28f, 0x48); w(0x290, 0xeb);   // the keyboard's decode, the KERNAL's own ($EB48)
    w(0xf5, 0x81); w(0xf6, 0xeb);     // its table, the unshifted ($EB81)
    w(0x2a6, 0x01);                   // PAL
    w(0x9a, 0x03); w(0x99, 0x00); w(0x9d, 0x80); w(0xcc, 0x01); w(0xcd, 0x14);
    // BASIC's pointers, as it starts with no program (NEW): its text at $0801, the variables and
    // arrays after its empty end, the strings down from the top of its memory, $A000
    const word = (at, v) => { w(at, v); w(at + 1, v >> 8); };
    word(0x2b, 0x0801); word(0x2d, 0x0803); word(0x2f, 0x0803); word(0x31, 0x0803); word(0x33, 0xa000); word(0x37, 0xa000);
    // and its two jumps in RAM: its functions' (JMPER, $54, which a program sets the address of,
    // Blitz!'s calls to the floating point), and USR's ($0310, to ILLEGAL QUANTITY until it is set)
    w(0x54, 0x4c); w(0x310, 0x4c); word(0x311, 0xb248);
    // the rest of BASIC's start ($E453, $E3BF): its vectors (the error's, the main loop's, the
    // tokeniser's, the lister's, a statement's and an expression's routines), the conversions'
    // ($03 and $05: a number to a whole one, and back), CHRGET and CHRGOT in RAM (INC $7A; BNE;
    // INC $7B; LDA $EA60; CMP #$3A; BCS; CMP #$20; BEQ $73; SEC; SBC #$30; SEC; SBC #$D0; RTS, and
    // RND's first seed after them), the garbage collector's step, the fill byte, the input device,
    // the temporary strings' stack empty ($16 at $19), and two bytes of the stack
    [0xe38b, 0xa483, 0xa57c, 0xa71a, 0xa7e4, 0xae86].forEach((v, i) => word(0x300 + 2 * i, v));
    word(0x03, 0xb1aa); word(0x05, 0xb391);
    [0xe6, 0x7a, 0xd0, 0x02, 0xe6, 0x7b, 0xad, 0x60, 0xea, 0xc9, 0x3a, 0xb0, 0x0a, 0xc9, 0x20, 0xf0, 0xef, 0x38, 0xe9, 0x30, 0x38, 0xe9, 0xd0, 0x60,
      0x80, 0x4f, 0xc7, 0x52, 0x58].forEach((v, i) => w(0x73 + i, v));
    w(0x53, 0x03); w(0x68, 0); w(0x13, 0); w(0x18, 0); w(0x1fd, 1); w(0x1fc, 1); w(0x16, 0x19);
    m.ram[0x800] = 0; m.ram[0x801] = 0; m.ram[0x802] = 0;
    VECTORS.forEach((v, i) => { w(0x314 + 2 * i, v); w(0x315 + 2 * i, v >> 8); });
    VIC.forEach((v, i) => w(0xd000 + i, v));
    c.hooks.get(0xff5b)(c);   // CINT: the VIC and the screen
    print('\rREADY.\r');
  }

  // BASIC's main loop ($A480): a line typed read into the buffer at $0200, as INLIN reads it
  // ($A560: CHRIN's characters, the screen editor's line, to RETURN; past 88, STRING TOO LONG;
  // then a RETURN printed), and carried out. An empty line is read again. A line with a number
  // goes into the program in its place (its number as LINGET reads it, the rest tokenized as
  // CRUNCH tokenizes it: basic-lang.js), the variables cleared, and the next line read.
  // Any other runs at once (direct mode, `direct` below), and READY. Two keep their ways:
  // LOAD"name",device[,1], with the KERNAL's own messages, the file loaded
  // as the KERNAL's LOAD loads it, and back as BASIC's LOAD comes back, through the stack, which a
  // file loaded over it (Zoopak's) takes to its own start; and RUN, by $A871.
  let typed = [];
  function ready() {
    for (;;) {
      if (c.hooks.get(0xf157)(c) === 'wait') return 'wait';   // (CHRIN's own routine, past its jump-table entry and vector)
      if (c.a === 0x0d) break;
      typed.push(c.a);
      if (typed.length >= 0x59) { typed = []; c.x = 0x17; c.pc = 0xa437; return false; }
    }
    const text = typed; typed = [];
    text.forEach((ch, i) => w(0x200 + i, ch)); w(0x200 + text.length, 0);
    chrout(0x0d);
    let i = 0;
    while (text[i] === 0x20) i++;
    if (i === text.length) return 'wait';
    w(0x3a, 0xff);
    // a line for the program: its number ($A96B, LINGET: digits, spaces passed over, past 63999
    // a SYNTAX ERROR), its text tokenized, put in its place, and the variables cleared
    if (text[i] >= 0x30 && text[i] <= 0x39) {
      let n = 0;
      for (; i < text.length && (text[i] === 0x20 || text[i] >= 0x30 && text[i] <= 0x39); i++) {
        if (text[i] === 0x20) continue;
        if (n >= 6400) { c.x = 0x0b; c.pc = 0xa437; return false; }
        n = n * 10 + text[i] - 0x30;
      }
      const end = store(m.ram, r(0x2b) | r(0x2c) << 8, n, crunch(text.slice(i)));
      for (const at of [0x2d, 0x2f, 0x31]) { w(at, end); w(at + 1, end >> 8); }
      w(0x33, r(0x37)); w(0x34, r(0x38));
      basic?.clr(); cont = null;
      return 'wait';
    }
    const command = String.fromCharCode(...text.slice(i)).trim();
    if (command === 'RUN') { c.pc = 0xa871; return false; }
    const load = /^LOAD"([^"]*)"(?:,(\d+))?(?:,(\d+))?$/.exec(command);
    if (load) {
      const [, name, device = '1', secondary = '0'] = load;
      for (let i = 0; i < name.length; i++) w(0x200 + i, name.charCodeAt(i));
      w(0xb7, name.length); w(0xbb, 0x00); w(0xbc, 0x02); w(0xba, +device); w(0xb9, +secondary); w(0xb8, 1);
      // (the KERNAL's messages, each its return first: \rSEARCHING FOR name, \rLOADING)
      print('\rSEARCHING FOR ' + name);
      c.a = 0; c.x = 0x01; c.y = 0x08;   // (where a file with secondary address 0 goes: $0801)
      // the stack as BASIC's LOAD has it, its return to BASIC ($E178) at $01F8, then the load
      c.sp = 0xf7; w(0x1f8, 0x77); w(0x1f9, 0xe1);
      m.load();
      if (c.c) { print('\r?FILE NOT FOUND  ERROR'); c.sp = 0xff; print('\rREADY.\r'); return 'wait'; }
      // (LOADING once the file is found; the registers LOAD leaves, its end, kept for BASIC)
      const { a, x, y } = c; print('\rLOADING'); Object.assign(c, { a, x, y, c: 0 });
      return true;   // as the KERNAL's LOAD returns: RTS, to wherever $01F8 now says
    }
    // direct mode: the line tokenized in the buffer, as CRUNCH leaves it, and run after the
    // program's statements
    crunch(text.slice(i)).forEach((b, k) => w(0x200 + k, b));
    return runDirect();
  }

  // A program run (RUN): the BASIC program in memory, at TXTTAB ($2B), read (basic-lang.js)
  // and compiled (basic-compile.js) as the remake's are, and its statements carried out
  // by the remake's BASIC (basic.js), on `engine`, this machine as that BASIC asks for one:
  // its memory, the registers it calls the KERNAL with, and the KERNAL's routines by name,
  // answered here. GET and SYS go through the processor, as BASIC's own do: GET calls GETIN at
  // $FFE4, SYS jumps to the machine code; both come back to $A7AE,
  // and the program goes on. LOAD from a program loads, and runs the program again from its start,
  // its variables kept, or the program it has loaded (GAME, over the boot). An error is BASIC's
  // message (basic-rom.js) and READY.
  let program = null, basic = null, statements = [], getting = null, inStatement = false;
  // each step's line, for CURLIN ($39) as it runs and an error's IN (direct mode's $FFFF: none),
  // and where CONT goes on, the step after a STOP or END, until the program is changed
  let lineOf = [], cont = null, waiting = null, paced = -1, budget = 0;
  const DIRECT = 0x10000;   // the label the direct statements start at
  const YIELD = Symbol('the processor goes on');
  const routine = at => e => { Object.assign(c, { a: e.a, x: e.x, y: e.y }); c.hooks.get(at)(c); Object.assign(e, { a: c.a, x: c.x, y: c.y, c: c.c, z: c.z, n: c.n, v: c.v }); };
  const engine = {
    get mem() { return m.ram; }, read: r, write: w,
    a: 0, x: 0, y: 0, c: 0, z: 0, n: 0, v: 0, pc: 0, ended: false, idle: 0, polled: false, inside: 0, keys: [], delay: 0, cycles: 0,
    title: { seed: 0x11 },
    routines: {
      chrout: routine(0xf1ca), chrin: routine(0xf157), getin: routine(0xf13e), clrchn: routine(0xf333), chkin: routine(0xf20e), chkout: routine(0xf250),
      open: routine(0xf34a), close: routine(0xf291), setnam: routine(0xffbd), settim: routine(0xffdb), setlfs: routine(0xffba),
      load: e => { Object.assign(c, { a: e.a, x: e.x, y: e.y }); m.load(); Object.assign(e, { a: c.a, x: c.x, y: c.y, c: c.c }); },
      // SYS: BASIC's text pointer at the text after it, its address at $14 as GETADR leaves it,
      // and on through SYS's own ($E130, basic-rom.js), which keeps the registers, back to $A7AE
      sys: (e, at, text) => {
        w(0x7a, text); w(0x7b, text >> 8); w(0x14, at); w(0x15, at >> 8);
        c.push((0xa7ae - 1) >> 8); c.push((0xa7ae - 1) & 0xff); c.pc = 0xe130;
        return YIELD;
      },
      // LOAD in a program
      'basic-load': (e, [name, device = 1, sa = 0]) => {
        for (let k = 0; k < name.length; k++) w(0x200 + k, name.charCodeAt(k));
        w(0xb7, name.length); w(0xbb, 0x00); w(0xbc, 0x02); w(0xba, device); w(0xb9, sa); w(0xb8, 0);
        Object.assign(e, { a: 0, x: 0x01, y: 0x08 });
        e.routines.load(e);
        if (e.c) throw new BasicError('?FILE NOT FOUND ERROR');
        if (!sa) compile(); else e.pc = 0;
      },
    },
  };
  function compile(all = lines(m.ram, r(0x2b) | r(0x2c) << 8)) {
    program = instantiate(all, { name: 'program', source: 'BASIC\'s text in memory', mem: m.ram, cost: 0, render: () => '' });
    lineOf = []; let line = 0xffff, start = 0;
    for (const s of all) { if (s.label !== undefined) { line = s.line ?? 0xffff; if (s.label === DIRECT) start = lineOf.length; } else lineOf.push(line); }
    statements = all.filter(s => s.label === undefined);
    if (basic) basic.items = dataItems(m.ram, r(0x2b) | r(0x2c) << 8);   // (DATA, as READ reads it)
    engine.pc = 0; engine.ended = false;
    return start;
  }
  function run() { basic = new Basic(engine, { quiet: true }); engine.basic = basic; compile(); }
  // INPUT from the keyboard (Microsoft's INPUT, QINLIN and INLOOP): not in direct mode; the
  // prompt and "? ", a line read as the main loop reads one (CHRIN, the screen editor's), and
  // its items taken in turn: a string quoted to its closing quote, or to a comma or a colon; a
  // number as FIN reads it, which a comma, a colon or the line's end must follow, or
  // "?REDO FROM START" and the INPUT again; a line run out before the variables, "?? " and
  // another; items left, "?EXTRA IGNORED"; an empty line, the program ended, as END ends it.
  // While a line is read, the run waits here (`inputting`).
  let inputting = null;
  function input(st, k) {
    if (lineOf[k] === 0xffff) throw new BasicError('?ILLEGAL DIRECT ERROR');
    if (!inputting) {
      inputting = { k, n: 0, text: null, at: 0, typed: [] };
      if (st.prompt !== null) for (const ch of st.prompt) chrout(ch.charCodeAt(0));
      print('? ');
    }
    const s = inputting;
    for (;;) {
      if (s.text === null) {
        // a line, to RETURN
        for (;;) {
          if (c.hooks.get(0xf157)(c) === 'wait') { engine.pc = k; c.pc = 0xa7ae; return 'wait'; }
          if (c.a === 0x0d) break;
          s.typed.push(c.a);
          if (s.typed.length >= 0x59) { inputting = null; throw new BasicError('?STRING TOO LONG ERROR'); }
        }
        chrout(0x0d);
        s.text = s.typed; s.typed = []; s.at = 0; s.fresh = true;
        if (!s.text.length && s.n === 0) { inputting = null; engine.ended = true; engine.pc = k + 1; return undefined; }
      }
      const t = s.text, skip = () => { while (t[s.at] === 0x20) s.at++; };
      if (s.n === st.targets.length) {
        if (s.at < t.length) print('?EXTRA IGNORED\r');
        inputting = null; engine.pc = k + 1; return undefined;
      }
      // this variable's item, or the line run out: another
      // (a line just read is read from, empty or not: an empty one gives 0, or "")
      if (s.n > 0 && !s.fresh && (s.at >= t.length || t[s.at] === 0x3a)) { print('?? '); s.text = null; continue; }
      if (!s.fresh && t[s.at] === 0x2c) s.at++;   // past the comma (a new line's first comma is an empty item)
      s.fresh = false;
      skip();
      const target = st.targets[s.n], string = target.n.endsWith('$');
      let value;
      if (string) {
        let v = '';
        if (t[s.at] === 0x22) { s.at++; while (s.at < t.length && t[s.at] !== 0x22) v += String.fromCharCode(t[s.at++]); if (t[s.at] === 0x22) s.at++; skip(); }
        else while (s.at < t.length && t[s.at] !== 0x2c && t[s.at] !== 0x3a) v += String.fromCharCode(t[s.at++]);
        value = v;
      } else {
        const n = scanNumber(String.fromCharCode(...t), s.at);
        s.at = n.end; value = val(n.text);
      }
      if (s.at < t.length && t[s.at] !== 0x2c && t[s.at] !== 0x3a) { print('?REDO FROM START\r'); inputting = null; return input(st, k); }
      if (target.k === 'elem') basic.setElem(target.n, target.i.map(e => evaluator(e)(basic)), value); else basic.set(target.n, value);
      s.n++;
    }
  }
  function breakIn(line) { print('\rBREAK'); if (line !== undefined && line >> 8 !== 0xff) print(' IN ' + line); }
  // A line run at once (direct mode): its statements after the program's (basic-lang.js
  // `direct`), on the variables the program left, or a BASIC of its own the first time; READY at
  // its end, as at the program's
  function runDirect() {
    if (!basic) { basic = new Basic(engine, { quiet: true }); engine.basic = basic; }
    const all = direct(m.ram, r(0x2b) | r(0x2c) << 8, 0x200);
    all[all.findIndex(s => s.label === 'direct')].label = DIRECT;
    engine.pc = compile(all);
    c.pc = 0xa7ae; return false;
  }
  // LIST ($A69C): from the first line at the first number or after, each a RETURN, then (past
  // the last number, the RETURN printed first, as the ROM prints it, and no more) its number, a
  // space and its text as LIST gives it (basic-lang.js `list`); NEW ($A642): no program, and
  // the variables cleared
  engine.routines['basic-list'] = (e, [from, to]) => {
    for (const l of programLines(m.ram, r(0x2b) | r(0x2c) << 8)) {
      if (l.n < from) continue;
      chrout(0x0d);
      if (l.n > to) break;
      print(l.n + ' '); list(l.bytes).forEach(ch => chrout(ch));
    }
  };
  engine.routines['basic-new'] = e => {
    const at = r(0x2b) | r(0x2c) << 8; w(at, 0); w(at + 1, 0);
    for (const v of [0x2d, 0x2f, 0x31]) { w(v, at + 2); w(v + 1, (at + 2) >> 8); }
    w(0x33, r(0x37)); w(0x34, r(0x38));
    basic?.clr(); cont = null; e.ended = true;
  };
  // SAVE ($E156) and VERIFY ($E165): the program, TXTTAB to VARTAB, to the drive's file, or held
  // to it; in direct mode the KERNAL's messages (SAVING, SEARCHING FOR, VERIFYING), and after a
  // VERIFY, BASIC's OK, or ?VERIFY ERROR where a byte differs. Device 8 only: the tape is not
  // moonbase's.
  const file = (name, device) => {
    if (device !== 8) { if (device === 1) throw new Error('the tape is not handled'); throw new BasicError('?DEVICE NOT PRESENT ERROR'); }
    if (!name.length) throw new BasicError('?MISSING FILE NAME ERROR');
    return Uint8Array.from(name, ch => ch.charCodeAt(0));
  };
  const directMode = () => r(0x3a) === 0xff;
  engine.routines['basic-save'] = (e, [name = '', device = 1]) => {
    const n = file(name, device), from = r(0x2b) | r(0x2c) << 8, to = r(0x2d) | r(0x2e) << 8;
    if (directMode()) print('\rSAVING ' + name);
    const body = new Uint8Array(to - from + 2); body[0] = from & 0xff; body[1] = from >> 8;
    for (let a = from; a < to; a++) body[a - from + 2] = r(a);
    m.drive.save(n, body);
  };
  engine.routines['basic-verify'] = (e, [name = '', device = 1, sa = 0]) => {
    const n = file(name, device);
    if (directMode()) print('\rSEARCHING FOR ' + name);
    const raw = m.drive.load(n);
    if (!raw || raw.length < 2) throw new BasicError('?FILE NOT FOUND ERROR');
    if (directMode()) print('\rVERIFYING');
    const at = sa ? raw[0] | raw[1] << 8 : r(0x2b) | r(0x2c) << 8;
    for (let k = 2; k < raw.length; k++) if (r(at + k - 2) !== raw[k]) throw new BasicError('?VERIFY ERROR');
    print('\rOK\r');
  };
  engine.routines['basic-cont'] = e => { if (cont === null) throw new BasicError('?CAN\'T CONTINUE ERROR'); e.pc = cont; };
  function go() {
    if (getting) {
      const { k, t } = getting; getting = null;
      const ch = c.a, s = ch ? String.fromCharCode(ch) : '';
      basic.set(t.n, t.n.endsWith('$') ? s : (ch ? Number(s) || 0 : 0));
      engine.pc = k + 1;
    }
    for (let i = 0; i < 100000; i++) {
      // (so many statements a frame where the page asks, m.basicPace, as a C64's BASIC takes its
      // time: a wait on the clock, or a FOR counted out for a pause, as long as on the machine)
      if (m.basicPace) { if (m.frame !== paced) { paced = m.frame; budget = m.basicPace; } if (budget-- <= 0) return 'wait'; }
      const k = engine.pc;
      if (engine.ended || k >= program.steps.length) {
        // (an END or STOP in the program leaves CONT the step after it)
        if (engine.ended && /^(end|stop)$/.test(statements[k - 1]?.k) && lineOf[k - 1] !== 0xffff) cont = k;
        // (STOP: BREAK, and IN its line in a program, as BASIC's error path prints it, $A469)
        if (engine.ended && statements[k - 1]?.k === 'stop') breakIn(lineOf[k - 1]);
        print('\rREADY.\r'); c.sp = 0xff; c.pc = 0xa480; return false;
      }
      const st = statements[k];
      if (lineOf[k] !== undefined) { w(0x39, lineOf[k]); w(0x3a, lineOf[k] >> 8); }
      // GET: GETIN through the processor, from BASIC's ROM
      // the RUN/STOP key, as BASIC's ISCNTC looks before each statement: BREAK IN the line
      if (r(0x91) === 0x7f && waiting !== k) { w(0xc6, 0); cont = k; breakIn(lineOf[k]); print('\rREADY.\r'); c.sp = 0xff; c.pc = 0xa480; return false; }
      waiting = null;
      if (st.k === 'input-keys') { const r1 = input(st, k); if (r1 !== undefined) return r1; continue; }
      if (st.k === 'get') { w(0x13, 0); getting = { k, t: st.t }; c.push((0xa7ae - 1) >> 8); c.push((0xa7ae - 1) & 0xff); c.pc = 0xffe4; return false; }
      engine.pc = k + 1;
      let result;
      try { inStatement = true; result = program.run[k](engine, program.steps); }
      catch (err) {
        if (!(err instanceof BasicError) || !printError(fromRom, err.message, err.basicLine ?? lineOf[k] ?? basic.at)) throw err;
        c.sp = 0xff; c.pc = 0xa480; return false;
      }
      finally { inStatement = false; }
      if (result === YIELD) return false;
      // WAIT, its bits not come: again on the next frame, as the ROM's loop ($B82D) goes on round,
      // RUN/STOP not looked at
      if (st.k === 'wait' && engine.pc === k) { waiting = k; c.pc = 0xa7ae; return 'wait'; }
    }
    return 'wait';
  }
}

