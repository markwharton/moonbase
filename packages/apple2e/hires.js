// Applesoft's hi-res position, dot and line, in JavaScript, step for step as the IIe's ROM does
// them ($F411 to $F5B1), so that each leaves what Apple's leaves: the registers and flags of the
// processor `c` ({ a, x, y, c, n, z, v }), and the zero page through `read` and `write`. rom.js
// answers the ROM's entries with them.
//
// HPOSN ($F411) takes Y in A and X in X (low) and Y (high), and leaves HNDX and HNDY ($E0 to
// $E2), the row's base in HBASL/HBASH ($26/$27), the byte's column in HORIZ ($E5) and in Y, the
// dot's mask in HMASK ($30), and the color in HCOLOR1 ($1C), shifted for an odd column. HPLOT
// ($F457) plots there, HPLOT1 ($F45A) at the position as it is. The steps a line takes are moves
// of a dot: left or right ($F465, by the sign of A), up ($F4D5) or down ($F504, $F505 with the
// carry as it is), each kept in HBASL, HORIZ and HMASK. HLIN ($F53A) draws to X in A (low) and X
// (high) and Y in Y from HNDX and HNDY, a step at a time, as Bresenham would, the sums in $D0 to
// $D5 and the count in X and $1D; $F530 draws from 0,0.

// HMASK for each of a byte's seven dots ($F5B2), by the remainder HPOSN's division leaves less 7
const MASK = [0x81, 0x82, 0x84, 0x88, 0x90, 0xa0, 0xc0];

export function applesoft(c, read, write) {
  const stack = [];   // (PHA and PLA: what is pushed is pulled within the routine)
  const nz = v => { v &= 0xff; c.n = v >> 7; c.z = v ? 0 : 1; return v; };
  const adc = v => { const r = c.a + v + c.c; c.v = (~(c.a ^ v) & (c.a ^ r) & 0x80) ? 1 : 0; c.c = r > 0xff ? 1 : 0; c.a = nz(r); };
  const sbc = v => adc(v ^ 0xff);
  const cmp = (r, v) => { c.c = r >= v ? 1 : 0; nz(r - v); };
  const lda = v => { c.a = nz(v); };
  const asl = () => { c.c = c.a >> 7; c.a = nz(c.a << 1); };
  const lsr = () => { c.c = c.a & 1; c.a = nz(c.a >> 1); };
  const aslM = a => { const v = read(a); c.c = v >> 7; write(a, nz(v << 1)); };
  const rolM = a => { const v = read(a); write(a, nz(v << 1 | c.c)); c.c = v >> 7; };
  const rorM = a => { const v = read(a); write(a, nz(v >> 1 | c.c << 7)); c.c = v & 1; };
  const bit = v => { c.z = c.a & v ? 0 : 1; c.n = v >> 7; c.v = v >> 6 & 1; };
  const pha = () => stack.push(c.a), pla = () => { c.a = nz(stack.pop()); };
  const at = () => (read(0x26) | read(0x27) << 8) + c.y;   // (HBASL),Y

  // the color's bits turned for an odd column ($F47E): flipped where doubled it is under $C0
  function shift() { asl(); cmp(c.a, 0xc0); if (!c.n) return; lda(read(0x1c)); c.a = nz(c.a ^ 0x7f); write(0x1c, c.a); }

  function hposn() {
    write(0xe2, c.a); write(0xe0, c.x); write(0xe1, c.y);
    pha();
    c.a = nz(c.a & 0xc0); write(0x26, c.a); lsr(); lsr(); c.a = nz(c.a | read(0x26)); write(0x26, c.a);
    pla();
    write(0x27, c.a);
    asl(); asl(); asl(); rolM(0x27); asl(); rolM(0x27); asl(); rorM(0x26);
    lda(read(0x27)); c.a = nz(c.a & 0x1f); c.a = nz(c.a | read(0xe6)); write(0x27, c.a);
    c.a = nz(c.x);
    cmp(c.y, 0);
    if (!c.z) { c.y = nz(0x23); adc(0x04); c.y = nz(c.y + 1); }
    sbc(0x07); while (c.c) { c.y = nz(c.y + 1); sbc(0x07); }
    write(0xe5, c.y);
    c.x = nz(c.a);
    lda(MASK[c.x - 0xf9]); write(0x30, c.a);
    c.a = nz(c.y); lsr();
    lda(read(0xe4)); write(0x1c, c.a);
    if (c.c) shift();
  }
  // the dot at the position, in the color: the byte's bits under HMASK made the color's
  function hplot1() { lda(read(0x1c)); c.a = nz(c.a ^ read(at())); c.a = nz(c.a & read(0x30)); c.a = nz(c.a ^ read(at())); write(at(), c.a); }

  // a dot left ($F467) or right ($F48A), by the sign of A ($F465)
  function step() { if (c.n) left(); else right(); }
  function moved() { write(0x30, c.a); write(0xe5, c.y); lda(read(0x1c)); shift(); }
  function left() {
    lda(read(0x30)); lsr();
    if (!c.c) { c.a = nz(c.a ^ 0xc0); write(0x30, c.a); return; }
    c.y = nz(c.y - 1); if (c.n) c.y = nz(0x27);
    lda(0xc0); moved();
  }
  function right() {
    lda(read(0x30)); asl(); c.a = nz(c.a ^ 0x80);
    if (c.n) { write(0x30, c.a); return; }
    lda(0x81); c.y = nz(c.y + 1); cmp(c.y, 0x28); if (c.c) c.y = nz(0);
    moved();
  }
  // a row up ($F4D5) or down ($F505), by the sign of A ($F4D3)
  function upOrDown() { if (c.n) down(); else up(); }
  function up() {
    c.c = 0; lda(read(0x27)); bit(0x1c);
    if (c.z) {
      aslM(0x26);
      if (c.c) adc(0x1f);
      else {
        bit(0x03);
        if (!c.z) { adc(0x1f); c.c = 1; }
        else { adc(0x23); pha(); lda(read(0x26)); adc(0xb0); if (!c.c) adc(0xf0); write(0x26, c.a); const carry = c.c; pla(); c.c = carry; if (!c.c) adc(0x1f); }
      }
      rorM(0x26);
    }
    adc(0xfc); write(0x27, c.a);
  }
  function down() {
    lda(read(0x27)); adc(0x04); bit(0x1c);
    if (!c.z) { write(0x27, c.a); return; }
    aslM(0x26);
    if (c.c) {
      adc(0xe0); c.c = 0; bit(0x04);
      if (!c.z) { lda(read(0x26)); adc(0x50); c.a = nz(c.a ^ 0xf0); if (!c.z) c.a = nz(c.a ^ 0xf0); write(0x26, c.a); lda(read(0xe6)); if (c.c) adc(0xe0); }
    } else adc(0xe0);
    rorM(0x26);
    if (!c.c) { write(0x27, c.a); return; }
    hlinFromOrigin();
  }

  function hlinFromOrigin() { pha(); lda(0); write(0xe0, 0); write(0xe1, 0); write(0xe2, 0); pla(); hlin(); }
  function hlin() {
    pha(); c.c = 1; sbc(read(0xe0)); pha();
    c.a = nz(c.x); sbc(read(0xe1)); write(0xd3, c.a);
    if (!c.c) { pla(); c.a = nz(c.a ^ 0xff); adc(0x01); pha(); lda(0); sbc(read(0xd3)); }
    write(0xd1, c.a); write(0xd5, c.a);
    pla(); write(0xd0, c.a); write(0xd4, c.a);
    pla(); write(0xe0, c.a); write(0xe1, c.x);
    c.a = nz(c.y); c.c = 0; sbc(read(0xe2));
    if (c.c) { c.a = nz(c.a ^ 0xff); adc(0xfe); }
    write(0xd2, c.a); write(0xe2, c.y);
    rorM(0xd3);
    c.c = 1; sbc(read(0xd0)); c.x = nz(c.a);
    lda(0xff); sbc(read(0xd1)); write(0x1d, c.a);
    c.y = nz(read(0xe5));
    let across = !c.c;   // (BCS $F581: the first move a sum, not a step across)
    for (let guard = 0; guard < 0x20000; guard++) {
      if (across) { asl(); step(); c.c = 1; }
      lda(read(0xd4)); adc(read(0xd2)); write(0xd4, c.a); lda(read(0xd5)); sbc(0); write(0xd5, c.a);
      for (;;) {
        hplot1();
        c.x = nz(c.x + 1);
        if (c.z) { write(0x1d, nz(read(0x1d) + 1)); if (c.z) return; }
        lda(read(0xd3));
        if (c.c) { across = true; break; }
        upOrDown(); c.c = 0;
        lda(read(0xd4)); adc(read(0xd0)); write(0xd4, c.a); lda(read(0xd5)); adc(read(0xd1)); write(0xd5, c.a);
        if (c.v) throw new Error('HLIN: overflow past $F5B1, where the ROM has its table');
      }
    }
    throw new Error('HLIN: no end');
  }
  return { hposn, hplot1, hplot: () => { hposn(); hplot1(); }, up, down, hlin, hlinFromOrigin };
}
