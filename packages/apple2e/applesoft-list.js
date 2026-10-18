// An Applesoft BASIC program as text, as LIST prints it. A program is lines, each the address of the next line,
// the line number, then the line with every keyword as one byte from $80 up, ending in a zero; two zeros end the
// program. Its text is ASCII. Keywords are listed with a space either side, as LIST prints them; strings, and
// what follows REM or DATA, as they are; a control character as {CTRL-X}. Each line's link is followed (where
// the next line is in memory, from where the program was loaded).
//
//   list(bytes, from = 0x0801)   the program's text, a line to a line
const TOKENS = ('END FOR NEXT DATA INPUT DEL DIM READ GR TEXT PR# IN# CALL PLOT HLIN VLIN HGR2 HGR HCOLOR= HPLOT DRAW ' +
  'XDRAW HTAB HOME ROT= SCALE= SHLOAD TRACE NOTRACE NORMAL INVERSE FLASH COLOR= POP VTAB HIMEM: LOMEM: ONERR RESUME ' +
  'RECALL STORE SPEED= LET GOTO RUN IF RESTORE & GOSUB RETURN REM STOP ON WAIT LOAD SAVE DEF POKE PRINT CONT LIST ' +
  'CLEAR GET NEW TAB( TO FN SPC( THEN AT NOT STEP + - * / ^ AND OR > = < SGN INT ABS USR FRE SCRN( PDL POS SQR RND ' +
  'LOG EXP COS SIN TAN ATN PEEK LEN STR$ VAL ASC CHR$ LEFT$ RIGHT$ MID$').split(' ');
if (TOKENS.length !== 0xeb - 0x80) throw new Error('Applesoft has 107 keywords');

// a character as text: printable as it is, a control character as {CTRL-X}
const char = c => { c &= 0x7f; return c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '{CTRL-' + String.fromCharCode(c + 0x40) + '}'; };

export function list(bytes, from = 0x0801) {
  const out = [];
  for (let at = 0; at + 4 <= bytes.length; ) {
    const next = bytes[at] | bytes[at + 1] << 8;
    if (!next) break;
    const number = bytes[at + 2] | bytes[at + 3] << 8;
    let line = '', quoted = false, rest = false;
    let i = at + 4;
    for (; i < bytes.length && bytes[i]; i++) {
      const b = bytes[i];
      if (b === 0x22 && !rest) quoted = !quoted;
      if (b >= 0x80 && !quoted && !rest) {
        const t = TOKENS[b - 0x80] ?? '{$' + b.toString(16).toUpperCase() + '}';
        line += ' ' + t + ' ';
        if (t === 'REM' || t === 'DATA') rest = true;
      } else line += char(b);
    }
    out.push(number + ' ' + line.replace(/ {2,}/g, ' ').trim());
    // (a line's link is where the next line is in memory: from it, the next line's place here)
    const to = next - from;
    at = to > at && to < bytes.length ? to : i + 1;
  }
  return out.join('\n') + '\n';
}
