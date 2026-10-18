// The ROM routines the games call, in JavaScript, since the Apple's ROM is Apple's own: the
// Monitor's text output, keyboard, delay and bell, and Applesoft's hi-res drawing. Each takes
// what the ROM took, in the registers and the zero page, and leaves what it left.
//
// The Monitor keeps the cursor at CH ($24) and CV ($25), the text window at WNDLFT, WNDWDTH,
// WNDTOP and WNDBTM ($20 to $23), the base of the cursor's row at BASL/BASH ($28/$29), and the
// mask for inverse or normal at INVFLG ($32). Applesoft keeps the hi-res page's high byte at
// HPAG ($E6), the color's bit pattern at HCOLOR1 ($E4), the last position at HNDX ($E0/$E1)
// and HNDY ($E2), the byte of that position at HMASK ($30) and HBASL/HBASH ($26/$27), a shape's
// address at SHAPEL/SHAPEH ($1A/$1B), its scale at SCALE ($E7) and its rotation at ROT ($F9).

// WAIT's cycles for each A, with the JSR to it and its RTS, as its loop takes them ($FCA8: SEC,
// then PHA, SBC #1 until zero, PLA, SBC #1, until that is zero, RTS): half of 26 + 27A + 5A²,
// but for A 0, whose first SBC borrows, and the carry clear takes two at the next
const WAITS = Array.from({ length: 256 }, (_, a) => {
  let n = 6 + 2, carry = 1;
  const sbc = v => { const r = v - 1 - (1 - carry); carry = r >= 0 ? 1 : 0; return r & 0xff; };
  for (let outer = a; ;) {
    n += 3;
    let inner = outer;
    do { inner = sbc(inner); n += 2 + (inner ? 3 : 2); } while (inner);
    n += 4; outer = sbc(outer); n += 2 + (outer ? 3 : 2);
    if (!outer) break;
  }
  return n + 6;
});
const rowBase = r => 0x400 + 0x80 * (r % 8) + 0x28 * ((r / 8) | 0);

import { applesoft } from './hires.js';

export function install(m) {
  const c = m.cpu, z = a => c.read(a), zw = (a, v) => c.write(a, v);
  const hi = applesoft(c, z, zw);   // Applesoft's hi-res position, dot and line, step for step (hires.js)
  const hooks = {
    // the Monitor
    0xfe89: () => {}, 0xfe93: () => {}, 0xfe95: () => {},   // SETKBD, SETVID
    0xfb2f: () => { zw(0x20, 0); zw(0x21, 40); zw(0x22, 0); zw(0x23, 24); m.io(0xc051); m.io(0xc054); },   // INIT: the text screen and window
    0xfb39: () => { m.io(0xc051); m.io(0xc054); },   // SETTXT
    0xfb40: () => { m.io(0xc050); m.io(0xc053); m.io(0xc056); },   // SETGR
    0xfb4b: () => { zw(0x20, 0); zw(0x21, 40); zw(0x22, 0); zw(0x23, 24); vtab(); },   // SETWND
    0xfb90: () => { zw(0x22, 20); zw(0x25, 23); vtab(); },   // SETWND2, the window for mixed mode
    0xfe84: () => zw(0x32, 0xff),   // SETNORM
    0xfe80: () => zw(0x32, 0x3f),   // SETINV
    0xfc22: () => vtab(),   // VTAB
    0xfc58: () => home(),   // HOME
    0xfd8e: () => cout(0x8d),   // CROUT
    0xfded: () => cout(c.a),   // COUT
    0xfdf0: () => cout(c.a),   // COUT1
    0xfdda: () => { cout(hexDigit(c.a >> 4)); cout(hexDigit(c.a & 15)); },   // PRBYTE
    0xfde3: () => cout(hexDigit(c.a & 15)),   // PRHEX
    0xfca8: () => { c.cycles += wait(c.a) - 12; c.a = 0; c.z = 1; },   // WAIT (its JSR and RTS the processor's)
    0xfbdd: () => bell(), 0xfbe4: () => bell2(),   // BELL1, BELL2
    0xfd0c: () => rdkey(true), 0xfd1b: () => rdkey(false),   // RDKEY, KEYIN
    0xfd35: () => rdkey(true),   // RDCHAR
    0xfe2c: () => { const from = z(0x3c) | z(0x3d) << 8, to = z(0x3e) | z(0x3f) << 8, dest = z(0x42) | z(0x43) << 8; for (let i = 0; from + i <= to; i++) zw(dest + i, z(from + i)); },   // MOVE
    0xff3f: () => { c.p = z(0x48); c.a = z(0x45); c.x = z(0x46); c.y = z(0x47); },   // RESTORE
    0xff4a: () => { zw(0x45, c.a); zw(0x46, c.x); zw(0x47, c.y); zw(0x48, c.p); zw(0x49, c.sp); },   // SAVE
    0xfa62: () => { m.halted = 'reset'; }, 0xff59: () => { m.halted = 'monitor'; }, 0xff69: () => { m.halted = 'monitor'; },
    // Applesoft hi-res
    0xf3d8: () => { m.io(0xc057); m.io(0xc050); m.io(0xc055); m.io(0xc052); zw(0xe6, 0x40); hclr(0); },   // HGR2
    0xf3e2: () => { m.io(0xc057); m.io(0xc050); m.io(0xc054); m.io(0xc053); zw(0xe6, 0x20); hclr(0); },   // HGR
    0xf3f2: () => hclr(0),   // HCLR
    0xf3f4: () => hclr(c.a),   // BKGND: the page in the color in A
    0xf3f6: () => hclr(z(0x1c)),
    0xf411: () => hi.hposn(),   // HPOSN: X in Y,X and Y in A
    0xf457: () => hi.hplot(),   // HPLOT
    0xf45a: () => hi.hplot1(),   // HPLOT1: at the position
    0xf4d5: () => hi.up(),   // UP a row, as Detect-A-Pet's wipes step
    0xf504: () => { c.c = 0; hi.down(); }, 0xf505: () => hi.down(),   // DOWN a row
    0xf530: () => hi.hlinFromOrigin(),
    0xf53a: () => hi.hlin(),   // HLIN: to X in X,A and Y in Y
    0xf601: () => { zw(0x1a, c.x); zw(0x1b, c.y); draw(c.a, false); },   // DRAW1: the shape at Y,X, rotation in A
    0xf605: () => draw(c.a, false),
    0xf65d: () => { zw(0x1a, c.x); zw(0x1b, c.y); draw(c.a, true); },   // XDRAW1
    0xf661: () => draw(c.a, true),
    0xf6f0: () => zw(0xe4, [0x00, 0x2a, 0x55, 0x7f, 0x80, 0xaa, 0xd5, 0xff][c.x & 7]),   // HCOLOR from X
    0xf6e9: () => zw(0xe4, [0x00, 0x2a, 0x55, 0x7f, 0x80, 0xaa, 0xd5, 0xff][c.x & 7]),
  };
  const hexDigit = d => (d < 10 ? 0x30 + d : 0x37 + d) | 0x80;

  // text: the cursor to its row, and a character out with the window's wrap and scroll
  // (BASL, as the Monitor's BASCALC leaves it, is the row's base plus the window's left edge)
  function vtab() { const base = rowBase(z(0x25)) + z(0x20); zw(0x28, base & 0xff); zw(0x29, base >> 8); }
  function home() { const l = z(0x20), w = z(0x21), t = z(0x22), b = z(0x23); for (let r = t; r < b; r++) for (let x = l; x < l + w; x++) zw(rowBase(r) + x, 0xa0); zw(0x24, 0); zw(0x25, t); vtab(); }
  function scroll() { const l = z(0x20), w = z(0x21), t = z(0x22), b = z(0x23); for (let r = t; r + 1 < b; r++) for (let x = l; x < l + w; x++) zw(rowBase(r) + x, z(rowBase(r + 1) + x)); for (let x = l; x < l + w; x++) zw(rowBase(b - 1) + x, 0xa0); }
  // DOS 3.3 watches what is printed for a control-D at the start of a line, and takes what
  // follows up to the return as a command: BLOAD and BSAVE are answered from the disk's files, BSAVE and
  // DELETE through the machine's put and remove, so the player's disk hears of them (saves.js)
  let command = null;
  function dos(ch) {
    if (command === null) { if (ch === 0x84 && z(0x24) === 0) command = ''; return command !== null; }
    if (ch !== 0x8d) { command += String.fromCharCode(ch & 0x7f); return true; }
    const line = command.trim(); command = null;
    const m2 = /^(BLOAD|BSAVE|VERIFY|RUN|MAXFILES|CLOSE|OPEN|DELETE)\s*(.*)$/i.exec(line);
    if (!m2) return true;
    const [name, ...opts] = m2[2].split(','), at = opts.map(o => /^A\$?([0-9A-F]+)/i.exec(o.trim())).find(Boolean), len = opts.map(o => /^L\$?([0-9A-F]+)/i.exec(o.trim())).find(Boolean);
    const verb = m2[1].toUpperCase(), f = m.file(name.trim());
    if (verb === 'BLOAD') { if (!f) { m.log('BLOAD ' + name + ': not found'); return true; } const a = at ? parseInt(at[1], 16) : f.aux; for (let i = 0; i < f.body.length; i++) zw(a + i, f.body[i]); m.log('BLOAD', name.trim(), '$' + a.toString(16)); }
    else if (verb === 'BSAVE') { const a = at ? parseInt(at[1], 16) : 0, n = len ? parseInt(len[1], 16) : 0; const body = new Uint8Array(n); for (let i = 0; i < n; i++) body[i] = z(a + i); m.put('/DISK/' + name.trim().toUpperCase(), { volume: 'DISK', path: name.trim().toUpperCase(), type: 'B', aux: a, body }); m.log('BSAVE', name.trim()); }
    else if (verb === 'DELETE') { m.remove('/DISK/' + name.trim().toUpperCase()); }
    return true;
  }
  // COUT1 and the Monitor's VIDOUT, as the IIe's ROM has them: a character from $A0 up masked by
  // INVFLG, and it or one under $80 stored at BASL plus CH, the cursor moved on and past the
  // window's width to the next line; return to the next line's start, line feed down a line,
  // scrolling the window at its bottom; backspace back a column, past the left edge to the end
  // of the line above, unless at the window's top; the bell; any other control nothing. Y is
  // kept at YSAV1 ($35), and A and Y are as they came.
  function cout(ch) {
    if (m.game.kind === 'dos33' && dos(ch)) return;
    zw(0x35, c.y);
    if (ch >= 0xa0) ch &= z(0x32);
    if (ch >= 0xa0 || ch < 0x80) { const y = z(0x24); zw((z(0x28) | z(0x29) << 8) + y, ch); zw(0x24, (y + 1) & 0xff); if (z(0x24) >= z(0x21)) cr(); }
    else if (ch === 0x8d) cr();
    else if (ch === 0x8a) lf();
    else if (ch === 0x88) bs();
    else if (ch === 0x87) bell();
  }
  function cr() { zw(0x24, 0); lf(); }
  function lf() { const cv = z(0x25) + 1; if (cv < z(0x23)) zw(0x25, cv); else scroll(); vtab(); }
  function bs() { const ch = (z(0x24) - 1) & 0xff; zw(0x24, ch); if (!(ch & 0x80)) return; zw(0x24, (z(0x21) - 1) & 0xff); if (z(0x22) >= z(0x25)) return; zw(0x25, z(0x25) - 1); vtab(); }
  // WAIT's cycles for A, with the JSR to it and its RTS (WAITS)
  const wait = a => WAITS[a];
  // BELL2: Y clicks of the speaker (0 being 256), each a WAIT of $0C after the last and the
  // loop's own cycles (LDA #$0C, the WAIT, LDA $C030 that clicks, DEY and BNE), 546 apart; Y left 0
  function bell2(n = c.y || 256) { let t = c.cycles; for (let i = 0; i < n; i++) { t += 2 + wait(0x0c) + 4; m.clicks.push(t); t += 2 + (i < n - 1 ? 3 : 2); } c.cycles = t; c.y = 0; c.a = 0; c.z = 1; c.n = 0; }
  // BELL1: a WAIT of $40, then LDY #$C0 and BELL2's 192
  function bell() { c.cycles += 2 + wait(0x40) + 2; bell2(0xc0); }
  // RDKEY: wait for a key; until one comes, stay on this address
  // (and while it waits, the cursor, as the IIe's KEYIN shows it, $C288 in its own ROM: the
  // character under it kept in the screen's hole at $0478, a checkerboard, $FF, in its place for
  // 12 times 256 polls of the keyboard, then the character for as many, and so on; and the
  // character put back when the key comes. (KEYIN counts RNDL and RNDH up at each poll too, which
  // is how long the wait took: time, which is left out, so that the seed does not hang on how long
  // a key took.) RDKEY reads the character from the screen; KEYIN takes it in A.)
  let waiting = null;
  function rdkey(read) {
    const cursor = () => (z(0x28) | z(0x29) << 8) + z(0x24);
    if (!waiting) { zw(0x478, read ? c.read(cursor()) : c.a); waiting = { polls: 0 }; c.write(cursor(), 0xff); }
    const k = m.io(0xc000);
    if (!(k & 0x80)) {
      if (++waiting.polls % 3072 === 0) c.write(cursor(), (waiting.polls / 3072) & 1 ? z(0x478) : 0xff);
      return 'wait';
    }
    // (the key read again, as KEYIN takes it after the poll that found it, and the strobe
    // cleared by a write, as the IIe's does)
    c.write(cursor(), z(0x478)); waiting = null;
    m.io(0xc000); m.io(0xc010, 0); c.a = k; c.nz(k);
  }

  // hi-res: the page at HPAG, 8,192 bytes, cleared to a color pattern; a position; a dot in
  // the color; a line to a position, as Applesoft steps it
  const page = () => z(0xe6) << 8;
  // HCLR and BKGND: the page, a byte at a time, in the color at $1C, which COLORSHIFT ($F47E)
  // turns after each byte as Applesoft's does, its low seven bits flipped where the byte doubled
  // is under $C0 (so $2A and $55 alternate, and $AA and $D5); left as it leaves them, $1A and $1B
  // the page's end, $1C the color, A and Y 0
  function hclr(color) {
    const p = page(); let col = color;
    for (let i = 0; i < 0x2000; i++) { zw(p + i, col); if (((col << 1 & 0xff) - 0xc0) & 0x80) col ^= 0x7f; }
    zw(0x1a, 0); zw(0x1b, (p >> 8) + 0x20); zw(0x1c, col); c.a = 0; c.y = 0; c.z = 1; c.n = 0;
  }
  // the position and the dot, for a shape: HPOSN and HPLOT1 as Applesoft's
  function hposn(x, y) { c.a = y & 0xff; c.x = x & 0xff; c.y = x >> 8 & 0xff; hi.hposn(); }
  const hplot = () => hi.hplot1();
  // a shape: pairs of three-bit vectors, a bit to plot and two of direction, turned by the
  // rotation and repeated by the scale; a zero byte ends it
  function draw(rot, xor) {
    let at = z(0x1a) | z(0x1b) << 8, x = z(0xe0) | z(0xe1) << 8, y = z(0xe2);
    const [hx, hxh, hy] = [z(0xe0), z(0xe1), z(0xe2)];
    zw(0xea, 0);   // the collisions counted afresh ($F622)
    const scale = z(0xe7) || 256;
    const dir = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    zw(0xf9, rot);
    const step = (d, plot) => {
      const [ddx, ddy] = dir[(d + (rot >> 4)) & 3];
      for (let s = 0; s < scale; s++) {
        if (plot && x >= 0 && x < 280 && y >= 0 && y < 192) {
          hposn(x, y);
          const at = (z(0x26) | z(0x27) << 8) + z(0xe5), mask = z(0x30) & 0x7f;
          // the collisions, HCOUNT ($EA): XDRAW counts a dot it turns on, that was off ($F4A3);
          // DRAW a dot already in the color ($F4BA)
          if (xor ? !(c.read(at) & mask) : !((c.read(at) ^ z(0x1c)) & z(0x30))) zw(0xea, z(0xea) + 1);
          if (xor) zw(at, c.read(at) ^ mask); else hplot();
        }
        x += ddx; y += ddy;
      }
    };
    for (let guard = 0; guard < 4096; guard++) {
      const b = c.read(at++);
      if (b === 0) break;
      const v = [b & 7, (b >> 3) & 7, (b >> 6) & 3];
      for (let i = 0; i < 3; i++) { const bits = v[i]; if (bits === 0 && (i === 2 || (i === 1 && v[2] === 0))) break; step(bits & 3, bits & 4); }
    }
    // DRAW moves only the byte, column and mask it plots by (HBASL, HORIZ, HMASK): HNDX and HNDY
    // stay where the shape began, and HPLOT TO goes on from there, as Detect-A-Pet's name entry
    // puts its cursor after the last letter from them
    hposn(x & 0x1ff, y & 0xff);
    zw(0xe0, hx); zw(0xe1, hxh); zw(0xe2, hy);
    c.a = 0; c.z = 1;
  }

  // a ROM routine is only there while the ROM is switched in: with the language card's RAM in
  // its place, the games' own code lives at these addresses, and runs as it is
  for (const [a, f] of Object.entries(hooks)) c.hooks.set(+a, cpu => m.sw.lcRead ? false : f(cpu));
}
