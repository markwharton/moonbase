// The KERNAL's screen editor, moonbase's own: what CHROUT does with a character for the screen,
// as the Commodore 64's KERNAL does it, keeping its working storage as it keeps it, so that a game
// that reads it (Goldfields' TEXT/CODE reads the table of lines) finds what it would. Shared by
// moonbase's KERNAL (kernal.js), for the remake and the original alike.
//
//   const ed = editor({ read, write, keyRow })
//     ed.chrout(ch)    a character to the screen ($E716)
//     ed.clear()       the screen cleared, its lines made single ($E544); ed.home() ($E566)
//     ed.setLine()     the pointers set from the row and the column ($E56C), as PLOT ends
//     ed.clearLine(x)  a row cleared ($E9FF)
//     ed.begin(), ed.input()   the keyboard's line, as CHRIN reads it ($F157, $E632): a character,
//                      or null while it waits for a key
//
// The screen is lines of 40 columns, and a logical line one or two of them. Its storage:
//   $D1/$D2  where the cursor's logical line starts on the screen; $F3/$F4 the same in colour
//   $D3      the cursor's column in its logical line (0 to 79); $D5 its last column (39 or 79)
//   $D6      the cursor's row; $D9 to $F2 a byte a row, the high byte of the row's place (its low
//            two bits, with $0288 the page) and its top bit set if the row starts a logical line
//   $C7      reverse on; $D4 quote mode; $D8 inserts to come; $0286 the colour; $CD the blink's count
// A row's low byte of place is 40 times it, as the KERNAL's table at $ECF0 has it.
const COLOURS = [0x90, 0x05, 0x1c, 0x9f, 0x9c, 0x1e, 0x1f, 0x9e, 0x81, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b];

export function editor({ read: r, write: w, keyRow = () => 0xff }) {
  const W = (a, v) => w(a, v & 0xff);
  const low = x => (x * 40) & 0xff;
  // ($E9F0) the line pointer for row X: its low byte, and its high from the table and $0288
  const linePointer = x => { W(0xd1, low(x)); W(0xd2, (r(0xd9 + x) & 3) | r(0x288)); };
  // ($EA24) the colour pointer from the line pointer
  const colourPointer = () => { W(0xf3, r(0xd1)); W(0xf4, (r(0xd2) & 3) | 0xd8); };
  const pnt = () => r(0xd1) | r(0xd2) << 8, user = () => r(0xf3) | r(0xf4) << 8;
  // ($E9FF) row X cleared to spaces, in the cursor's colour ($0286, as $E4DA puts it)
  function clearLine(x) {
    linePointer(x); colourPointer();
    for (let y = 39; y >= 0; y--) { w(user() + y, r(0x286)); w(pnt() + y, 0x20); }
  }
  // ($E56C) the pointers from the row and the column: back to the logical line's first row, the
  // column counted on from it; the line's last column from the rows that go on from it
  function setLine() {
    let x = r(0xd6), a = r(0xd3);
    while (!(r(0xd9 + x) & 0x80)) { a = (a + 40) & 0xff; W(0xd3, a); x--; if (x < 0) break; }
    linePointer(x & 0xff);
    let max = 0x27; x++;
    while (!(r(0xd9 + x) & 0x80)) { max += 40; x++; if (x > 0x7f) break; }
    W(0xd5, max);
    colourPointer();
  }
  // ($E544) the screen cleared: every row a logical line of its own, the table's end marked, the
  // rows cleared from the bottom; then home ($E566)
  function clear() {
    let y = r(0x288) | 0x80, a = 0;
    for (let x = 0; x < 0x1a; x++) { W(0xd9 + x, y); a += 40; if (a > 255) { a &= 0xff; y++; } }
    W(0xd9 + 0x1a, 0xff);
    for (let x = 0x18; x >= 0; x--) clearLine(x);
    home();
  }
  function home() { W(0xd3, 0); W(0xd6, 0); setLine(); }
  // ($E8EA) the screen scrolled up a row: each row moved up from the one below, the table's
  // links moved with them, the last row cleared; again while the first row goes on from above;
  // and with CTRL held a moment's wait. (The cursor's row, the input's row and $02A5 a row up.)
  function scroll() {
    const kept = [0xac, 0xad, 0xae, 0xaf].map(r);
    for (;;) {
      W(0xd6, r(0xd6) - 1); W(0xc9, r(0xc9) - 1); W(0x2a5, r(0x2a5) - 1);
      let x;
      for (x = 0; x < 0x18; x++) { linePointer(x); moveLine(low(x + 1), r(0xda + x)); }
      linePointer(x);
      clearLine(0x18);
      for (let k = 0; k < 0x18; k++) W(0xd9 + k, (r(0xd9 + k) & 0x7f) | (r(0xda + k) & 0x80));
      W(0xf1, r(0xf1) | 0x80);
      if (r(0xd9) & 0x80) break;
    }
    W(0xd6, r(0xd6) + 1); W(0x2a5, r(0x2a5) + 1);
    if (keyRow(0x7f) === 0xfb) W(0xc6, 0);   // CTRL held: the KERNAL waits a moment, and empties the keyboard's buffer
    [0xac, 0xad, 0xae, 0xaf].forEach((a, k) => W(a, kept[k]));
  }
  // ($E9C8) a row copied to the line pointer's, from the row whose low byte is `from` and whose
  // table entry is `entry`
  function moveLine(from, entry) {
    const src = from | ((entry & 3) | r(0x288)) << 8, srcColour = from | ((entry & 3) | 0xd8) << 8;
    W(0xac, from); W(0xad, src >> 8); colourPointer(); W(0xae, from); W(0xaf, srcColour >> 8);
    for (let y = 0x27; y >= 0; y--) { w(pnt() + y, r(src + y)); w(user() + y, r(srcColour + y)); }
  }
  // ($E965) a row opened below the logical line, for it to grow into: the rows below moved down,
  // or the screen scrolled first if the line is at the bottom
  function openLine(from = r(0xd6) + 1) {
    let x = from;
    while (!(r(0xd9 + x) & 0x80)) x++;
    W(0x2a5, x);
    if (x > 0x18) { scroll(); x = r(0x2a5) - 1; W(0xd6, r(0xd6) - 1); return grow(x); }
    const kept = [0xac, 0xad, 0xae, 0xaf].map(r);
    for (let k = 0x18; k > r(0x2a5); k--) { linePointer(k); moveLine(low(k - 1), r(0xd8 + k)); }
    linePointer(Math.max(r(0x2a5), 0));
    clearLine(r(0x2a5));
    for (let k = 0x17; k >= r(0x2a5) && k > 0; k--) W(0xda + k, (r(0xda + k) & 0x7f) | (r(0xd9 + k) & 0x80));
    grow(r(0x2a5));
    [0xac, 0xad, 0xae, 0xaf].forEach((a, k) => W(a, kept[k]));
  }
  // ($E6DA) the logical line made two rows: the cursor's row's link cleared, the next row's
  // marked its own start, the line's last column 40 more, and the pointers from its first row
  function grow(x) {
    W(0xd9 + x, r(0xd9 + x) & 0x7f);
    W(0xd9 + x + 1, r(0xd9 + x + 1) | 0x80);
    W(0xd5, r(0xd5) + 40);
    let k = x; while (!(r(0xd9 + k) & 0x80) && k > 0) k--;
    linePointer(k);
  }
  // ($E87C) on to the next logical line's first row, scrolling at the bottom; ($E891) RETURN, which
  // ends inserts, reverse and quote mode too
  function nextLine() {
    W(0xc9, r(0xc9) >> 1);
    let x = r(0xd6);
    // (the scroll comes back with X its row, $D6, from where the search goes on: $E956)
    do { x++; if (x === 0x19) { scroll(); x = r(0xd6); } } while (!(r(0xd9 + x) & 0x80));
    W(0xd6, x); setLine();
  }
  function carriageReturn() { W(0xd8, 0); W(0xc7, 0); W(0xd4, 0); W(0xd3, 0); nextLine(); }
  // ($E8B3) at the end of a row (column 39 or 79), on to the next row; ($E8A1) at the start of one
  // (column 0 or 40), back to the row before
  function rowEndForward() { for (const end of [0x27, 0x4f]) if (r(0xd3) === end) { if (r(0xd6) !== 0x19) W(0xd6, r(0xd6) + 1); return; } }
  function rowStartBack() { for (const start of [0x00, 0x28]) if (r(0xd3) === start) { W(0xd6, r(0xd6) - 1); return; } }
  // ($EA13) a screen code at the cursor, in colour X, the blink's count 2
  function put(code, colour) { W(0xcd, 2); colourPointer(); w(pnt() + r(0xd3), code); w(user() + r(0xd3), colour); }
  // ($E6B6) the cursor one on: past the line's end, the line grows (to two rows) or a new line
  // (with AUTODN, $0292, set, as while keys wait to be shown, a line opened below: the search for
  // the next line's start from the row the cursor was on, plus one, as $E6CA jumps to $E967 with X
  // as $E8B3 left it, past the LDX $D6 at $E965)
  function advance() {
    const row = r(0xd6);
    rowEndForward();
    W(0xd3, r(0xd3) + 1);
    if (r(0xd5) >= r(0xd3)) return;
    if (r(0xd5) === 0x4f) { W(0xd6, r(0xd6) - 1); nextLine(); W(0xd3, 0); return; }
    if (r(0x292)) return openLine(row + 1);
    let x = r(0xd6);
    if (x >= 0x19) { scroll(); W(0xd6, r(0xd6) - 1); x = r(0xd6); }
    grow(x);
  }
  // a character, quote mode and inserts as the KERNAL keeps them
  function show(code) {
    if (r(0xc7)) code |= 0x80;
    if (r(0xd8)) W(0xd8, r(0xd8) - 1);
    put(code, r(0x286));
    advance();
  }
  function done() { if (r(0xd8)) W(0xd4, r(0xd4) >> 1); }
  // ($E701) back to the end of the logical line before, or nowhere at the top
  function backLine() {
    const x = r(0xd6);
    if (!x) { W(0xd3, 0); return false; }
    W(0xd6, x - 1); setLine(); W(0xd3, r(0xd5)); return true;
  }
  function chrout(ch) {
    W(0xd7, ch); W(0xd0, 0);
    if (ch & 0x80) return shifted(ch);
    if (ch === 0x0d) { carriageReturn(); return done(); }
    if (ch >= 0x20) {
      let code = ch < 0x60 ? ch & 0x3f : ch & 0xdf;
      if (ch === 0x22) W(0xd4, r(0xd4) ^ 1);
      show(code); return done();
    }
    if (r(0xd8)) { show(ch | 0x80); return done(); }
    if (ch === 0x14) {   // DEL
      if (r(0xd3) === 0) { if (!backLine()) return done(); }
      else {
        rowStartBack(); W(0xd3, r(0xd3) - 1); colourPointer();
        for (let y = r(0xd3); y + 1 !== r(0xd5) + 1 && y < r(0xd5); y++) { w(pnt() + y, r(pnt() + y + 1)); w(user() + y, r(user() + y + 1)); }
      }
      w(pnt() + r(0xd5), 0x20); w(user() + r(0xd5), r(0x286));
      return done();
    }
    if (r(0xd4)) { show(ch | 0x80); return done(); }
    if (ch === 0x12) W(0xc7, 0x12);
    if (ch === 0x13) home();
    if (ch === 0x1d) {   // cursor right
      const y = r(0xd3) + 1; rowEndForward(); W(0xd3, y);
      if (y - 1 >= r(0xd5)) { W(0xd6, r(0xd6) - 1); nextLine(); W(0xd3, 0); }
      return done();
    }
    if (ch === 0x11) {   // cursor down
      let y = r(0xd3) + 40; W(0xd6, r(0xd6) + 1);
      if (y > r(0xd5)) { W(0xd6, r(0xd6) - 1); do { y -= 40; if (y >= 0) W(0xd3, y); } while (y > 0 && y >= 40); nextLine(); }
      else W(0xd3, y);
      return done();
    }
    const colour = COLOURS.indexOf(ch); if (colour >= 0) W(0x286, colour);
    if (ch === 0x0e) w(0xd018, r(0xd018) | 2);
    if (ch === 0x08) W(0x291, 0x80); if (ch === 0x09) W(0x291, 0);
    return done();
  }
  function shifted(ch) {
    ch &= 0x7f; if (ch === 0x7f) ch = 0x5e;
    if (ch >= 0x20) { show(ch | 0x40); return done(); }
    if (ch === 0x0d) { carriageReturn(); return done(); }
    if (r(0xd4) || (ch !== 0x14 && r(0xd8))) { show(ch | 0x40 | 0x80); return done(); }
    if (ch === 0x14) {   // INST
      let y = r(0xd5);
      if (r(pnt() + y) === 0x20 && y !== r(0xd3)) { /* room at the end */ }
      else if (y === 0x4f) return done();
      else openLine();
      y = r(0xd5); colourPointer();
      for (; y > r(0xd3); y--) { w(pnt() + y, r(pnt() + y - 1)); w(user() + y, r(user() + y - 1)); }
      w(pnt() + y, 0x20); w(user() + y, r(0x286)); W(0xd8, r(0xd8) + 1);
      return done();
    }
    if (ch === 0x11) {   // cursor up
      const x = r(0xd6);
      if (x) { W(0xd6, x - 1); const y = r(0xd3) - 40; if (y >= 0) W(0xd3, y); else setLine(); }
      return done();
    }
    if (ch === 0x12) W(0xc7, 0);
    if (ch === 0x1d) {   // cursor left
      if (r(0xd3) === 0) backLine(); else { rowStartBack(); W(0xd3, r(0xd3) - 1); }
      return done();
    }
    if (ch === 0x13) { clear(); return done(); }
    const colour = COLOURS.indexOf(ch | 0x80); if (colour >= 0) W(0x286, colour);
    if (ch === 0x0e) w(0xd018, r(0xd018) & ~2);
    return done();
  }
  // The line typed at the keyboard, as CHRIN gives it ($E632): while no line is being read ($D0
  // 0), each key in the buffer shown as CHROUT shows it ($E5CA), the cursor's character put back
  // first if it shows, and SHIFT-RUN/STOP putting LOAD and RUN in the buffer; at RETURN, the
  // logical line the cursor is on read back from the screen ($E602): to its last character that
  // is not a space, from its start, or from where the input began if that was on this line (a
  // prompt's place, $C9/$CA, which CHRIN's caller sets: `begin`). Then a character a call, each
  // screen code made a character again ($E63A), quote mode followed, and RETURN at the end.
  // Gives the character, or null while it waits for a key.
  function begin() { W(0xca, r(0xd3)); W(0xc9, r(0xd6)); }
  function take() { const k = r(0x277); for (let i = 0; i < r(0xc6) - 1; i++) W(0x277 + i, r(0x278 + i)); W(0xc6, r(0xc6) - 1); return k; }
  function input() {
    if (!r(0xd0)) {
      for (;;) {
        const n = r(0xc6); W(0xcc, n); W(0x292, n);
        if (!n) return null;
        if (r(0xcf)) { W(0xcf, 0); W(0xcd, 2); colourPointer(); w(pnt() + r(0xd3), r(0xce)); w(user() + r(0xd3), r(0x287)); }
        const k = take();
        if (k === 0x83) { W(0xc6, 9); [0x4c, 0x4f, 0x41, 0x44, 0x0d, 0x52, 0x55, 0x4e, 0x0d].forEach((v, i) => W(0x277 + i, v)); continue; }
        if (k !== 0x0d) { chrout(k); continue; }
        // RETURN: the line's end, its last character that is not a space, and where to read from
        let y = r(0xd5); W(0xd0, y);
        while (r(pnt() + y) === 0x20 && --y) ;
        W(0xc8, y + 1); W(0x292, 0); W(0xd3, 0); W(0xd4, 0);
        if (!(r(0xc9) & 0x80)) {
          let x = r(0xd6);
          if (x !== r(0xc9)) { while (!(r(0xd9 + x) & 0x80) && x) x--; linePointer(x); }
          if (x === r(0xc9)) { W(0xd3, r(0xca)); if (r(0xca) >= r(0xc8)) return end(); }
        }
        break;
      }
    }
    // a character of the line from the screen: its screen code made a character again, the top
    // bit of a reversed one kept in quote mode
    const y = r(0xd3), s = r(pnt() + y);
    let a = s & 0x3f;
    if (s & 0x40) a |= 0x80;
    if (!((s & 0x80) && r(0xd4)) && !(s & 0x20)) a |= 0x40;
    W(0xd3, y + 1);
    if (a === 0x22) W(0xd4, r(0xd4) ^ 1);
    if (y === r(0xc8)) return end();
    W(0xd7, a);   // (the character given kept, as $E674 keeps it)
    return a === 0xde ? 0xff : a;
  }
  // the line's end: RETURN, shown only if the input is the screen or the output is not
  function end() { W(0xd0, 0); if (r(0x99) === 3 || r(0x9a) !== 3) chrout(0x0d); W(0xd7, 0x0d); return 0x0d; }

  return { chrout, clear, home, setLine, clearLine, scroll, linePointer, colourPointer, begin, input };
}
