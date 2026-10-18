// What the card engine (card.js) knows of every title it plays, the title's own map of its routines aside (its
// title.js `map`, below): the data some routines take inline after the call, a toolkit's sections file, and the
// Commodore 64's KERNAL as a C64 title's map names it.
//
// A title's `map` (its title.js): the routines its scenes call, by address, each with the name of the step it is in
// a scene's script (`routines`); and what its engine needs beside them, as the title has it: Detect-A-Pet's `seed`
// (where the key reader takes the random routine's seed from), `stir` (a wait for a key that stirs the random
// routine as it polls, its counts fixed when the key comes), `ticks` (a scene's own loop that reads the keyboard each
// frame, each pass a step `tick`), `sections` (its toolkit's sections file, below); a C64 title's `c64`, `start`,
// `quiet` (routines polled without end, an event only when they give something), `basic`, `polls` and `unplaced`.

// The data some entries take inline after the call ({ length, value }), read through `read`: fill's seven bytes,
// copy's eight and a ProDOS call's three, as hexadecimal; print's ASCII, ending $00; a message on the text screen,
// `say`, its text ending $00, each character's high bit turned over
const bytes = n => (read, at) => { const b = []; for (let k = 0; k < n; k++) b.push(read(at + k).toString(16)); return { length: n, value: b.join(' ') }; };
export const INLINE = {
  fill: bytes(7), copy: bytes(8), prodos: bytes(3),
  'boot-say': (read, at) => INLINE.say(read, at),
  say(read, at) { let s = '', i = at; for (let guard = 0; guard < 1024; guard++) { const c = read(i++); if (!c) break; s += String.fromCharCode((c ^ 0x80) & 0x7f); } return { length: i - at, value: s }; },
  print(read, at) { let s = '', i = at; for (let guard = 0; guard < 256; guard++) { const c = read(i++); if (!c) break; s += String.fromCharCode(c & 0x7f); } return { length: i - at, value: s }; },
};

// A section of a toolkit's sections file (its map's `sections`: { file, lib, origin, lengths, marks, count }), by
// X: where it starts in the file and how long it is, from the library's tables, through `read` (memory, with the
// library there)
export function section(toolkit, read, x) {
  const { lengths, marks } = toolkit.sections, word = at => read(at + x) | read(at + x + 1) << 8;
  return { mark: word(marks), length: word(lengths) };
}
// the name of what a read of `path` from `mark` is: a section's `path:x`, or the path
export function sectionName(toolkit, read, path, mark) {
  const s = toolkit.sections;
  if (!s || path !== s.file) return path;
  for (let x = 0; x < s.count; x += 2) { const t = section(toolkit, read, x); if (t.length && t.mark === mark) return path + ':' + x; }
  return path;
}

// The KERNAL's jump table at $FFxx as a C64 title calls it, each entry a step answered in JavaScript
// (@moonbase-machines/c64/kernal.js): the routines Zoopak's code calls. (Not UDTIM, $FFEA: only an interrupt routine
// calls it, which the remake, taking keys and having no interrupts, does not run.) A title that calls more names them
// beside these in its own map, as Goldfields does its files'.
export const KERNAL = {
  0xffd2: 'chrout', 0xffe4: 'getin', 0xfff0: 'plot', 0xffcc: 'clrchn', 0xffe1: 'stop', 0xffb7: 'readst',
  0xffba: 'setlfs', 0xffbd: 'setnam', 0xffd5: 'load', 0xffd8: 'save',
  0xffb1: 'listen', 0xff93: 'second', 0xffa8: 'ciout', 0xffae: 'unlsn', 0xffb4: 'talk', 0xff96: 'tksa', 0xffa5: 'acptr', 0xffab: 'untlk',
  0xffdb: 'settim', 0xffde: 'rdtim', 0xff90: 'setmsg',
};
