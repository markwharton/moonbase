// The Commodore 64's KERNAL as far as Zoopak calls it, in JavaScript, at the addresses it calls
// it: the remake's counterpart of @moonbase-machines/apple2e/rom.js, without Commodore's ROM. Each routine
// takes what the KERNAL took in the registers and the zero page, and leaves what it left there.
//
//   install({ cpu, read, write, drive, loaded, call, log })
//     cpu      a stand-in for the processor: its registers, and `hooks`, which this fills
//     read, write   memory as the processor sees it, the I/O page at $D000 by the 6510's port
//     drive    the serial bus (printer.js `bus`): a 1541 (drive.js), its files by
//              name, its command channel and its memory, and a printer, device 4, if it is on
//     loaded   told of each LOAD: the name, and where the file went
//     call     runs the game's own code at an address, to its return: a routine the KERNAL calls
//              through a vector the game has pointed at it (Tell-A-Tale's keyboard decode)
//     held     the key held down on the page, as the keyboard's matrix shows it to the KERNAL's
//              scan ({ code, shift }, matrixOf), or none
//
// Text out (CHROUT) is the screen editor's part the games use: a character at the cursor, in the
// colour at $0286 and reversed while $C7 says so; RETURN, CLR and HOME, the cursor keys, RVS ON
// and OFF, DEL, the colours and the two character sets. A control code it has no use for is
// nothing, as on the machine. The screen is where $0288 says, the colours at $D800.
import { editor } from './editor.js';

export const VIC = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9b, 0x37, 0x00, 0x00, 0x00, 0x08, 0x00,
  0x14, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0e, 0x06, 0x01, 0x02, 0x03, 0x04, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x4c];   // $D000 to $D02E, as CINT sets them
export const VECTORS = [0xea31, 0xfe66, 0xfe47, 0xf34a, 0xf291, 0xf20e, 0xf250, 0xf333, 0xf157, 0xf1ca, 0xf6ed, 0xf13e, 0xf32f, 0xfe66, 0xf4a5, 0xf5ed];   // $0314 on, as RESTOR puts them
const COLOURS = { 0x90: 0, 0x05: 1, 0x1c: 2, 0x9f: 3, 0x9c: 4, 0x1e: 5, 0x1f: 6, 0x9e: 7, 0x81: 8, 0x95: 9, 0x96: 10, 0x97: 11, 0x98: 12, 0x99: 13, 0x9a: 14, 0x9b: 15 };

// a PETSCII character as the screen code that shows it
export function screenCode(p) {
  if (p >= 0x20 && p < 0x40) return p;
  if (p >= 0x40 && p < 0x60) return p - 0x40;
  if (p >= 0x60 && p < 0x80) return p - 0x20;
  if (p >= 0xa0 && p < 0xc0) return p - 0x40;
  if (p >= 0xc0 && p < 0xff) return p - 0x80;
  return p === 0xff ? 0x5e : 0x20;
}

// The KERNAL's keyboard tables, which a game reads in the ROM: where each of the four is ($EB79:
// unshifted, shifted, Commodore key, CTRL), the character of each key of the keyboard's matrix
// unshifted (Find Me looks a character up in it, for the key to hold down), shifted (BASIC
// typed with the shift keys), with the Commodore key (the keycaps' left graphics) and with CTRL
// (the colours, RVS ON and OFF, and the control codes). `kernalByte` gives the byte at an address
// of the ROM, or undefined where it is not these. (They are the ROM's own bytes.)
const UNSHIFTED = [
  0x14, 0x0d, 0x1d, 0x88, 0x85, 0x86, 0x87, 0x11,   // DEL, RETURN, cursor right, F7, F1, F3, F5, cursor down
  0x33, 0x57, 0x41, 0x34, 0x5a, 0x53, 0x45, 0x01,   // 3 W A 4 Z S E, left shift
  0x35, 0x52, 0x44, 0x36, 0x43, 0x46, 0x54, 0x58,   // 5 R D 6 C F T X
  0x37, 0x59, 0x47, 0x38, 0x42, 0x48, 0x55, 0x56,   // 7 Y G 8 B H U V
  0x39, 0x49, 0x4a, 0x30, 0x4d, 0x4b, 0x4f, 0x4e,   // 9 I J 0 M K O N
  0x2b, 0x50, 0x4c, 0x2d, 0x2e, 0x3a, 0x40, 0x2c,   // + P L - . : @ ,
  0x5c, 0x2a, 0x3b, 0x13, 0x01, 0x3d, 0x5e, 0x2f,   // pound * ; HOME, right shift, = up-arrow /
  0x31, 0x5f, 0x04, 0x32, 0x20, 0x02, 0x51, 0x03,   // 1, left arrow, CTRL, 2, space, Commodore key, Q, RUN/STOP
];
// and with a shift key down: the second character of each key, a letter's graphic
const SHIFTED = [
  0x94, 0x8d, 0x9d, 0x8c, 0x89, 0x8a, 0x8b, 0x91,   // INST, shift RETURN, cursor left, F8, F2, F4, F6, cursor up
  0x23, 0xd7, 0xc1, 0x24, 0xda, 0xd3, 0xc5, 0x01,   // # and the graphics of W A, $, Z S E, left shift
  0x25, 0xd2, 0xc4, 0x26, 0xc3, 0xc6, 0xd4, 0xd8,   // % R D & C F T X
  0x27, 0xd9, 0xc7, 0x28, 0xc2, 0xc8, 0xd5, 0xd6,   // ' Y G ( B H U V
  0x29, 0xc9, 0xca, 0x30, 0xcd, 0xcb, 0xcf, 0xce,   // ) I J 0 M K O N
  0xdb, 0xd0, 0xcc, 0xdd, 0x3e, 0x5b, 0xba, 0x3c,   // + P L - > [ @ <
  0xa9, 0xc0, 0x5d, 0x93, 0x01, 0x3d, 0xde, 0x3f,   // pound * ] CLR, right shift, = pi ?
  0x21, 0x5f, 0x04, 0x22, 0xa0, 0x02, 0xd1, 0x83,   // ! left arrow, CTRL, " shift space, Commodore key, Q, LOAD and RUN
];
// with the Commodore key down: a letter's other graphic, the left one on its keycap; the digits
// 1 to 8 the second eight colours
const COMMODORE = [
  0x94, 0x8d, 0x9d, 0x8c, 0x89, 0x8a, 0x8b, 0x91,   // INST, shift RETURN, cursor left, F8, F2, F4, F6, cursor up
  0x96, 0xb3, 0xb0, 0x97, 0xad, 0xae, 0xb1, 0x01,   // light red, the graphics of W A, dark grey, Z S E, left shift
  0x98, 0xb2, 0xac, 0x99, 0xbc, 0xbb, 0xa3, 0xbd,   // grey, R D, light green, C F T X
  0x9a, 0xb7, 0xa5, 0x9b, 0xbf, 0xb4, 0xb8, 0xbe,   // light blue, Y G, light grey, B H U V
  0x29, 0xa2, 0xb5, 0x30, 0xa7, 0xa1, 0xb9, 0xaa,   // ) I J 0 M K O N
  0xa6, 0xaf, 0xb6, 0xdc, 0x3e, 0x5b, 0xa4, 0x3c,   // + P L - > [ @ <
  0xa8, 0xdf, 0x5d, 0x93, 0x01, 0x3d, 0xde, 0x3f,   // pound * ] CLR, right shift, = pi ?
  0x81, 0x5f, 0x04, 0x95, 0xa0, 0x02, 0xab, 0x83,   // orange, left arrow, CTRL, brown, shift space, Commodore key, Q, LOAD and RUN
];
// with CTRL down: the digits 1 to 8 the first eight colours, 9 and 0 RVS ON and OFF, the letters
// their control codes (A 1 to Z 26); $FF where a key gives nothing
const CTRL = [
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,   // DEL, RETURN, cursor right, F7, F1, F3, F5, cursor down: nothing
  0x1c, 0x17, 0x01, 0x9f, 0x1a, 0x13, 0x05, 0xff,   // red, W A, cyan, Z S, white (E), left shift
  0x9c, 0x12, 0x04, 0x1e, 0x03, 0x06, 0x14, 0x18,   // purple, R (RVS ON) D, green, C F T X
  0x1f, 0x19, 0x07, 0x9e, 0x02, 0x08, 0x15, 0x16,   // blue, Y G, yellow, B H U V
  0x12, 0x09, 0x0a, 0x92, 0x0d, 0x0b, 0x0f, 0x0e,   // RVS ON (9), I J, RVS OFF (0), M K O N
  0xff, 0x10, 0x0c, 0xff, 0xff, 0x1b, 0x00, 0xff,   // + P L - . : @ ,
  0x1c, 0xff, 0x1d, 0xff, 0xff, 0x1f, 0x1e, 0xff,   // pound * ; HOME, right shift, = up-arrow /
  0x90, 0x06, 0xff, 0x05, 0xff, 0xff, 0x11, 0xff,   // black (1), left arrow, CTRL, white (2), space, Commodore key, Q, RUN/STOP
];
const DECODE = [UNSHIFTED, SHIFTED, COMMODORE, CTRL];   // the tables at $EB81, $EBC2, $EC03 and $EC78
const TABLES = [0xeb81, 0xebc2, 0xec03, 0xec78];
export const KEY_TABLES = [0xeb79, 0xecb9];   // the addresses they take, the four and where they are
export function kernalByte(at) {
  if (at >= 0xeb79 && at < 0xeb81) return TABLES[(at - 0xeb79) >> 1] >> ((at & 1) ? 0 : 8) & 0xff;
  const t = TABLES.findIndex(f => at >= f && at <= f + 0x40), code = at - TABLES[t];
  const v = t < 0 ? undefined : code === 0x40 ? 0xff : DECODE[t][code];
  if (v === undefined && at >= KEY_TABLES[0] && at < KEY_TABLES[1]) throw new Error(`the KERNAL's byte at $${at.toString(16).toUpperCase()}: not handled`);
  return v;
}

// A character as the key of the matrix that types it, and the shift with it: the cursor keys,
// RETURN, DEL and the keys of the unshifted table; or null (a character typed only into the buffer)
export function matrixOf(p) {
  const shifted = { 0x9d: 2, 0x91: 7 };
  if (shifted[p] !== undefined) return { code: shifted[p], shift: 1 };
  const code = UNSHIFTED.indexOf(p);
  return code < 0 || [0x01, 0x02, 0x03, 0x04].includes(p) ? null : { code, shift: 0 };
}

export function install({ cpu: c, read, write, drive, loaded = () => {}, call, held = () => null, log = () => {} }) {
  const z = a => read(a), zw = (a, v) => write(a, v & 0xff);
  // the screen editor, as the KERNAL's (editor.js): CHROUT's characters for the screen,
  // the screen cleared, the pointers set; its scroll reads the keyboard's CTRL row as the KERNAL's does
  const ed = editor({ read, write, keyRow: column => { write(0xdc00, column); const v = read(0xdc01); write(0xdc00, 0x7f); return v; } });
  const chrout = ch => ed.chrout(ch), clear = () => ed.clear();
  let typing = false;
  const status = v => zw(0x90, v);
  // Files, as the KERNAL keeps them: a table of up to ten, each its logical number ($0259), its
  // device ($0263) and its secondary address ($026D), how many at $98; the input's device at $99
  // and the output's at $9A. Device 8 is the drive, through the bus; the keyboard (0) and the
  // screen (3) are the KERNAL's own. Any other device on the bus (4 on) is not there: its LISTEN
  // or TALK leaves the status $80, DEVICE NOT PRESENT, and CHKOUT or CHKIN to it fails (5) and
  // leaves the output on the screen, as Goldfields' check for a printer finds ($3EB3).
  const files = () => z(0x98), entry = la => { for (let k = 0; k < files(); k++) if (z(0x259 + k) === la) return k; return -1; };
  const open = () => {
    const la = z(0xb8), fa = z(0xba), sa = z(0xb9);
    if (entry(la) >= 0) { c.a = 2; c.c = 1; return; }   // FILE OPEN
    if (files() >= 10) { c.a = 1; c.c = 1; return; }    // TOO MANY FILES
    const k = files(); zw(0x259 + k, la); zw(0x263 + k, fa); zw(0x26d + k, sa | 0x60); zw(0x98, k + 1);
    if (fa >= 4) {
      status(0);
      if (z(0xb7)) {
        if (!drive.listen(fa)) { status(0x80); c.a = 5; c.c = 1; return; }
        drive.second((sa | 0x60) | 0xf0); const at = z(0xbb) | z(0xbc) << 8; for (let i = 0; i < z(0xb7); i++) drive.ciout(read(at + i)); drive.unlsn();
      }
    }
    c.c = 0;
  };
  const close = () => {
    const k = entry(c.a); if (k < 0) { c.c = 0; return; }
    const fa = z(0x263 + k), sa = z(0x26d + k);
    if (fa >= 4) { const there = drive.listen(fa); status(there ? 0 : 0x80); if (there) { drive.second((sa & 0xef) | 0xe0); drive.unlsn(); } }
    for (let i = k; i < files() - 1; i++) { zw(0x259 + i, z(0x25a + i)); zw(0x263 + i, z(0x264 + i)); zw(0x26d + i, z(0x26e + i)); }
    zw(0x98, files() - 1); c.c = 0;
  };
  const channel = output => {
    const k = entry(c.x); if (k < 0) { c.a = 3; c.c = 1; return; }   // FILE NOT OPEN
    const fa = z(0x263 + k), sa = z(0x26d + k);
    if (fa >= 4) {
      const there = output ? drive.listen(fa) : drive.talk(fa); status(there ? 0 : 0x80);
      if (!there) { c.a = 5; c.c = 1; return; }
      if (output) drive.second(sa); else drive.tksa(sa);
    }
    zw(output ? 0x9a : 0x99, fa); c.c = 0;
  };
  const clrchn = () => { if (z(0x9a) >= 4) drive.unlsn(); if (z(0x99) >= 4) drive.untlk(); zw(0x9a, 3); zw(0x99, 0); };
  const hooks = {
    0xffd2: () => { if (z(0x9a) >= 4) drive.ciout(c.a); else chrout(c.a); c.c = 0; },   // CHROUT: to the screen, or a device on the bus (the drive's file, the printer)
    0xffc0: open, 0xffc3: close, 0xffc6: () => channel(false), 0xffc9: () => channel(true),   // OPEN, CLOSE, CHKIN, CHKOUT
    0xffe7: () => { clrchn(); zw(0x98, 0); },                                      // CLALL
    // CHRIN: from the keyboard, the line typed, a character a call (the screen editor's, its
    // place begun once a call and not again while it waits for keys: `typing`); else a byte from
    // the file on the drive, its status as it ends (none read once it is set: CHKIN clears it)
    0xffcf: () => {
      if (z(0x99) === 0) {
        if (!typing) { ed.begin(); typing = true; }
        const ch = ed.input();
        if (ch === null) return 'wait';
        typing = false; c.a = ch; c.c = 0; return;
      }
      if (z(0x99) !== 8) throw new Error('CHRIN from device ' + z(0x99) + ': not handled');
      // ($F1AD) with the status already set, a RETURN and no read; else ACPTR's byte
      if (z(0x90)) { c.a = 0x0d; c.c = 0; return; }
      const r = drive.acptr(); if (r) { c.a = r.byte; if (r.eoi) status(z(0x90) | 0x40); } else { c.a = 0x0d; status(z(0x90) | 0x42); } c.c = 0;
    },
    0xfff0: () => { if (c.c) { c.x = z(0xd6); c.y = z(0xd3); } else { zw(0xd6, c.x); zw(0xd3, c.y); ed.setLine(); } },   // PLOT
    0xffcc: clrchn, 0xff90: () => { zw(0x9d, c.a); },                              // CLRCHN, SETMSG
    0xffe1: () => { c.z = 0; },                                                    // STOP: not pressed
    0xffb7: () => { c.a = z(0x90); c.nz(c.a); },                                   // READST
    0xffba: () => { zw(0xb8, c.a); zw(0xba, c.x); zw(0xb9, c.y); },                // SETLFS
    0xffbd: () => { zw(0xb7, c.a); zw(0xbb, c.x); zw(0xbc, c.y); },                // SETNAM
    // LOAD: the file the name says from device 8, where it says or at X and Y; the end in X and Y
    0xffd5: () => {
      const n = z(0xb7), from = z(0xbb) | z(0xbc) << 8, name = Uint8Array.from({ length: n }, (_, i) => z(from + i)), sa = z(0xb9);
      const raw = z(0xba) === 8 ? drive.load(name) : null;
      if (!raw || raw.length < 2 || c.a !== 0) { c.a = raw ? 4 : 4; c.c = 1; status(0x42); log('LOAD', String.fromCharCode(...name), 'not found'); return; }
      const at = sa === 0 ? c.x | c.y << 8 : raw[0] | raw[1] << 8, body = raw.subarray(2);
      for (let i = 0; i < body.length; i++) write(at + i, body[i]);
      const end = at + body.length;
      zw(0xae, end); zw(0xaf, end >> 8); status(0); c.x = end & 0xff; c.y = end >> 8; c.c = 0; c.a = 0;
      loaded(String.fromCharCode(...name), at, end - 1);
    },
    // SAVE: from the address in the zero page at A to the one in X and Y
    0xffd8: () => {
      const n = z(0xb7), at = z(0xbb) | z(0xbc) << 8, name = Uint8Array.from({ length: n }, (_, i) => z(at + i));
      const from = z(c.a) | z(c.a + 1) << 8, to = c.x | c.y << 8, body = new Uint8Array(to - from + 2);
      body[0] = from & 0xff; body[1] = from >> 8; for (let i = from; i < to; i++) body[i - from + 2] = read(i);
      drive.save(name, body); c.c = 0; c.a = 0;
    },
    // the serial bus, answered by the drive as the machine's hooks answer it
    0xffb1: () => status(drive.listen(c.a) ? 0 : 0x80), 0xffb4: () => status(drive.talk(c.a) ? 0 : 0x80),
    0xff93: () => drive.second(c.a), 0xff96: () => drive.tksa(c.a), 0xffa8: () => drive.ciout(c.a),
    0xffae: () => drive.unlsn(), 0xffab: () => drive.untlk(),
    0xffa5: () => { const r = drive.acptr(); if (r) { c.a = r.byte; if (r.eoi) status(z(0x90) | 0x40); } else { c.a = 0x0d; status(z(0x90) | 0x42); } c.c = 0; },
    // the clock at $A0 to $A2, which only the interrupt moves (UDTIM, a sixtieth of a second, and
    // round again after 24 hours), and the keyboard's row with STOP, read as it moves: no key
    0xffdb: () => { zw(0xa2, c.a); zw(0xa1, c.x); zw(0xa0, c.y); }, 0xffde: () => { c.a = z(0xa2); c.x = z(0xa1); c.y = z(0xa0); },
    0xffea: () => {
      let t = (z(0xa0) << 16 | z(0xa1) << 8 | z(0xa2)) + 1;
      if (t >= 0x4f1a01) t = 0;
      zw(0xa0, t >> 16); zw(0xa1, t >> 8); zw(0xa2, t); zw(0x91, read(0xdc01));
    },
    // CINT, as MENU calls it within the ROM ($FF5B): the VIC set up, the screen cleared
    0xff5b: () => { VIC.forEach((v, i) => write(0xd000 + i, v)); zw(0x286, z(0x286) || 14); zw(0x288, z(0x288) || 4); zw(0xc7, 0); clear(); },
    // RESTOR ($FD15): the KERNAL's vectors back to its own
    0xfd15: () => VECTORS.forEach((v, i) => { zw(0x314 + 2 * i, v); zw(0x315 + 2 * i, v >> 8); }),
  };
  // The keyboard read (SCNKEY, $EA87), from the key it found down: its code in the matrix at $CB
  // and the shift keys at $028D, as the KERNAL's decode takes them on from $EADD (where MENU's
  // interrupt sends a cursor key it holds down for the joystick or the last key, $02). The key
  // goes into the buffer when it is new, or held long enough to repeat (the cursor keys, space
  // and DEL repeat, after 16 interrupts and then every 4). A key held on the page is down in the
  // matrix (`held`); keys typed by a program go into the buffer, as the machine's typing does
  // (machine.js).
  // (or the game's own decode, where it has pointed $028F)
  const decode = () => {
    const own = z(0x28f) | z(0x290) << 8;
    if (own !== 0xeb48) { call(own); return; }
    const code = z(0xcb), shift = z(0x28d);
    // (the table as the KERNAL's decode chooses it, $EB48: SHIFT the shifted, the Commodore key its
    // own, CTRL with or without the others CTRL's; the Commodore key and SHIFT together switch the
    // character set, once a press, unless $0291 locks it, and decode with the table before)
    let table;
    if (shift === 3) { switchSets(shift); table = Math.max(0, TABLES.indexOf(z(0xf5) | z(0xf6) << 8)); }
    else { table = shift * 2 >= 8 ? 3 : shift; zw(0xf5, TABLES[table]); zw(0xf6, TABLES[table] >> 8); }
    const key = code === 0x40 ? 0xff : DECODE[table][code];
    const put = () => {
      zw(0xc5, code); zw(0x28e, shift);
      if (key !== 0xff && z(0xc6) < z(0x289)) { zw(0x277 + z(0xc6), key); zw(0xc6, z(0xc6) + 1); }
    };
    if (code !== z(0xc5)) { zw(0x28c, 0x10); put(); return; }   // a new key: in at once, its repeat 16 interrupts on
    const k = key & 0x7f, mode = z(0x28a);
    if (!(mode & 0x80)) {                                        // only these keys repeat, unless all do ($028A)
      if (mode & 0x40) return;                                   // (or none)
      if (k === 0x7f) { put(); return; }
      if (![0x14, 0x20, 0x1d, 0x11].includes(k)) return;
    }
    if (z(0x28c)) { zw(0x28c, z(0x28c) - 1); if (z(0x28c)) return; }
    zw(0x28b, z(0x28b) - 1); if (z(0x28b)) return;
    zw(0x28b, 4);
    if (z(0xc6)) return;                                         // a repeat only into an empty buffer
    put();
  };
  // the scan: the key held down, decoded; or none (keys typed by a program come only through the
  // buffer), which goes past the decode and its vector, and only notes that none is down
  const scnkey = () => {
    const h = held(), shift = h?.shift ?? 0; zw(0x28d, shift); zw(0xcb, h?.code ?? 0x40);
    if (h && h.code !== null) decode(); else { switchSets(shift); zw(0xc5, 0x40); zw(0x28e, shift); }
  };
  // the Commodore key and SHIFT pressed together: the other character set, as $D018 has it
  const switchSets = shift => { if (shift === 3 && z(0x28e) !== 3 && !(z(0x291) & 0x80)) write(0xd018, read(0xd018) ^ 2); };
  hooks[0xeadd] = decode;
  // The interrupt's own routine ($EA31, where $0314 points first): the clock, the cursor's blink
  // (only while BASIC takes a line: $CC is 0), the cassette's motor off, the keyboard; and its end,
  // which a game's own routine goes on to: $EA7B the keyboard read, $EA7E the CIA's interrupt
  // answered, $EA81 the registers back and RTI, which are the remake's to put back
  // ($EA34 the same without the clock, where Goldfields' boot points $0314 while it loads)
  hooks[0xea31] = () => { hooks[0xffea](); hooks[0xea34](); };
  hooks[0xea34] = () => {
    // the cursor's blink, while $CC is 0: every 20 interrupts ($CD) the character at the cursor
    // reversed, it and its colour kept ($CE, $0287) while it is ($CF), and put back after
    if (!z(0xcc)) {
      zw(0xcd, z(0xcd) - 1);
      if (!z(0xcd)) {
        zw(0xcd, 20);
        const y = z(0xd3), at = (z(0xd1) | z(0xd2) << 8) + y, colour = 0xd800 + ((z(0xd1) | z(0xd2) << 8) & 0x3ff) + y;
        const was = z(0xcf) & 1; zw(0xcf, z(0xcf) >> 1);
        let x = z(0x287), a = read(at);
        if (!was) { zw(0xcf, z(0xcf) + 1); zw(0xce, a); zw(0x287, read(colour)); x = z(0x286); a = z(0xce); }
        write(at, a ^ 0x80); write(colour, x);
      }
    }
    if (z(1) & 0x10) { zw(0xc0, 0); zw(1, z(1) | 0x20); } else if (!z(0xc0)) zw(1, z(1) & 0x1f);
    scnkey();
  };
  hooks[0xea7b] = scnkey;
  for (const a of [0xea7e, 0xea81]) hooks[a] = () => {};
  // Two of BASIC's routines, which Tell-A-Tale calls to write a number: a whole number in $62 and
  // $63 into the floating point accumulator (FLOATC, $BC49, X the exponent: $90 for 16 bits, C set
  // for positive), and the accumulator as text (FOUT, entered at $BDDF): its sign at $00FF+Y (Y as
  // FLOATC leaves it, 0), its digits after, a 0 at the end, and its address in A and Y. Another
  // number than a whole one is not handled: it stops the remake.
  hooks[0xbc49] = () => {
    if (c.x !== 0x90 || !c.c) throw new Error('FLOATC with another exponent or sign: not handled');
    let mant = z(0x62) << 24 | z(0x63) << 16, exp = c.x;
    if (!mant) exp = 0; else while (!(mant & 0x80000000)) { mant = (mant << 1) >>> 0; exp--; }
    zw(0x61, exp); zw(0x62, mant >>> 24); zw(0x63, mant >>> 16); zw(0x64, 0); zw(0x65, 0); zw(0x66, 0); zw(0x70, 0); c.y = 0;
  };
  hooks[0xbddf] = () => {
    const exp = z(0x61), mant = (z(0x62) << 24 | z(0x63) << 16 | z(0x64) << 8 | z(0x65)) >>> 0, shift = 0xa0 - exp;
    if (exp && (shift < 0 || shift > 32 || mant % 2 ** shift)) throw new Error('FOUT of a number not whole: not handled');
    const n = exp ? mant / 2 ** shift : 0, sign = z(0x66) & 0x80 ? 0x2d : 0x20, text = String(n);
    write(0xff + c.y, sign); zw(0x66, sign);
    for (let i = 0; i < text.length; i++) write(0x100 + c.y + i, text.charCodeAt(i));
    write(0x100 + c.y + text.length, 0);
    c.a = 0x00; c.y = 0x01; c.x = 0;
  };
  // two of OPEN's and CLOSE's own steps for a file on the drive, which MENU's fast loader calls
  // within the ROM: the secondary address and name sent ($F3D5), and the file closed ($F642)
  hooks[0xf3d5] = () => {
    if (z(0xb9) & 0x80 || !z(0xb7)) { c.c = 0; return; }
    status(drive.listen(z(0xba)) ? 0 : 0x80); drive.second(z(0xb9) | 0xf0);
    const at = z(0xbb) | z(0xbc) << 8; for (let i = 0; i < z(0xb7); i++) drive.ciout(z(at + i));
    drive.unlsn(); c.c = z(0x90) & 0x80 ? 1 : 0;
  };
  hooks[0xf642] = () => { if (z(0xb9) & 0x80) return; const there = drive.listen(z(0xba)); status(there ? 0 : 0x80); if (there) { drive.second((z(0xb9) & 0xef) | 0xe0); drive.unlsn(); } c.c = 0; };
  // and the routines the vectors lead to, which a game's own routine hands on to (MENU's CHROUT
  // ends JMP $F1CA): the same
  Object.assign(hooks, { 0xf1ca: hooks[0xffd2], 0xf4a5: hooks[0xffd5], 0xf5ed: hooks[0xffd8] });
  for (const [a, f] of Object.entries(hooks)) c.hooks.set(+a, f);
}
