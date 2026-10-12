// Commodore BASIC's rules for numbers, held once for every layer that keeps them: the remake's
// BASIC (basic.js, on JavaScript's numbers) and moonbase's BASIC ROM (basic-rom.js, on the ROM's
// five-byte floats). BASIC's errors in its own words; a whole number of 16 bits; a number as FOUT
// writes it and as VAL reads it; and RND's numbers as moonbase gives them, the same on every line.
//
// (FOUT and VAL are held to the ROM's.)

import { Floats, CONSTANTS, pack } from './float.js';

// (an error's BASIC line, where it is not the statement's own, is its `basicLine`: WebKit gives
// every Error a `line` of its own, the line of the JavaScript it was thrown from)
export class BasicError extends Error {}
// BASIC's error messages, by their number in its table (the X its error routine takes, $A437, less 1)
export const ERRORS = ['TOO MANY FILES', 'FILE OPEN', 'FILE NOT OPEN', 'FILE NOT FOUND', 'DEVICE NOT PRESENT', 'NOT INPUT FILE', 'NOT OUTPUT FILE', 'MISSING FILE NAME',
  'ILLEGAL DEVICE NUMBER', 'NEXT WITHOUT FOR', 'SYNTAX', 'RETURN WITHOUT GOSUB', 'OUT OF DATA', 'ILLEGAL QUANTITY', 'OVERFLOW', 'OUT OF MEMORY', 'UNDEF\'D STATEMENT',
  'BAD SUBSCRIPT', 'REDIM\'D ARRAY', 'DIVISION BY ZERO', 'ILLEGAL DIRECT', 'TYPE MISMATCH', 'STRING TOO LONG', 'FILE DATA', 'FORMULA TOO COMPLEX', 'CAN\'T CONTINUE',
  'UNDEF\'D FUNCTION', 'VERIFY', 'LOAD', 'BREAK'];
export const fail = what => { throw new BasicError('?' + what + ' ERROR'); };

// A number as BASIC writes it (FOUT): a space for its sign when it is not negative, nine
// significant digits, no 0 before the point, and an exponent below 0.01 or from 1E+09 on. The
// number as BASIC's five bytes hold it, and FOUT's own steps on them (float.js, held to
// Microsoft's and Commodore's), its last digit as theirs: JavaScript's rounding of nine digits
// differs from it for one number in twenty.
const page = new Uint8Array(0x10000), floats = new Floats({ read: a => page[a], write: (a, v) => { page[a] = v; } });
for (const [at, bytes] of Object.entries(CONSTANTS)) page.set(bytes, +at);
export function fout(x) {
  const b = pack(x);
  if (!b[0] || Math.abs(x) < 2 ** -128) return ' 0';
  if (b[0] > 255) fail('OVERFLOW');
  page[0x61] = b[0]; page[0x62] = b[1] | 0x80; page.set(b.slice(2), 0x63); page[0x66] = x < 0 ? 0xff : 0; page[0x70] = 0;
  floats.fout();
  let s = ''; for (let a = 0x100; page[a]; a++) s += String.fromCharCode(page[a]);
  return s;
}

// VAL: the number at a string's start, BASIC's way: spaces skipped, a sign, digits, a point, an
// exponent; 0 if there is none
export function val(s) {
  const t = s.replace(/ /g, ''), m = /^[+-]?(\d*\.?\d*)(E[+-]?\d+)?/.exec(t);
  const n = m && m[1] && m[1] !== '.' ? Number(m[0].replace(/E$/, '')) : 0;
  return Number.isFinite(n) ? n : 0;
}

// A number's text where INPUT reads one, as FIN reads it ($BCF3): spaces passed over anywhere,
// as CHRGET passes them; a sign; digits; a point and digits; an E, a sign and digits. Where it
// ends, for INPUT to look at what follows (a comma, a colon or the line's end, or the item is bad)
export function scanNumber(s, k) {
  let text = '';
  const sp = () => { while (s[k] === ' ') k++; }, digits = () => { while (s[k] >= '0' && s[k] <= '9') { text += s[k++]; sp(); } };
  sp();
  if (s[k] === '-' || s[k] === '+') { text += s[k++]; sp(); }
  digits();
  if (s[k] === '.') { text += s[k++]; sp(); digits(); }
  if (s[k] === 'E') { text += s[k++]; sp(); if (s[k] === '-' || s[k] === '+') { text += s[k++]; sp(); } digits(); }
  return { text, end: k };
}

export const int16 = x => { const n = Math.floor(x); if (n < -32768 || n > 32767) fail('ILLEGAL QUANTITY'); return n; };

// the seed's random numbers: a 32-bit state, each number its top 31 bits as a fraction, which
// BASIC's five-byte floats hold exactly
export const seedRandom = seed => Math.imul(seed, 2654435761) >>> 0;
export const nextRandom = s => (((Math.imul(s, 1664525) + 1013904223) >>> 0) & 0xfffffffe) >>> 0;
